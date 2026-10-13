// Discord bot API helpers for modmail and per-user login threads.
// Secrets come from environment variables only: DISCORD_BOT_TOKEN (private), DISCORD_MODMAIL_CHANNEL_ID.

const { clip, groupEmbeds, sleep } = require('./_shared');
const API = 'https://discord.com/api/v10';

const configured = () => !!(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_MODMAIL_CHANNEL_ID);
const hasToken = () => !!process.env.DISCORD_BOT_TOKEN;

async function call(method, path, body) {
  try {
    const r = await fetch(API + path, {
      method,
      headers: {
        Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://alt10fd0f.github.io, 1.0)',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2500),
    });
    let json = null;
    try { json = await r.json(); } catch (e) { /* empty body */ }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null };
  }
}

const dmChannels = new Map(); // userId -> DM channel id (best-effort cache per warm instance)

// Sends a DM to a user. Fails (ok:false) if they have DMs closed and share no server with the bot.
async function sendDM(userId, payload) {
  let id = dmChannels.get(userId);
  if (!id) {
    const c = await call('POST', '/users/@me/channels', { recipient_id: userId });
    if (!c.ok || !c.json || !c.json.id) return c;
    id = c.json.id;
    dmChannels.set(userId, id);
  }
  // allowed_mentions: none, so user-supplied text can never ping anyone.
  return call('POST', '/channels/' + id + '/messages', Object.assign({ allowed_mentions: { parse: [] } }, payload));
}

const postToChannel = (payload) =>
  call('POST', '/channels/' + process.env.DISCORD_MODMAIL_CHANNEL_ID + '/messages', Object.assign({ allowed_mentions: { parse: [] } }, payload));

// Creates a public thread (not attached to a message) in a text channel. Needs "Create Public Threads".
const createThread = (channelId, name) =>
  call('POST', '/channels/' + channelId + '/threads', {
    name: clip(String(name).replace(/\s+/g, ' '), 100),
    type: 11,
    auto_archive_duration: 10080,
  });

// The server id of the modmail channel (used to build message links). Cached.
let guildCache = null;
async function guildId() {
  if (guildCache) return guildCache;
  const r = await call('GET', '/channels/' + process.env.DISCORD_MODMAIL_CHANNEL_ID);
  if (r.ok && r.json && r.json.guild_id) guildCache = r.json.guild_id;
  return guildCache;
}

// Posts embeds (split across messages as needed) into any channel or thread as the bot.
async function postEmbedsTo(channelId, embeds) {
  let last = { ok: true, status: 200 };
  const groups = groupEmbeds(embeds);
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) await sleep(500);
    last = await call('POST', '/channels/' + channelId + '/messages', { allowed_mentions: { parse: [] }, embeds: groups[i] });
    if (last.status === 429) { await sleep(1500); last = await call('POST', '/channels/' + channelId + '/messages', { allowed_mentions: { parse: [] }, embeds: groups[i] }); }
    if (!last.ok) return last;
  }
  return last;
}

module.exports = { postEmbedsTo, configured, hasToken, call, sendDM, postToChannel, createThread, guildId };
