// ER:LC event-log endpoint. A server owner POSTs { message, webhook_url, api_key } and we
//   1. check api_key is a real ER:LC server key (GET https://api.erlc.gg/v2/server with the "server-key" header),
//   2. allow at most 5 different stored messages per ER:LC server (identified by a SHA-256 of its key; the key itself is never stored),
//   3. deliver the message to webhook_url (Discord webhooks get an embed, any other https URL gets JSON).
// GET lists a server's stored messages and DELETE frees slots; both take the key in the "server-key" header.

const db = require('./_db');
const { clip } = require('./_shared');
const { safeUrl, sendWebhook } = require('./_logs');

const LIMIT = 5;
const MAX_LEN = 1500;
const { sha, verifyKey } = require('./_erlc');
const hits = new Map();     // ip -> [timestamps]

const view = (rows) => Object.values(rows || {}).map((v) => { try { return JSON.parse(v); } catch (e) { return null; } })
  .filter(Boolean).sort((a, b) => a.time.localeCompare(b.time));

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, server-key');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'method not allowed' });
  if (!db.ready()) return res.status(503).json({ error: 'database not configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now();
  const t = (hits.get(ip) || []).filter((x) => now - x < 60000);
  if (t.length >= 20) return res.status(429).json({ error: 'Too many requests. Slow down.' });
  t.push(now); hits.set(ip, t); if (hits.size > 2000) hits.clear();

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const key = String(req.headers['server-key'] || b.api_key || '').trim();
  if (key.length < 8 || key.length > 200 || /\s/.test(key)) return res.status(400).json({ error: 'api_key is required (your ER:LC server key).' });

  if (req.method === 'POST') {
    const message = typeof b.message === 'string' ? b.message.replace(/\u0000/g, '').trim() : '';
    if (!message || message.length > MAX_LEN) return res.status(400).json({ error: 'message must be 1-' + MAX_LEN + ' characters.' });
    const url = safeUrl(b.webhook_url);
    if (!url) return res.status(400).json({ error: 'webhook_url must be a public https:// URL.' });
    const v = await verifyKey(key);
    if (!v.ok) return res.status(v.status).json({ error: v.error });

    const hk = 'erlc:log:' + v.h, field = sha(message), time = new Date().toISOString();
    try {
      const added = await db.cmd('HSETNX', hk, field, JSON.stringify({ message, time }));
      if (!added) return res.status(409).json({ error: 'That exact message is already logged for this server. Send a different one.', limit: LIMIT });
      const used = await db.cmd('HLEN', hk);
      if (used > LIMIT) { await db.cmd('HDEL', hk, field); return res.status(429).json({ error: 'This server already has ' + LIMIT + ' logged messages. DELETE one to free a slot.', limit: LIMIT, used: LIMIT, remaining: 0 }); }
      const sent = await sendWebhook(url, {
        event: 'erlc.log',
        data: { message, time },
        discord: [{ embeds: [{ title: 'ER:LC log', description: clip(message, 3900), color: 0x94cec4, footer: { text: 'Message ' + used + ' of ' + LIMIT }, timestamp: time }] }],
      });
      if (!sent.ok) { await db.cmd('HDEL', hk, field); return res.status(502).json({ error: 'Your webhook_url did not accept the message (status ' + (sent.status || 'no response') + ').' }); }
      return res.status(200).json({ ok: true, delivered: true, limit: LIMIT, used, remaining: LIMIT - used });
    } catch (e) { return res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
  }

  const v = await verifyKey(key);
  if (!v.ok) return res.status(v.status).json({ error: v.error });
  const hk = 'erlc:log:' + v.h;
  try {
    if (req.method === 'GET') {
      const raw = await db.cmd('HGETALL', hk); const rows = {};
      for (let i = 0; Array.isArray(raw) && i < raw.length; i += 2) rows[raw[i]] = raw[i + 1];
      const messages = view(rows);
      return res.status(200).json({ limit: LIMIT, used: messages.length, remaining: LIMIT - messages.length, messages });
    }
    // DELETE: body.message removes that one, body.all === true clears all five.
    if (b.all === true) await db.cmd('DEL', hk);
    else if (typeof b.message === 'string' && b.message.trim()) await db.cmd('HDEL', hk, sha(b.message.replace(/\u0000/g, '').trim()));
    else return res.status(400).json({ error: 'Send "message" to remove one, or "all": true.' });
    const used = await db.cmd('HLEN', hk);
    return res.status(200).json({ ok: true, limit: LIMIT, used, remaining: LIMIT - used });
  } catch (e) { return res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
};
