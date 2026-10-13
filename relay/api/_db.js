// Tiny Redis client over the Upstash REST API (no dependencies). Connect an Upstash Redis database to this
// Vercel project (Storage tab) and these environment variables appear automatically:
//   KV_REST_API_URL + KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)

function creds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
const ready = () => !!creds();

async function send(path, body) {
  const c = creds();
  if (!c) throw new Error('database not configured');
  const r = await fetch(c.url + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('database error ' + r.status);
  return j;
}

async function cmd(...args) {
  const j = await send('', args.map(String));
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function pipe(commands) {
  if (!commands.length) return [];
  const j = await send('/pipeline', commands.map((c) => c.map(String)));
  return j.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}

async function getJSON(key) {
  const v = await cmd('GET', key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
const setJSON = (key, value) => cmd('SET', key, JSON.stringify(value));

module.exports = { ready, cmd, pipe, getJSON, setJSON };
