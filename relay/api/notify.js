const db = require('./_db');
const bot = require('./_bot');
const { clip, handleCommon, discordGet, verifyToken, displayName, avatarUrl, postEmbeds, logsChannelId } = require('./_shared');
const { getProfile, saveProfile } = require('./_auth');

const NITRO = { 0: 'None', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' };
const yesNo = (v) => (v ? 'Yes' : 'No');
const recent = new Map();

const safeJson = async (p) => { try { const r = await p; return r && r.ok ? await r.json() : null; } catch (e) { return null; } };

async function inKiteServer(token) {
  const target = process.env.KITE_GUILD_ID;
  if (!target) return null;
  let after = '';
  for (let page = 0; page < 5; page++) {
    const list = await safeJson(discordGet('/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''), token));
    if (!list) return page === 0 ? null : false;
    if (list.some((g) => g.id === target)) return true;
    if (list.length < 200) return false;
    after = list[list.length - 1].id;
  }
  return false;
}

function buildLoginMessage(vars, avatar) {
  const content =
    '**User**\n' +
    '> ' + vars.mention + ' [`' + vars.id + '`]\n\n' +
    '**Account Data**\n' +
    '>>> Email • ||' + vars.email + '||\n' +
    'Created At • ' + vars.created + ' (' + vars.createdAgo + ')\n' +
    'Connections • ' + vars.connectionCount + '\n' +
    '2FA Enabled • ' + vars.mfa + '\n' +
    'Kite Server • ' + vars.kiteServer + '\n' +
    'Nitro • ' + vars.nitro + '\n' +
    'Locale • ' + vars.locale + '\n' +
    'Connected Accounts •\n' + vars.connections;

  return {
    flags: 32768,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        components: [
          {
            type: 9,
            components: [
              {
                type: 10,
                content: content.slice(0, 4000),
              },
            ],
            accessory: {
              type: 11,
              media: {
                url: avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
              },
            },
          },
          {
            type: 14,
            spacing: 2,
          },
        ],
      },
    ],
  };
}

async function postComponentsTo(channelId, payload) {
  if (!bot.hasToken || !bot.hasToken()) return { ok: false, status: 0 };
  return bot.call('POST', '/channels/' + channelId + '/messages', payload);
}

async function postComponentsWebhook(payload) {
  const base = process.env.DISCORD_WEBHOOK_URL;
  if (!base) return { ok: false, status: 0 };
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ username: 'Kite Tutorials' }, payload)),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const token = req.body && req.body.token;
  const v = await verifyToken(token);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const me = v.me;
  const has = (s) => v.scopes.includes(s);
  const dbOn = db.ready();
  const now = Date.now();

  let profile = null;
  if (dbOn) { try { profile = await getProfile(me.id); } catch (e) { profile = null; } }
  const last = profile && profile.lastLogin ? profile.lastLogin : recent.get(me.id) || 0;
  if (now - last < 30000) return res.status(200).json({ ok: true, throttled: true });
  recent.set(me.id, now);
  if (recent.size > 1000) recent.clear();

  const [kite, connections] = await Promise.all([
    has('guilds') ? inKiteServer(token) : null,
    has('connections') ? safeJson(discordGet('/users/@me/connections', token)) : null,
  ]);

  const prefs = profile || {};
  const name = prefs.nickname || displayName(me);
  const created = Math.floor((Number(BigInt(me.id) >> 22n) + 1420070400000) / 1000);
  const connLines = (connections || []).map((c) =>
    '• ' + clip(c.type, 20) + ': ' + clip(c.name, 60) +
    (c.verified ? ' (verified)' : '') +
    (c.visibility === 0 ? ' [hidden]' : '')
  );
  let connText = connLines.length ? connLines.join('\n') : connections ? 'None' : 'Not shared';
  if (connText.length > 1000) {
    connText = connText.slice(0, connText.lastIndexOf('\n', 980)) +
      '\n…and ' + (connLines.length - connText.slice(0, connText.lastIndexOf('\n', 980)).split('\n').length) + ' more';
  }

  const vars = {
    display: clip(name, 80),
    username: clip(me.username, 40),
    id: me.id,
    mention: '<@' + me.id + '>',
    email: prefs.shareEmail === false
      ? 'Hidden by user'
      : me.email
        ? clip(me.email, 200) + (me.verified ? ' (verified)' : ' (unverified)')
        : 'Not provided',
    created: '<t:' + created + ':F>',
    createdAgo: '<t:' + created + ':R>',
    locale: clip(me.locale || 'unknown', 20),
    mfa: yesNo(me.mfa_enabled),
    nitro: NITRO[me.premium_type] || 'None',
    kiteServer: kite === true ? 'Member' : kite === false ? 'Not a member' : 'Not checked',
    connectionCount: connections ? String(connections.length) : 'n/a',
    connections: connText,
  };

  const avatar = avatarUrl(me);
  const payload = buildLoginMessage(vars, avatar);

  const next = Object.assign({ firstSeen: now, shareEmail: true }, profile, {
    id: me.id,
    username: me.username,
    display: displayName(me),
    avatar: me.avatar || null,
    lastSeen: now,
    lastLogin: now,
  });

  const makeThread = async () => {
    const t = await bot.createThread(logsChannelId(), clip(name, 70) + ' (' + me.id + ')');
    return t.ok && t.json && t.json.id ? t.json.id : null;
  };

  let threadId = next.threadId || null;
  let r;

  if (bot.hasToken() && dbOn) {
    if (!threadId) threadId = await makeThread();
    r = threadId ? await postComponentsTo(threadId, payload) : { ok: false };
    if (!r.ok && threadId && (r.status === 404 || r.status === 403 || r.status === 400)) {
      threadId = await makeThread();
      r = threadId ? await postComponentsTo(threadId, payload) : { ok: false };
    }
    if (!r.ok) threadId = next.threadId || null;
  } else {
    r = await postComponentsWebhook(payload);
    threadId = next.threadId || null;
  }

  next.threadId = threadId;
  if (dbOn) { try { await saveProfile(next); } catch (e) {} }

  if (!r.ok) return res.status(502).json({ error: 'webhook failed' });
  return res.status(200).json({ ok: true, thread: !!threadId });
};
