// Support request: only works for a logged-in Discord user (token verified server-side),
// then posts the request to the webhook.

const { clip, handleCommon, verifyToken, displayName, avatarUrl, postEmbeds } = require('./_shared');

const CATEGORIES = ['Bug report', 'Question', 'Tutorial request', 'Other'];
const recent = new Map(); // userId -> [timestamps], best-effort rate limit per warm instance

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const b = req.body || {};
  const v = await verifyToken(b.token);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const me = v.me;

  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!category) return res.status(400).json({ error: 'Please choose a category.' });
  if (subject.length < 3 || subject.length > 100) return res.status(400).json({ error: 'Subject must be 3-100 characters.' });
  if (message.length < 10 || message.length > 1500) return res.status(400).json({ error: 'Message must be 10-1500 characters.' });

  // At most 3 requests per user per hour, and one every 30 seconds.
  const now = Date.now();
  const times = (recent.get(me.id) || []).filter((t) => now - t < 3600000);
  if (times.length >= 3 || (times.length && now - times[times.length - 1] < 30000)) {
    return res.status(429).json({ error: 'You are sending requests too quickly. Please try again later.' });
  }
  times.push(now);
  recent.set(me.id, times);

  const embed = {
    title: clip('Support request: ' + subject, 250),
    description: message,
    color: 0xe8b4b8,
    thumbnail: { url: avatarUrl(me) },
    fields: [
      { name: 'Category', value: category, inline: true },
      { name: 'From', value: clip(displayName(me), 80) + ' (@' + clip(me.username, 40) + ')', inline: true },
      { name: 'User ID', value: clip(me.id, 30), inline: true },
      { name: 'Email', value: me.email ? clip(me.email, 200) : 'Not provided', inline: false },
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    const ok = await postEmbeds([embed]);
    if (!ok) { times.pop(); return res.status(502).json({ error: 'Could not deliver your request. Please try again.' }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    times.pop();
    return res.status(502).json({ error: 'Could not deliver your request. Please try again.' });
  }
};
