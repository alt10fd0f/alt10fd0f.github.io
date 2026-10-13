// Relays "someone logged in" notifications to a Discord channel.
// Secrets (DISCORD_WEBHOOK_URL) come from environment variables, never from this file.

const ALLOWED_ORIGIN = 'https://alt10fd0f.github.io';
const DEDUPE_MS = 24 * 60 * 60 * 1000;
const seen = new Map(); // best-effort per-instance de-duplication

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: 'forbidden origin' });

  const token = req.body && req.body.token;
  if (typeof token !== 'string' || token.length < 10 || token.length > 200) {
    return res.status(400).json({ error: 'bad token' });
  }

  // 1. Ask Discord who the token belongs to and which app it was issued for.
  const auth = { headers: { Authorization: 'Bearer ' + token } };
  let me, info;
  try {
    const [meRes, appRes] = await Promise.all([
      fetch('https://discord.com/api/users/@me', auth),
      fetch('https://discord.com/api/oauth2/@me', auth),
    ]);
    if (!meRes.ok || !appRes.ok) return res.status(401).json({ error: 'invalid token' });
    me = await meRes.json();
    info = await appRes.json();
  } catch (e) {
    return res.status(502).json({ error: 'discord unreachable' });
  }
  if (!info || !info.application || info.application.id !== process.env.DISCORD_CLIENT_ID) {
    return res.status(403).json({ error: 'token is for a different app' });
  }

  // 2. De-duplicate: one message per user per 24h (per warm instance).
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
  if (seen.has(me.id)) return res.status(200).json({ ok: true, deduped: true });
  seen.set(me.id, now);

  // 3. Post to the webhook. allowed_mentions: none, so usernames can never ping anyone.
  const avatar = me.avatar
    ? 'https://cdn.discordapp.com/avatars/' + me.id + '/' + me.avatar + '.png?size=128'
    : 'https://cdn.discordapp.com/embed/avatars/' + Number((BigInt(me.id) >> 22n) % 6n) + '.png';
  try {
    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Kite Tutorials',
        allowed_mentions: { parse: [] },
        embeds: [{
          title: 'New login on the tutorial site',
          description: '**' + clip(me.global_name || me.username, 80) + '** (@' + clip(me.username, 40) + ') just logged in.',
          color: 0x94cec4,
          thumbnail: { url: avatar },
          fields: [{ name: 'User ID', value: clip(me.id, 30) }],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    return r.ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: 'webhook failed' });
  } catch (e) {
    return res.status(502).json({ error: 'webhook unreachable' });
  }
};
