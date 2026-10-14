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
      signal: AbortSignal.timeout(6000),
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

// Creates a per-user thread. In a text channel this is a public thread (needs "Create Public Threads");
// in a forum/media channel it is a forum post (needs "Create Posts"), which must start with a message.
const channelTypes = new Map();
async function createThread(channelId, name) {
  let type = channelTypes.get(channelId);
  if (type === undefined) {
    const c = await call('GET', '/channels/' + channelId);
    if (c.ok && c.json) { type = c.json.type; channelTypes.set(channelId, type); }
    else console.error('thread: cannot read channel', channelId, c.status, JSON.stringify(c.json));
  }
  const title = clip(String(name).replace(/\s+/g, ' '), 100);
  const body = { name: title, auto_archive_duration: 10080 };
  if (type === 15 || type === 16) body.message = { content: 'Login log for ' + title, allowed_mentions: { parse: [] } };
  else body.type = 11;
  const r = await call('POST', '/channels/' + channelId + '/threads', body);
  if (!r.ok) console.error('thread: create failed', r.status, JSON.stringify(r.json));
  return r;
}

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

// Posts ready-made message payloads (e.g. Components V2) one after another into a channel/thread as the bot.
async function postMessagesTo(channelId, payloads) {
  let last = { ok: true, status: 200 };
  for (let i = 0; i < payloads.length; i++) {
    if (i > 0) await sleep(500);
    last = await call('POST', '/channels/' + channelId + '/messages', payloads[i]);
    if (last.status === 429) { await sleep(1500); last = await call('POST', '/channels/' + channelId + '/messages', payloads[i]); }
    if (!last.ok) return last;
  }
  return last;
}

module.exports = { postMessagesTo, postEmbedsTo, configured, hasToken, call, sendDM, postToChannel, createThread, guildId };
