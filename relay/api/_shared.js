// Shared helpers for the relay endpoints. Secrets come from environment variables only
// (DISCORD_WEBHOOK_URL, DISCORD_BOT_TOKEN, storage tokens...), never from this repo.

const ALLOWED_ORIGIN = 'https://alt10fd0f.github.io';
const OWNER_ID = '989152479222579260';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clip = (s, n) => {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// CORS + method + origin checks. Returns true if the response was already sent.
function handleCommon(req, res, methods) {
  methods = methods || ['POST'];
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', methods.concat('OPTIONS').join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (!methods.includes(req.method)) { res.status(405).json({ error: 'method not allowed' }); return true; }
  if (req.method === 'POST' && req.headers.origin !== ALLOWED_ORIGIN) { res.status(403).json({ error: 'forbidden origin' }); return true; }
  return false;
}

const discordGet = (path, token) =>
  fetch('https://discord.com/api' + path, { headers: { Authorization: 'Bearer ' + token } });

// Confirms the token is real AND was issued to our Discord application. Cached briefly in memory.
const tokenCache = new Map();
async function verifyToken(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 200) return { status: 400, error: 'bad token' };
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return { me: hit.me, scopes: hit.scopes };
  try {
    const [meRes, appRes] = await Promise.all([discordGet('/users/@me', token), discordGet('/oauth2/@me', token)]);
    if (!meRes.ok || !appRes.ok) { tokenCache.delete(token); return { status: 401, error: 'invalid token' }; }
    const me = await meRes.json();
    const info = await appRes.json();
    if (!info || !info.application || info.application.id !== process.env.DISCORD_CLIENT_ID) {
      return { status: 403, error: 'token is for a different app' };
    }
    const scopes = info.scopes || [];
    if (tokenCache.size > 500) tokenCache.clear();
    tokenCache.set(token, { me, scopes, exp: Date.now() + 5 * 60 * 1000 });
    return { me, scopes };
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

function webhookUrl(threadId) {
  const base = process.env.DISCORD_WEBHOOK_URL;
  return threadId ? base + (base.includes('?') ? '&' : '?') + 'thread_id=' + encodeURIComponent(threadId) : base;
}

async function postOne(embeds, attempt, threadId) {
  const r = await fetch(webhookUrl(threadId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // allowed_mentions: none, so user-supplied text can never ping anyone.
    body: JSON.stringify({ username: 'Kite Tutorials', allowed_mentions: { parse: [] }, embeds }),
  });
  if (r.status === 429 && attempt < 2) {
    let wait = 1000;
    try { wait = Math.min(5000, Math.ceil(((await r.json()).retry_after || 1) * 1000)); } catch (e) {}
    await sleep(wait);
    return postOne(embeds, attempt + 1, threadId);
  }
  return { ok: r.ok, status: r.status };
}

// Webhook post of ready-made payloads (Components V2 needs with_components=true; dropdowns won't work from webhooks).
async function postWebhookMessages(payloads) {
  let last = { ok: true, status: 204 };
  for (let i = 0; i < payloads.length; i++) {
    if (i > 0) await sleep(500);
    const base = process.env.DISCORD_WEBHOOK_URL;
    const r = await fetch(base + (base.includes('?') ? '&' : '?') + 'with_components=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ username: 'Kite Tutorials' }, payloads[i])),
    });
    last = { ok: r.ok, status: r.status };
    if (!r.ok) return last;
  }
  return last;
}

function groupEmbeds(embeds) {
  const groups = [];
  let cur = [], size = 0;
  for (const e of embeds) {
    const s = embedSize(e);
    if (cur.length && (cur.length >= 10 || size + s > 5500)) { groups.push(cur); cur = []; size = 0; }
    cur.push(e); size += s;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// Sends the embeds via the webhook (optionally into a thread), splitting across as many messages as needed.
async function postEmbeds(embeds, opts) {
  const threadId = opts && opts.threadId;
  const groups = groupEmbeds(embeds);
  let last = { ok: true, status: 204 };
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) await sleep(500);
    last = await postOne(groups[i], 0, threadId);
    if (!last.ok) return last;
  }
  return last;
}

// The channel where each user's login thread is created (override with env DISCORD_LOGS_CHANNEL_ID).
const LOGS_CHANNEL_ID = '1559522618313416755';
const logsChannelId = () => process.env.DISCORD_LOGS_CHANNEL_ID || LOGS_CHANNEL_ID;

module.exports = {
  ALLOWED_ORIGIN, OWNER_ID, sleep, clip, handleCommon, discordGet, verifyToken,
  displayName, avatarUrl, postEmbeds, postWebhookMessages, groupEmbeds, logsChannelId,
};
