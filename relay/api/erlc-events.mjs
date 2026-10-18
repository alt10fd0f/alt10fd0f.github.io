// ER:LC Event Webhook listener (https://apidocs.erlc.gg/event-webhooks).
//   Register:  POST /api/erlc-events   { "api_key": "<server key>", "webhook_url": "https://..." }
//              -> verifies the key with ER:LC and returns a private listener URL. Paste that URL into
//                 your private server settings ("Event Webhook"). Registering again rotates the URL.
//   Deliver:   POST /api/erlc-events?t=<token>   (sent by the game, signed with Ed25519)
//              -> signature checked against ER:LC's public key over utf8(timestamp)+rawBody, then the event is
//                 forwarded to your webhook_url (Discord webhooks get an embed, others get JSON) and the latest 5 are kept.
//   Recent:    GET /api/erlc-events  with a "server-key" header -> the last 5 events for that server.

import crypto from 'node:crypto';
import db from './_db.js';
import erlc from './_erlc.js';
import logs from './_logs.js';

const PUBKEY = process.env.ERLC_EVENT_PUBLIC_KEY || 'MCowBQYDK2VwAyEAjSICb9pp0kHizGQtdG8ySWsDChfGqi+gyFCttigBNOA=';
const KEEP = 5, PER_MIN = 30, SKEW = 300;
const hits = new Map();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });

function signatureOk(ts, sigHex, body) {
  try {
    if (!/^[0-9a-f]{128}$/i.test(sigHex)) return false;
    const key = crypto.createPublicKey({ key: Buffer.from(PUBKEY, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(ts, 'utf8'), body]), key, Buffer.from(sigHex, 'hex'));
  } catch (e) { return false; }
}
const limited = (id, max) => {
  const now = Date.now(), t = (hits.get(id) || []).filter((x) => now - x < 60000);
  if (t.length >= max) return true;
  t.push(now); hits.set(id, t); if (hits.size > 3000) hits.clear();
  return false;
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, server-key' } });
    if (!db.ready()) return json({ error: 'database not configured' }, 503);
    const u = new URL(request.url);
    const token = u.searchParams.get('t') || '';

    // ---- Recent events (GET) ----
    if (request.method === 'GET') {
      const key = (request.headers.get('server-key') || '').trim();
      if (key.length < 8 || key.length > 200) return json({ error: 'Send your ER:LC key in the server-key header.' }, 400);
      const v = await erlc.verifyKey(key);
      if (!v.ok) return json({ error: v.error }, v.status);
      const rows = (await db.cmd('LRANGE', 'erlc:ev:last:' + v.h, 0, KEEP - 1)) || [];
      return json({ limit: KEEP, events: rows.map((r) => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean) });
    }
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    // ---- Delivery from the game ----
    if (token) {
      if (!/^[0-9a-f]{48}$/.test(token)) return json({ error: 'unknown listener' }, 404);
      const body = Buffer.from(await request.arrayBuffer());
      const ts = request.headers.get('x-signature-timestamp') || '';
      const sig = request.headers.get('x-signature-ed25519') || '';
      if (!ts || !sig) return json({ error: 'missing signature headers' }, 400);
      if (!signatureOk(ts, sig, body)) return json({ error: 'invalid signature' }, 401);
      const age = Math.abs(Date.now() / 1000 - Number(ts));
      if (!Number.isFinite(age) || age > SKEW) return json({ error: 'timestamp too old' }, 401);
      if (body.length > 100000) return json({ error: 'payload too large' }, 413);

      const reg = await db.getJSON('erlc:ev:tok:' + token);
      if (!reg) return json({ error: 'unknown listener' }, 404);
      if (limited(reg.h, PER_MIN)) return json({ error: 'too many events' }, 429);

      const text = body.toString('utf8');
      let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 4000) }; }
      const time = new Date().toISOString();
      await db.pipe([['LPUSH', 'erlc:ev:last:' + reg.h, JSON.stringify({ time, data }).slice(0, 8000)], ['LTRIM', 'erlc:ev:last:' + reg.h, 0, KEEP - 1]]);
      const pretty = JSON.stringify(data, null, 2);
      const sent = await logs.sendWebhook(reg.url, {
        event: 'erlc.event', data,
        discord: [{ embeds: [{ title: 'ER:LC event', description: '```json\n' + pretty.slice(0, 3800).replace(/```/g, "'''") + '\n```', color: 0x94cec4, timestamp: time }] }],
      });
      // 2xx tells the game the signature was fine; a dead destination webhook is the owner's to fix.
      return json({ ok: true, forwarded: !!sent.ok });
    }

    // ---- Registration ----
    let b; try { b = await request.json(); } catch (e) { b = null; }
    if (!b || typeof b !== 'object') return json({ error: 'Send JSON: { "api_key": "...", "webhook_url": "https://..." }' }, 400);
    const key = String(b.api_key || '').trim();
    if (key.length < 8 || key.length > 200 || /\s/.test(key)) return json({ error: 'api_key is required (your ER:LC server key).' }, 400);
    const url = logs.safeUrl(b.webhook_url);
    if (!url) return json({ error: 'webhook_url must be a public https:// URL.' }, 400);
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
    if (limited('reg:' + ip, 10)) return json({ error: 'Too many requests. Slow down.' }, 429);
    const v = await erlc.verifyKey(key);
    if (!v.ok) return json({ error: v.error }, v.status);

    const old = await db.cmd('GET', 'erlc:ev:srv:' + v.h);
    const tok = crypto.randomBytes(24).toString('hex');
    await db.pipe([
      ['SET', 'erlc:ev:tok:' + tok, JSON.stringify({ h: v.h, url })],
      ['SET', 'erlc:ev:srv:' + v.h, tok],
    ].concat(old ? [['DEL', 'erlc:ev:tok:' + old]] : []));
    return json({ ok: true, listener_url: u.origin + u.pathname + '?t=' + tok, note: 'Paste listener_url into your private server settings under "Event Webhook". Keep it private. Registering again replaces it.' });
  },
};
