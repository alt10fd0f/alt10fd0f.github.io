// Cloudflare Worker: relays "someone logged in" notifications to a Discord channel.
// The webhook URL lives ONLY here as a secret, never in the website code.
//
// Required secret:   DISCORD_WEBHOOK_URL   (your channel's webhook URL)
// Required variable: DISCORD_CLIENT_ID     (your Discord application's Client ID)
// Optional KV binding named SEEN: if present, each user triggers at most one message per 24h.

const ALLOWED_ORIGIN = 'https://alt10fd0f.github.io';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};
const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clip = (s, n) => String(s ?? '').slice(0, n);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'method not allowed' });
    if (request.headers.get('Origin') !== ALLOWED_ORIGIN) return reply(403, { error: 'forbidden origin' });

    let token;
    try { ({ token } = await request.json()); } catch { return reply(400, { error: 'bad json' }); }
    if (typeof token !== 'string' || token.length < 10 || token.length > 200) return reply(400, { error: 'bad token' });

    // 1. Ask Discord who this token belongs to and which app it was issued for.
    const auth = { headers: { Authorization: 'Bearer ' + token } };
    const [meRes, appRes] = await Promise.all([
      fetch('https://discord.com/api/users/@me', auth),
      fetch('https://discord.com/api/oauth2/@me', auth),
    ]);
    if (!meRes.ok || !appRes.ok) return reply(401, { error: 'invalid token' });
    const user = await meRes.json();
    const info = await appRes.json();
    if (info?.application?.id !== env.DISCORD_CLIENT_ID) return reply(403, { error: 'token is for a different app' });

    // 2. Optional de-duplication so one account can't spam the channel.
    if (env.SEEN) {
      if (await env.SEEN.get(user.id)) return reply(200, { ok: true, deduped: true });
      await env.SEEN.put(user.id, '1', { expirationTtl: 86400 });
    }

    // 3. Post to the webhook. allowed_mentions: none, so a username can never ping @everyone.
    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Kite Tutorials',
        allowed_mentions: { parse: [] },
        embeds: [{
          title: 'New login on the tutorial site',
          description: `**${clip(user.global_name || user.username, 80)}** (@${clip(user.username, 40)}) just logged in.`,
          color: 0x94cec4,
          thumbnail: { url: avatar },
          fields: [{ name: 'User ID', value: clip(user.id, 30) }],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    return res.ok ? reply(200, { ok: true }) : reply(502, { error: 'webhook failed' });
  },
};
