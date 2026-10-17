// Login notification. After a visitor logs in with Discord this:
//   - reads their server list (to check Kite membership and to keep a copy for the login report's dropdown),
//   - records/updates their profile in the database,
//   - posts the (admin-editable) login embed into that user's own thread, creating the thread on first login.

const db = require('./_db');
const bot = require('./_bot');
const { clip, handleCommon, discordGet, verifyToken, displayName, avatarUrl, postWebhookMessages, logsChannelId } = require('./_shared');
const { getProfile, saveProfile } = require('./_auth');
const { loadConfig, buildLoginMessages } = require('./_config');
const logs = require('./_logs');

const NITRO = { 0: 'None', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' };
const yesNo = (v) => (v ? 'Yes' : 'No');
const recent = new Map(); // userId -> last notify time (used when no database is connected)

const next_firstSeen = (p, now) => (p && p.firstSeen) || now;
const safeJson = async (p) => { try { const r = await p; return r && r.ok ? await r.json() : null; } catch (e) { return null; } };

// The user's servers ({id, name, owner}), or null when they can't be read. Reads page by page (up to 1000 servers).
async function fetchGuilds(token) {
  const out = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const list = await safeJson(discordGet('/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''), token));
    if (!list) return page === 0 ? null : out;
    list.forEach((g) => out.push({ id: String(g.id), name: clip(g.name, 60), owner: !!g.owner }));
    if (list.length < 200) return out;
    after = list[list.length - 1].id;
  }
  return out;
}

const BADGES = { 1: 'Discord Staff', 2: 'Partnered Server Owner', 4: 'HypeSquad Events', 8: 'Bug Hunter', 64: 'HypeSquad Bravery', 128: 'HypeSquad Brilliance', 256: 'HypeSquad Balance', 512: 'Early Supporter', 16384: 'Bug Hunter Level 2', 65536: 'Verified Bot', 131072: 'Early Verified Bot Developer', 262144: 'Moderator Programs Alumni', 4194304: 'Active Developer' };
const badgesOf = (flags) => Object.keys(BADGES).filter((k) => (Number(flags) & Number(k)) !== 0).map((k) => BADGES[k]);

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

  const guilds = has('guilds') ? await fetchGuilds(token) : null; // third-party connections are deliberately not requested

  const target = process.env.KITE_GUILD_ID || '845800518458540083'; // Kite support server
  const kite = guilds ? guilds.some((g) => g.id === target) : null;
  const prefs = profile || {};
  const name = prefs.nickname || displayName(me);
  const created = Math.floor((Number(BigInt(me.id) >> 22n) + 1420070400000) / 1000);
  const vars = {
    display: clip(name, 80),
    username: clip(me.username, 40),
    id: me.id,
    mention: '<@' + me.id + '>',
    email: prefs.shareEmail === false ? 'Hidden by user' : me.email ? clip(me.email, 200) + (me.verified ? ' (verified)' : ' (unverified)') : 'Not provided',
    created: '<t:' + created + ':F>',
    createdAgo: '<t:' + created + ':R>',
    locale: clip(me.locale || 'unknown', 20),
    mfa: yesNo(me.mfa_enabled),
    nitro: NITRO[me.premium_type] || 'None',
    kiteServer: kite === true ? 'Member' : kite === false ? 'Not a member' : 'Not checked',
  };

  const cfg = await loadConfig();
  const botMode = bot.hasToken() && dbOn;
  const useBuiltin = logs.wants(cfg, 'login', 'builtin');
  const useHook = logs.wants(cfg, 'login', 'webhook');
  const messages = buildLoginMessages(cfg.loginMessage, vars, avatarUrl(me), me.id, { interactive: botMode });
  const plain = buildLoginMessages(cfg.loginMessage, vars, avatarUrl(me), me.id, { interactive: false }); // webhooks can't have working dropdowns

  // Save the profile first so a failed post doesn't lose the thread id we are about to create.
  const next = Object.assign({ firstSeen: now, shareEmail: true }, profile, {
    id: me.id, username: me.username, display: displayName(me), avatar: me.avatar || null, lastSeen: now, lastLogin: now,
    loginCount: ((profile && profile.loginCount) || 0) + 1,
  });
  // Copy kept for the login report's dropdown (servers, other data). Replaced on every login.
  const report = {
    at: now,
    guilds: guilds ? guilds.slice(0, 300) : null,
    guildCount: guilds ? guilds.length : null,
    other: {
      handle: me.username, globalName: me.global_name || null, siteName: name, emailVerified: !!me.verified, emailShared: prefs.shareEmail !== false,
      locale: me.locale || null, badges: badgesOf(me.public_flags), accentColor: typeof me.accent_color === 'number' ? '#' + me.accent_color.toString(16).padStart(6, '0') : null,
      avatar: avatarUrl(me), banner: me.banner ? 'https://cdn.discordapp.com/banners/' + me.id + '/' + me.banner + '.png' : null,
      scopes: v.scopes, firstSeen: next_firstSeen(prefs, now), logins: ((profile && profile.loginCount) || 0) + 1,
    },
  };

  // Webhook trigger (chosen in the admin panel): Discord webhooks get the message, other URLs get JSON.
  let hook = null;
  if (useHook) {
    hook = await logs.sendWebhook(logs.urlOf(cfg, 'login'), {
      event: 'login', discord: plain,
      data: { id: me.id, username: me.username, display: name, mention: vars.mention, email: vars.email, created: created, mfa: vars.mfa, nitro: vars.nitro, kiteServer: vars.kiteServer },
    });
    if (!hook.ok) console.error('login webhook trigger failed', hook.status);
  }

  // Built-in logs: one thread per user, created in the logs channel; its id is stored and every later login goes only to that thread.
  // Posts are made by the bot (a webhook can only post in its own channel's threads).
  const makeThread = async () => {
    const t = await bot.createThread(logsChannelId(), clip(name, 70) + ' (' + me.id + ')');
    return t.ok && t.json && t.json.id ? t.json.id : null;
  };

  let threadId = next.threadId || null;
  let r = { ok: true };
  if (useBuiltin) {
    if (botMode) {
      if (!threadId) threadId = await makeThread();
      r = threadId ? await bot.postMessagesTo(threadId, messages) : { ok: false };
      if (!r.ok && threadId && (r.status === 404 || r.status === 403 || r.status === 400)) {
        // The stored thread was deleted/locked: make a new one and remember it.
        threadId = await makeThread();
        r = threadId ? await bot.postMessagesTo(threadId, messages) : { ok: false };
      }
      if (!r.ok) {
        console.error('login post via bot failed', r.status, JSON.stringify(r.json));
        threadId = next.threadId || null; // keep the old id if we couldn't replace it
        if (!useHook) r = await postWebhookMessages(plain); // never lose the report: fall back to the env webhook (no dropdown)
      }
    } else if (!useHook) {
      r = await postWebhookMessages(plain); // no bot/database configured: plain webhook post (no dropdown)
    }
  }
  if (!useBuiltin && hook && !hook.ok) r = hook;
  next.threadId = threadId;
  if (dbOn) { try { await saveProfile(next); } catch (e) { /* keep going */ } try { await db.setJSON('report:' + me.id, report); } catch (e) { /* keep going */ } }

  if (!r.ok && !(hook && hook.ok)) return res.status(502).json({ error: 'webhook failed' });
  return res.status(200).json({ ok: true, thread: !!threadId });
};
