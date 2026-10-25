// Showcase submissions from visitors (login required). Delivered the same way as other logs:
// to the webhook trigger set in the admin panel (Logs & Discord -> Showcase submissions), to the staff channel via the bot, or both.

const db = require('./_db');
const bot = require('./_bot');
const { clip, handleCommon, displayName, postWebhookMessages } = require('./_shared');
const { authenticate, getProfile } = require('./_auth');
const { loadConfig } = require('./_config');
const sc = require('./_showcases');
const logs = require('./_logs');

const CATEGORIES = sc.CATEGORIES.concat('Other');
const recent = new Map();

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const v = await authenticate(req, res);
  if (!v) return;
  const me = v.me;
  const b = req.body || {};

  const cfg = await loadConfig();
  if (cfg.features && cfg.features.support === false) return res.status(403).json({ error: 'Submissions are turned off right now.' });

  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim() : '';
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const content = typeof b.content === 'string' ? b.content.replace(/\u0000/g, '').trim() : '';
  let link = '';
  if (typeof b.link === 'string' && b.link.trim()) {
    try { const u = new URL(b.link.trim()); if (u.protocol === 'https:' && !u.username && !u.password) link = u.toString().slice(0, 300); } catch (e) { /* ignored below */ }
    if (!link) return res.status(400).json({ error: 'The link must start with https://' });
  }
  if (title.length < 3 || title.length > 80) return res.status(400).json({ error: 'The title must be 3-80 characters.' });
  if (!category) return res.status(400).json({ error: 'Please choose a category.' });
  if (content.length < 30 || content.length > 6000) return res.status(400).json({ error: 'The showcase text must be 30-6000 characters.' });

  const now = Date.now();
  const times = (recent.get(me.id) || []).filter((t) => now - t < 3600000);
  if (times.length >= 3 || (times.length && now - times[times.length - 1] < 30000)) return res.status(429).json({ error: 'You are submitting too quickly. Please try again later.' });
  times.push(now); recent.set(me.id, times);
  const fail = () => { times.pop(); return res.status(502).json({ error: 'Could not deliver your submission. Please try again.' }); };

  let prof = null;
  if (db.ready()) { try { prof = await getProfile(me.id); } catch (e) { prof = null; } }
  const name = (prof && prof.nickname) || displayName(me);
  const email = prof && prof.shareEmail === false ? null : me.email || null;

  // Components V2 message: header + category, quoted text, then link buttons.
  const header = '-# Submitted by ' + clip(name, 60) + ' (@' + clip(me.username, 40) + ') · ID ' + me.id + (email ? ' · ' + clip(email, 100) : '') + '\n### ' + clip(title, 80) + ' | ' + category;
  const buttons = [{ type: 2, style: 5, label: clip(name + "'s Profile", 80), url: 'https://discord.com/users/' + me.id }]
    .concat(link ? [{ type: 2, style: 5, label: 'Showcase Site', url: link }] : []);
  const message = (extra) => ({
    flags: 32768,
    components: [{
      type: 17, accent_color: 2495106,
      components: [
        { type: 10, content: header },
        { type: 14 },
        { type: 10, content: '>>> ' + clip(content, 3300) },
        { type: 14 },
        { type: 1, components: buttons.concat(extra || []) },
      ],
    }],
  });

  const useBuiltin = logs.wants(cfg, 'showcase', 'builtin');
  const useHook = logs.wants(cfg, 'showcase', 'webhook');
  try {
    let ok = false;
    if (useHook) {
      const hook = await logs.sendWebhook(logs.urlOf(cfg, 'showcase'), {
        event: 'showcase', discord: [message()],
        data: { userId: me.id, username: me.username, name, title, category, link, content, email },
      });
      if (!hook.ok) console.error('showcase webhook trigger failed', hook.status);
      ok = hook.ok;
    }
    if (useBuiltin) {
      // Staff get a Reply button (modmail): it opens a box, and the answer is DM'd to the submitter. Their reply back arrives in this channel.
      const reply = { type: 2, style: 1, label: 'Reply', custom_id: 'mm:r:' + me.id };
      const post = bot.configured() ? await bot.postToChannel(message([reply])) : await postWebhookMessages([message()]);
      if (!post.ok) console.error('showcase post failed', post.status);
      ok = ok || post.ok;
    }
    return ok ? res.status(200).json({ ok: true }) : fail();
  } catch (e) {
    return fail();
  }
};
