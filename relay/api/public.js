// Public data for the site: the public part of the config, custom showcases (names only), and difficulty totals.
// GET /api/public?showcase=<id> returns one custom showcase's content (visible ones only).
const db = require('./_db');
const { handleCommon } = require('./_shared');
const { loadConfig, publicView, storageError } = require('./_config');
const { LIVE_IDS } = require('./_catalog');
const sc = require('./_showcases');

module.exports = async (req, res) => {
  if (handleCommon(req, res, ['GET'])) return;
  const q = req.query || {};
  if (q.showcase) {
    res.setHeader('Cache-Control', 'no-store');
    const s = await sc.get(String(q.showcase));
    if (!s || s.state === 'hidden') return res.status(404).json({ error: 'not found' });
    if (s.state === 'off') return res.status(403).json({ error: 'off' });
    return res.status(200).json({ id: s.id, title: s.title, category: s.category, content: s.content, updated: s.updated });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10');
  const cfg = await loadConfig();
  const view = publicView(cfg);
  let list = [];
  const ratings = {};
  if (db.ready()) {
    try { list = await sc.all(); } catch (e) { console.error('showcases failed', String(e && e.message || e)); }
    const visible = list.filter((s) => s.state !== 'hidden');
    view.showcases = visible.map(sc.meta);
    // Custom showcases feed the same "off" / "hidden" lists as the built-in ones.
    view.disabled = [...new Set(view.disabled.concat(list.filter((s) => s.state === 'off').map((s) => s.id)))];
    view.hidden = [...new Set(view.hidden.concat(list.filter((s) => s.state === 'hidden').map((s) => s.id)))];
    const ids = LIVE_IDS.concat(visible.map((s) => s.id));
    try {
      const rows = await db.pipe(ids.map((id) => ['HVALS', 'rating:' + id]));
      ids.forEach((id, i) => {
        const vals = (rows[i] || []).map(Number).filter((n) => n >= 1 && n <= 5);
        ratings[id] = { count: vals.length, avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0 };
      });
    } catch (e) { console.error('ratings failed', String(e && e.message || e)); }
  } else view.showcases = [];
  res.status(200).json({ config: view, ratings, storage: db.ready() && !storageError(), storageError: storageError() });
};
