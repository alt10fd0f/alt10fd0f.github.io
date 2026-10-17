// Direct messages to the bot (modmail). A small always-on listener (see /modmail-worker) receives DMs from Discord's gateway
// and forwards each one here. Authenticated with a shared secret (env DM_RELAY_SECRET). Each DM is posted in the staff channel
// with Reply / Close buttons; Reply DMs your answer back to the user (handled in interactions.mjs).

const crypto = require('crypto');
const db = require('./_db');
const bot = require('./_bot');
const { clip } = require('./_shared');
const { saveTicket } = require('./_tickets');

const ID = /^\d{5,25}$/;
const btn = (label, style, id) => ({ type: 2, style, label, custom_id: id });
const recent = new Map();

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const secret = process.env.DM_RELAY_SECRET || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (secret.length < 16 || !safeEqual(given, secret)) return res.status(401).json({ error: 'unauthorized' });
  if (!bot.configured()) return res.status(503).json({ error: 'bot is not configured' });

  const b = req.body || {};
  if (!ID.test(String(b.userId || '')) || !ID.test(String(b.messageId || ''))) return res.status(400).json({ error: 'bad ids' });
  const userId = String(b.userId);
  const text = typeof b.content === 'string' ? b.content.replace(/\u0000/g, '').trim() : '';
  const files = (Array.isArray(b.attachments) ? b.attachments : []).filter((u) => typeof u === 'string' && /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//i.test(u)).slice(0, 5);
  if (!text && !files.length) return res.status(200).json({ ok: true, ignored: 'empty' });

  // The same Discord message is only ever posted once (the listener may retry).
  if (db.ready()) {
    const first = await db.cmd('SET', 'dm:' + b.messageId, '1', 'NX', 'EX', 86400);
    if (!first) return res.status(200).json({ ok: true, duplicate: true });
  }
  // Flood guard: at most 20 forwarded messages per user per hour.
  const now = Date.now();
  const times = (recent.get(userId) || []).filter((t) => now - t < 3600000);
  if (times.length >= 20) return res.status(200).json({ ok: true, ignored: 'rate' });
  times.push(now); recent.set(userId, times);
  if (recent.size > 2000) recent.clear();

  const username = clip(String(b.username || 'unknown'), 40);
  const name = clip(String(b.name || username), 80);
  const avatar = b.avatar && /^[\w]{1,40}$/.test(String(b.avatar)) ? 'https://cdn.discordapp.com/avatars/' + userId + '/' + b.avatar + '.png' : 'https://cdn.discordapp.com/embed/avatars/' + Number((BigInt(userId) >> 22n) % 6n) + '.png';
  const embed = {
    title: 'Direct message from ' + clip(name, 80),
    description: clip(text || '(no text)', 3900),
    color: 0x5865f2,
    thumbnail: { url: avatar },
    fields: [
      { name: 'From', value: name + ' (@' + username + ')', inline: true },
      { name: 'User ID', value: userId, inline: true },
    ].concat(files.length ? [{ name: 'Attachments', value: files.join('\n').slice(0, 1000), inline: false }] : []),
    footer: { text: 'Press Reply to answer them by DM.' },
    timestamp: new Date().toISOString(),
  };
  const post = await bot.postToChannel({ embeds: [embed], components: [{ type: 1, components: [btn('Reply', 1, 'mm:r:' + userId), btn('Close', 2, 'mm:c:' + userId)] }] });
  if (!post.ok || !post.json || !post.json.id) { console.error('dm forward failed', post.status); return res.status(502).json({ error: 'could not post' }); }

  if (db.ready()) {
    try { await saveTicket({ id: post.json.id, userId, username, name, category: 'Direct message', subject: clip(text || 'Attachment', 100), message: clip(text, 1500), status: 'open', created: now, updated: now, replies: 0, dm: true }); } catch (e) { /* the message is in Discord regardless */ }
    // One short acknowledgement per user every 6 hours, so they know a person will answer.
    try {
      const ack = await db.cmd('SET', 'dmack:' + userId, '1', 'NX', 'EX', 21600);
      if (ack) await bot.sendDM(userId, { embeds: [{ title: 'Message received', description: 'Thanks! Your message was sent to the staff team. A reply will arrive here.', color: 0x94cec4 }] });
    } catch (e) { /* not important */ }
  }
  return res.status(200).json({ ok: true });
};
