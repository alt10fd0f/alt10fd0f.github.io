// Support request (login required). Tickets live in Discord only:
// the request is posted in the modmail channel by the bot (with Reply/Close buttons), the user gets a DM copy,
// and a record is kept so the admin panel can list open tickets. Falls back to the webhook if the bot isn't set up.

const db = require('./_db');
const bot = require('./_bot');
const emb = require('./_embeds');
const { clip, handleCommon, displayName, avatarUrl, postEmbeds } = require('./_shared');
const { authenticate, getProfile } = require('./_auth');
const { loadConfig } = require('./_config');
const { saveTicket } = require('./_tickets');

const CATEGORIES = ['Bug report', 'Question', 'Tutorial request', 'Other'];
const recent = new Map();

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const v = await authenticate(req, res);
  if (!v) return;
  const me = v.me;
  const b = req.body || {};

  const cfg = await loadConfig();
  if (cfg.features && cfg.features.support === false) return res.status(403).json({ error: 'Support requests are turned off right now.' });

  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!category) return res.status(400).json({ error: 'Please choose a category.' });
  if (subject.length < 3 || subject.length > 100) return res.status(400).json({ error: 'Subject must be 3-100 characters.' });
  if (message.length < 10 || message.length > 1500) return res.status(400).json({ error: 'Message must be 10-1500 characters.' });

  const now = Date.now();
  const times = (recent.get(me.id) || []).filter((t) => now - t < 3600000);
  if (times.length >= 3 || (times.length && now - times[times.length - 1] < 30000)) {
    return res.status(429).json({ error: 'You are sending requests too quickly. Please try again later.' });
  }
  times.push(now);
  recent.set(me.id, times);
  const fail = () => { times.pop(); return res.status(502).json({ error: 'Could not deliver your request. Please try again.' }); };

  let prof = null;
  if (db.ready()) { try { prof = await getProfile(me.id); } catch (e) { prof = null; } }
  const name = (prof && prof.nickname) || displayName(me);
  const email = prof && prof.shareEmail === false ? null : me.email || null;
  const t = { category, subject, message };

  try {
    if (bot.configured()) {
      const post = await bot.postToChannel(emb.ticketMessage(me, t, { name, email }));
      if (!post.ok || !post.json || !post.json.id) return fail();
      const ticketId = post.json.id;
      const dm = await bot.sendDM(me.id, emb.receiptDM(t, ticketId));
      if (db.ready()) {
        try {
          await saveTicket({ id: ticketId, userId: me.id, username: me.username, name, category, subject, message, status: 'open', created: now, updated: now, replies: 0, dm: dm.ok });
        } catch (e) { /* ticket still exists in Discord */ }
      }
      return res.status(200).json({ ok: true, dm: dm.ok });
    }
    // No bot configured: webhook only (no buttons).
    const embed = emb.ticketMessage(me, t, { name, email }).embeds[0];
    const r = await postEmbeds([embed]);
    if (!r.ok) return fail();
    return res.status(200).json({ ok: true, dm: false });
  } catch (e) {
    return fail();
  }
};
