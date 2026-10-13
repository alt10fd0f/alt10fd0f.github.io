// Discord Interactions endpoint (set this URL in the Developer Portal under
// General Information -> Interactions Endpoint URL). Handles the modmail Reply buttons and modals.
// Every request is verified against DISCORD_PUBLIC_KEY (Ed25519) before anything else happens.

import crypto from 'node:crypto';
import bot from './_bot.js';
import embeds from './_embeds.js';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // wraps a raw 32-byte Ed25519 public key
const ID = /^\d{5,25}$/;
const EPHEMERAL = 64;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const ephemeral = (content) => ({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

function verify(raw, sigHex, ts) {
  try {
    const keyHex = process.env.DISCORD_PUBLIC_KEY || '';
    if (!/^[0-9a-f]{64}$/i.test(keyHex) || !/^[0-9a-f]{128}$/i.test(sigHex)) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(keyHex, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(ts + raw), key, Buffer.from(sigHex, 'hex'));
  } catch (e) {
    return false;
  }
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

async function handle(it) {
  if (it.type === 1) return { type: 1 }; // PING

  const channelOk = it.channel_id === process.env.DISCORD_MODMAIL_CHANNEL_ID;
  const parts = String((it.data && it.data.custom_id) || '').split(':');
  if (parts[0] !== 'mm') return ephemeral('Unknown action.');

  // ---- Button clicks ----
  if (it.type === 3) {
    if (parts[1] === 'r') { // staff: open reply modal
      if (!channelOk || !ID.test(parts[2] || '') || !it.message) return ephemeral('This button cannot be used here.');
      return modal('mm:rs:' + parts[2] + ':' + it.message.id, 'Reply to user', 'Your reply', 'This will be sent to the user as a DM.');
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
      return { type: 4, data: embeds.staffReplyLog(modName(it.member), parts[2], text) };
    }

    if (parts[1] === 'us') { // user reply -> mod channel
      const user = it.user || (it.member && it.member.user);
      if (!user || !ID.test(parts[2] || '')) return ephemeral('This action cannot be used here.');
      if (limited(user.id)) return { type: 4, data: { content: 'You are replying too quickly. Please wait a moment and try again.' } };
      const post = await bot.postToChannel(embeds.userReplyChannel(user, text, parts[2]));
      if (!post.ok) return { type: 4, data: { content: 'Sorry, your reply could not be delivered. Please try again.' } };
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
    if (!ts || !verify(raw, sig, ts)) return new Response('invalid request signature', { status: 401 });

    let it;
    try { it = JSON.parse(raw); } catch (e) { return new Response('bad request', { status: 400 }); }
    try {
      return json(await handle(it));
    } catch (e) {
      return json(ephemeral('Something went wrong. Please try again.'));
    }
  },
};
