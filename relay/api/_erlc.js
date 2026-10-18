// Shared ER:LC helpers: key hashing and verifying a server key against the ER:LC API.
const crypto = require('crypto');

const ERLC = process.env.ERLC_API_BASE || 'https://api.erlc.gg/v2/server';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const okKeys = new Map(); // key hash -> time verified (5 min cache)

async function verifyKey(key) {
  const h = sha(key);
  if (Date.now() - (okKeys.get(h) || 0) < 300000) return { ok: true, h };
  let r;
  try { r = await fetch(ERLC, { headers: { 'server-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }); }
  catch (e) { return { ok: false, status: 503, error: 'Could not reach the ER:LC API. Try again shortly.' }; }
  if (r.ok) { okKeys.set(h, Date.now()); if (okKeys.size > 500) okKeys.clear(); return { ok: true, h }; }
  if (r.status === 429) return { ok: false, status: 503, error: 'The ER:LC API is rate limiting us. Try again shortly.' };
  if ([400, 401, 403].includes(r.status)) return { ok: false, status: 401, error: 'api_key was rejected by the ER:LC API.' };
  return { ok: false, status: 502, error: 'The ER:LC API answered ' + r.status + '.' };
}

module.exports = { sha, verifyKey };
