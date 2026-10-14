// Public, read-only data for the site: the public part of the config and the difficulty rating totals.
const db = require('./_db');
const { handleCommon } = require('./_shared');
const { loadConfig, publicView, storageError } = require('./_config');
const { LIVE_IDS } = require('./_catalog');

module.exports = async (req, res) => {
  if (handleCommon(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10');
  const cfg = await loadConfig();
  const ratings = {};
  if (db.ready()) {
    try {
      const rows = await db.pipe(LIVE_IDS.map((id) => ['HVALS', 'rating:' + id]));
      LIVE_IDS.forEach((id, i) => {
        const vals = (rows[i] || []).map(Number).filter((n) => n >= 1 && n <= 5);
        ratings[id] = { count: vals.length, avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0 };
      });
    } catch (e) { console.error('ratings failed', String(e && e.message || e)); }
  }
  res.status(200).json({ config: publicView(cfg), ratings, storage: db.ready() && !storageError(), storageError: storageError() });
};
