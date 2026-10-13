// Shared helpers for the relay endpoints. Secrets come from environment variables only:
//   DISCORD_WEBHOOK_URL  (private, never in this repo)
//   DISCORD_CLIENT_ID

const ALLOWED_ORIGIN = 'https://alt10fd0f.github.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clip = (s, n) => {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Handles CORS, method and origin checks. Returns true if the response was already sent.
function handleCommon(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return true; }
  if (req.headers.origin !== ALLOWED_ORIGIN) { res.status(403).json({ error: 'forbidden origin' }); return true; }
  return false;
}

const discordGet = (path, token) =>
  fetch('https://discord.com/api' + path, { headers: { Authorization: 'Bearer ' + token } });

// Confirms the token is real AND was issued to our Discord application.
async function verifyToken(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 200) return { status: 400, error: 'bad token' };
  try {
    const [meRes, appRes] = await Promise.all([discordGet('/users/@me', token), discordGet('/oauth2/@me', token)]);
    if (!meRes.ok || !appRes.ok) return { status: 401, error: 'invalid token' };
    const me = await meRes.json();
    const info = await appRes.json();
    if (!info || !info.application || info.application.id !== process.env.DISCORD_CLIENT_ID) {
      return { status: 403, error: 'token is for a different app' };
    }
    return { me, scopes: info.scopes || [] };
  } catch (e) {
    return { status: 502, error: 'discord unreachable' };
  }
}

const displayName = (me) => me.global_name || me.username;
const avatarUrl = (me) =>
  me.avatar
    ? 'https://cdn.discordapp.com/avatars/' + me.id + '/' + me.avatar + '.png?size=128'
    : 'https://cdn.discordapp.com/embed/avatars/' + Number((BigInt(me.id) >> 22n) % 6n) + '.png';

// Discord limits: 6000 characters across all embeds in one message, max 10 embeds per message.
function embedSize(e) {
  let n = (e.title || '').length + (e.description || '').length + ((e.footer && e.footer.text) || '').length;
  for (const f of e.fields || []) n += f.name.length + f.value.length;
  return n;
}

async function postOne(embeds, attempt) {
  const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // allowed_mentions: none, so user-supplied text can never ping anyone.
    body: JSON.stringify({ username: 'Kite Tutorials', allowed_mentions: { parse: [] }, embeds }),
  });
  if (r.status === 429 && attempt < 2) {
    let wait = 1000;
    try { wait = Math.min(5000, Math.ceil(((await r.json()).retry_after || 1) * 1000)); } catch (e) {}
    await sleep(wait);
    return postOne(embeds, attempt + 1);
  }
  return r.ok;
}

// Sends the embeds, splitting them across as many webhook messages as needed.
async function postEmbeds(embeds) {
  const groups = [];
  let cur = [], size = 0;
  for (const e of embeds) {
    const s = embedSize(e);
    if (cur.length && (cur.length >= 10 || size + s > 5500)) { groups.push(cur); cur = []; size = 0; }
    cur.push(e); size += s;
  }
  if (cur.length) groups.push(cur);
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) await sleep(500);
    if (!(await postOne(groups[i], 0))) return false;
  }
  return true;
}

module.exports = { ALLOWED_ORIGIN, sleep, clip, handleCommon, discordGet, verifyToken, displayName, avatarUrl, postEmbeds };
