// Discord Interactions endpoint (set this URL in the Developer Portal under
// General Information -> Interactions Endpoint URL). Handles the modmail Reply buttons and modals.
// Every request is verified against DISCORD_PUBLIC_KEY (Ed25519) before anything else happens.

import crypto from 'node:crypto';
import bot from './_bot.js';
import embeds from './_embeds.js';
import db from './_db.js';
import tickets from './_tickets.js';

const track = async (id, patchFn) => { if (!db.ready() || !id) return; try { const t = await tickets.getTicket(id); if (t) await tickets.updateTicket(id, patchFn(t)); } catch (e) { /* best effort */ } };

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // wraps a raw 32-byte Ed25519 public key
const ID = /^\d{5,25}$/;
const EPHEMERAL = 64;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const ephemeral = (content) => ({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

function verifyWith(keyHex, raw, sigHex, ts) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(keyHex || '') || !/^[0-9a-f]{128}$/i.test(sigHex)) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(keyHex, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(ts + raw), key, Buffer.from(sigHex, 'hex'));
  } catch (e) {
    return false;
  }
}

// The env key is tried first. If it is missing or wrong, the bot's own application key is fetched from Discord
// (authoritative for this bot) so a mistyped DISCORD_PUBLIC_KEY can no longer break every button.
let appKey = null;
async function verify(raw, sigHex, ts) {
  if (verifyWith(process.env.DISCORD_PUBLIC_KEY, raw, sigHex, ts)) return true;
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  if (!appKey) {
    const r = await bot.call('GET', '/applications/@me');
    if (r.ok && r.json && r.json.verify_key) appKey = r.json.verify_key;
  }
  return verifyWith(appKey, raw, sigHex, ts);
}

const recent = new Map(); // userId -> timestamps, best-effort per warm instance
function limited(userId) {
  const now = Date.now();
  const t = (recent.get(userId) || []).filter((x) => now - x < 3600000);
  const blocked = t.length >= 20 || (t.length && now - t[t.length - 1] < 3000);
  if (!blocked) { t.push(now); recent.set(userId, t); }
  return blocked;
}

const modal = (customId, title, label, placeholder) => ({
  type: 9,
  data: {
    custom_id: customId,
    title,
    components: [{
      type: 1,
      components: [{ type: 4, custom_id: 'text', style: 2, label, min_length: 1, max_length: 1500, required: true, placeholder }],
    }],
  },
});

const textOf = (it) => {
  const row = it.data && it.data.components && it.data.components[0];
  const field = row && row.components && row.components[0];
  return field && typeof field.value === 'string' ? field.value.trim() : '';
};
const modName = (m) => (m && ((m.nick) || (m.user && (m.user.global_name || m.user.username)))) || 'staff';

const fit = (lines, head, max) => {
  let out = head, shown = 0;
  for (const l of lines) { if ((out + '\n' + l).length > max - 40) break; out += '\n' + l; shown++; }
  return shown < lines.length ? out + '\n…and ' + (lines.length - shown) + ' more' : out;
};
const yn = (v) => (v ? 'Yes' : 'No');
function reportText(pick, r) {
  const when = r.at ? '\n-# Saved at their last login: <t:' + Math.floor(r.at / 1000) + ':R>' : '';
  if (pick === 'servers') {
    if (!r.guilds) return 'Their server list was not shared (the servers permission was not granted).';
    const lines = r.guilds.map((g) => '• ' + g.name.replace(/[`*_~|>]/g, '') + ' (`' + g.id + '`)' + (g.owner ? ' 👑 owner' : ''));
    return fit(lines, '**Servers (' + (r.guildCount != null ? r.guildCount : r.guilds.length) + ')**', 1900 - when.length) + when;
  }
  if (pick === 'connections') {
    if (!r.connections) return 'Their connected accounts were not shared.';
    if (!r.connections.length) return '**Connected accounts**\nNone' + when;
    const lines = r.connections.map((c) => '• ' + c.type + ': ' + c.name.replace(/[`*_~|>]/g, '') + (c.verified ? ' (verified)' : '') + (c.hidden ? ' [hidden]' : ''));
    return fit(lines, '**Connected accounts (' + r.connections.length + ')**', 1900 - when.length) + when;
  }
  const o = r.other || {};
  const lines = [
    'Username • `@' + (o.handle || '?') + '`',
    'Discord display name • ' + (o.globalName || 'None set'),
    'Name used on this site • ' + (o.siteName || 'Same as Discord'),
    'Email verified by Discord • ' + yn(o.emailVerified) + ' (shared in reports: ' + yn(o.emailShared) + ')',
    'Locale • ' + (o.locale || 'unknown'),
    'Badges • ' + ((o.badges || []).length ? o.badges.join(', ') : 'None'),
    'Accent color • ' + (o.accentColor ? '`' + o.accentColor + '`' : 'None'),
    'Avatar • ' + (o.avatar || 'Default'),
    'Banner • ' + (o.banner || 'None'),
    'Servers • ' + (r.guildCount != null ? r.guildCount : 'Not shared') + ' · Connected accounts • ' + (r.connections ? r.connections.length : 'Not shared'),
    'First seen on site • ' + (o.firstSeen ? '<t:' + Math.floor(o.firstSeen / 1000) + ':F>' : 'unknown'),
    'Logins • ' + (o.logins || 1),
    'Permissions granted • ' + ((o.scopes || []).join(', ') || 'unknown'),
  ];
  return fit(lines, '**Other data**', 1900 - when.length) + when;
}

async function handle(it) {
  if (it.type === 1) return { type: 1 }; // PING

  const channelOk = it.channel_id === process.env.DISCORD_MODMAIL_CHANNEL_ID;
  const parts = String((it.data && it.data.custom_id) || '').split(':');
  // Login report dropdown: shows small facts about that user, only to whoever picked the option.
  if (parts[0] === 'lg' && it.type === 3 && ID.test(parts[1] || '')) {
    const uid = parts[1];
    const pick = it.data.values && it.data.values[0];
    const created = Math.floor((Number(BigInt(uid) >> 22n) + 1420070400000) / 1000);
    const simple = {
      id: '`' + uid + '`',
      mention: '`<@' + uid + '>`',
      age: 'Account created <t:' + created + ':F> (<t:' + created + ':R>)',
      link: 'https://discord.com/users/' + uid,
    }[pick];
    if (simple) return ephemeral(simple);
    if (pick === 'servers' || pick === 'connections' || pick === 'other') {
      let r = null;
      try { r = db.ready() ? await db.getJSON('report:' + uid) : null; } catch (e) { r = null; }
      if (!r) return ephemeral('No stored data for this user yet. They may have logged in before this was added, or their data was deleted.');
      return ephemeral(reportText(pick, r));
    }
    return ephemeral('Unknown option.');
  }
  if (parts[0] !== 'mm') return ephemeral('Unknown action.');

  // ---- Button clicks ----
  if (it.type === 3) {
    if (parts[1] === 'r') { // staff: open reply modal
      if (!channelOk || !ID.test(parts[2] || '') || !it.message) return ephemeral('This button cannot be used here.');
      return modal('mm:rs:' + parts[2] + ':' + it.message.id, 'Reply to user', 'Your reply', 'This will be sent to the user as a DM.');
    }
    if (parts[1] === 'c') { // staff: close the ticket
      if (!channelOk || !ID.test(parts[2] || '') || !it.message) return ephemeral('This button cannot be used here.');
      const staff = modName(it.member);
      const ref = it.message.message_reference && it.message.message_reference.message_id;
      const ticketId = ref && ID.test(ref) ? ref : it.message.id;
      await bot.sendDM(parts[2], embeds.closedDM(staff));
      await track(ticketId, (t) => ({ status: 'closed', closedBy: staff, updated: Date.now() }));
      const orig = (it.message.embeds && it.message.embeds[0]) || { title: 'Support request' };
      if (ticketId === it.message.id) return { type: 7, data: embeds.closedTicket(orig, staff) };
      // Closed from a user's reply: grey out the original ticket message too.
      const ch = process.env.DISCORD_MODMAIL_CHANNEL_ID;
      const og = await bot.call('GET', '/channels/' + ch + '/messages/' + ticketId);
      if (og.ok && og.json && og.json.embeds && og.json.embeds[0]) await bot.call('PATCH', '/channels/' + ch + '/messages/' + ticketId, embeds.closedTicket(og.json.embeds[0], staff));
      return { type: 7, data: { components: [] } };
    }
    if (parts[1] === 'u') { // user: open reply modal
      if (!ID.test(parts[2] || '')) return ephemeral('This button cannot be used here.');
      return modal('mm:us:' + parts[2], 'Reply to support', 'Your message', 'This will be sent to the support team.');
    }
  }

  // ---- Modal submissions ----
  if (it.type === 5) {
    const text = textOf(it);
    if (!text) return ephemeral('Your message was empty.');

    if (parts[1] === 'rs') { // staff reply -> DM the user
      if (!channelOk || !ID.test(parts[2] || '') || !ID.test(parts[3] || '')) return ephemeral('This action cannot be used here.');
      const dm = await bot.sendDM(parts[2], embeds.staffReplyDM(modName(it.member), text, parts[3]));
      if (!dm.ok) return ephemeral('Could not DM that user (they may have DMs closed). Your reply was not sent.');
      await track(parts[3], (t) => ({ replies: (t.replies || 0) + 1, updated: Date.now(), status: 'open' }));
      return { type: 4, data: embeds.staffReplyLog(modName(it.member), parts[2], text) };
    }

    if (parts[1] === 'us') { // user reply -> mod channel
      const user = it.user || (it.member && it.member.user);
      if (!user || !ID.test(parts[2] || '')) return ephemeral('This action cannot be used here.');
      if (limited(user.id)) return { type: 4, data: { content: 'You are replying too quickly. Please wait a moment and try again.' } };
      const post = await bot.postToChannel(embeds.userReplyChannel(user, text, parts[2]));
      if (!post.ok) return { type: 4, data: { content: 'Sorry, your reply could not be delivered. Please try again.' } };
      await track(parts[2], (t) => ({ replies: (t.replies || 0) + 1, updated: Date.now(), status: 'open' }));
      return { type: 4, data: { content: 'Your reply was sent to the support team.' } };
    }
  }

  return ephemeral('Unknown action.');
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const raw = await request.text();
    const sig = request.headers.get('x-signature-ed25519') || '';
    const ts = request.headers.get('x-signature-timestamp') || '';
    if (!ts || !(await verify(raw, sig, ts))) return new Response('invalid request signature', { status: 401 });

    let it;
    try { it = JSON.parse(raw); } catch (e) { return new Response('bad request', { status: 400 }); }
    try {
      return json(await handle(it));
    } catch (e) {
      return json(ephemeral('Something went wrong. Please try again.'));
    }
  },
};
