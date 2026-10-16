// Per-user actions (login required): profile, favorites, difficulty ratings, data deletion.
const db = require('./_db');
const bot = require('./_bot');
const { handleCommon, clip } = require('./_shared');
const { authenticate, roleOf, getProfile, saveProfile, cleanNickname } = require('./_auth');
const { loadConfig } = require('./_config');
const { ALL_IDS, LIVE_IDS } = require('./_catalog');
const { deleteUserTickets } = require('./_tickets');
const sc = require('./_showcases');

const stat = async (id) => {
  const vals = ((await db.cmd('HVALS', 'rating:' + id)) || []).map(Number).filter((n) => n >= 1 && n <= 5);
  return { count: vals.length, avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0 };
};

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const v = await authenticate(req, res);
  if (!v) return;
  const me = v.me;
  const b = req.body || {};
  const dbOn = db.ready();
  const cfg = await loadConfig();
  try {
    switch (b.action) {
      case 'me': {
        const out = { role: await roleOf(me.id), storage: dbOn, profile: { nickname: '', shareEmail: true }, favorites: [], myRatings: {} };
        if (dbOn) {
          const custom = (await sc.all()).map((s) => s.id);
          const rateIds = LIVE_IDS.concat(custom);
          const [p, favs, rs] = await Promise.all([
            getProfile(me.id),
            db.cmd('SMEMBERS', 'fav:' + me.id),
            db.pipe(rateIds.map((id) => ['HGET', 'rating:' + id, me.id])),
          ]);
          if (p) out.profile = { nickname: p.nickname || '', shareEmail: p.shareEmail !== false };
          out.favorites = (favs || []).filter((x) => ALL_IDS.includes(x) || custom.includes(x));
          rateIds.forEach((id, i) => { if (rs[i]) out.myRatings[id] = Number(rs[i]); });
        }
        return res.status(200).json(out);
      }
      case 'favorite': {
        if (!dbOn) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (cfg.features.favorites === false) return res.status(403).json({ error: 'Favorites are turned off.' });
        if (!ALL_IDS.includes(b.id) && !(await sc.exists(b.id))) return res.status(400).json({ error: 'Unknown tutorial.' });
        await db.cmd(b.on ? 'SADD' : 'SREM', 'fav:' + me.id, b.id);
        return res.status(200).json({ ok: true });
      }
      case 'rate': {
        if (!dbOn) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (cfg.features.ratings === false) return res.status(403).json({ error: 'Ratings are turned off.' });
        if (!LIVE_IDS.includes(b.id) && !(await sc.exists(b.id))) return res.status(400).json({ error: 'Unknown tutorial.' });
        const n = Number(b.value);
        if (n === 0) await db.cmd('HDEL', 'rating:' + b.id, me.id);
        else if (Number.isInteger(n) && n >= 1 && n <= 5) await db.cmd('HSET', 'rating:' + b.id, me.id, n);
        else return res.status(400).json({ error: 'Rating must be 1-5.' });
        return res.status(200).json(Object.assign({ ok: true }, await stat(b.id)));
      }
      case 'profile': {
        if (!dbOn) return res.status(503).json({ error: 'Storage is not set up yet.' });
        const p = (await getProfile(me.id)) || { id: me.id, username: me.username, firstSeen: Date.now() };
        if (typeof b.nickname === 'string') p.nickname = cleanNickname(b.nickname);
        if (typeof b.shareEmail === 'boolean') p.shareEmail = b.shareEmail;
        await saveProfile(p);
        return res.status(200).json({ ok: true, profile: { nickname: p.nickname || '', shareEmail: p.shareEmail !== false } });
      }
      case 'delete': {
        if (b.confirm !== true) return res.status(400).json({ error: 'Please confirm the deletion.' });
        if (!dbOn) return res.status(200).json({ ok: true, deleted: 0 });
        const p = await getProfile(me.id);
        await db.pipe([
          ['DEL', 'user:' + me.id], ['DEL', 'report:' + me.id], ['DEL', 'fav:' + me.id],
          ...ALL_IDS.concat((await sc.all()).map((s) => s.id)).map((id) => ['HDEL', 'rating:' + id, me.id]),
        ]);
        const tickets = await deleteUserTickets(me.id);
        // Tell the owner so the Discord-side copies (thread, ticket messages) can be removed by hand.
        if (bot.hasToken() && p && p.threadId) {
          await bot.postMessagesTo(p.threadId, [{ allowed_mentions: { parse: [] }, content: '**Data deletion request** from <@' + me.id + '> (' + clip(me.username, 40) + '). Their stored site data was erased. Please delete this thread and any of their ticket messages in Discord.' }]);
        }
        return res.status(200).json({ ok: true, tickets });
      }
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
