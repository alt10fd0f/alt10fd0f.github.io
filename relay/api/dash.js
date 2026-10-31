// Bot dashboard API. Body { token, action, ... } with a Discord token that includes the "guilds" scope.
// Visitors only ever see servers they own or manage (Manage Server / Administrator). Settings are stored per server in Redis
// ("dash:guild:<id>"). The bot reads them with GET /api/dash?guild=<id> and the header "Authorization: Bearer <DASH_API_SECRET>".

const crypto = require('crypto');
const db = require('./_db');
const bot = require('./_bot');
const { authenticate } = require('./_auth');
const { handleCommon, OWNER_ID, discordGet, displayName } = require('./_shared');

const ID = /^\d{5,25}$/;
const MANAGE = 0x20n, ADMIN = 0x8n;
const hits = new Map();
const guildCache = new Map(); // user token -> { at, list }
let botGuilds = { at: 0, ids: new Set() };

const str = (v, n) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, n) : '');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const fail = (res, s, e) => res.status(s).json({ error: e });

async function myGuilds(token) {
  const hit = guildCache.get(token);
  if (hit && Date.now() - hit.at < 60000) return hit.list;
  const r = await discordGet('/users/@me/guilds', token);
  if (!r.ok) throw Object.assign(new Error('discord'), { status: r.status });
  const all = await r.json();
  const list = all.filter((g) => g.owner || (BigInt(g.permissions || 0) & (MANAGE | ADMIN)) !== 0n)
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: !!g.owner }));
  if (guildCache.size > 300) guildCache.clear();
  guildCache.set(token, { at: Date.now(), list });
  return list;
}

async function botIn() {
  if (!bot.hasToken()) return null;
  if (Date.now() - botGuilds.at < 60000) return botGuilds.ids;
  const ids = new Set(); let after = '';
  for (let i = 0; i < 10; i++) {
    const r = await bot.call('GET', '/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''));
    if (!r.ok || !Array.isArray(r.json)) break;
    r.json.forEach((g) => ids.add(g.id));
    if (r.json.length < 200) break; after = r.json[r.json.length - 1].id;
  }
  botGuilds = { at: Date.now(), ids };
  return ids;
}

const DEFAULTS = { prefix: '!', welcome: { enabled: false, channelId: '', message: 'Welcome {user} to {server}!' }, logs: { channelId: '' } };
const getConfig = async (id) => { const c = (await db.getJSON('dash:guild:' + id)) || {}; return { prefix: c.prefix || DEFAULTS.prefix, welcome: Object.assign({}, DEFAULTS.welcome, c.welcome), logs: Object.assign({}, DEFAULTS.logs, c.logs), updated: c.updated || 0, updatedBy: c.updatedBy || '' }; };

module.exports = async (req, res) => {
  if (!db.ready()) return fail(res, 503, 'database not configured');

  // The bot fetching a server's settings (machine to machine).
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const secret = process.env.DASH_API_SECRET || '';
    const given = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
    if (secret.length < 16 || !safeEq(given, secret)) return fail(res, 401, 'unauthorized');
    const g = String((req.query && req.query.guild) || '');
    if (!ID.test(g)) return fail(res, 400, 'bad guild id');
    const [cfg, prem] = await Promise.all([getConfig(g), db.cmd('SISMEMBER', 'dash:premium', g)]);
    return res.status(200).json({ guild: g, premium: Number(prem) === 1, config: cfg });
  }

  if (handleCommon(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const v = await authenticate(req, res);
  if (!v) return;
  if (!(v.scopes || []).includes('guilds')) return fail(res, 403, 'Please sign in again and allow the servers permission.');
  const me = v.me, b = req.body || {}, a = String(b.action || '');

  const now = Date.now(), t = (hits.get(me.id) || []).filter((x) => now - x < 60000);
  if (t.length >= 90) return fail(res, 429, 'Too many requests. Slow down.');
  t.push(now); hits.set(me.id, t); if (hits.size > 2000) hits.clear();

  try {
    const mine = await myGuilds(b.token);
    const find = (id) => mine.find((g) => g.id === String(id || ''));

    switch (a) {
      case 'servers': {
        const [present, pins, prem] = await Promise.all([botIn(), db.cmd('SMEMBERS', 'dash:pins:' + me.id), db.cmd('SMEMBERS', 'dash:premium')]);
        const guilds = mine.map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner, premium: (prem || []).includes(g.id), botIn: present ? present.has(g.id) : null, pinned: (pins || []).includes(g.id) }));
        return res.status(200).json({ user: { id: me.id, name: displayName(me), avatar: me.avatar }, guilds, clientId: process.env.DISCORD_CLIENT_ID || '', isOwner: me.id === OWNER_ID });
      }
      case 'pin': {
        const g = find(b.id); if (!g) return fail(res, 404, 'Server not found.');
        await db.cmd(b.pinned ? 'SADD' : 'SREM', 'dash:pins:' + me.id, g.id); return res.status(200).json({ ok: true });
      }
      case 'guild': {
        const g = find(b.id); if (!g) return fail(res, 404, 'You can\'t manage that server.');
        const present = await botIn();
        const inGuild = present ? present.has(g.id) : false;
        let channels = [], roles = [];
        if (inGuild) {
          const c = await bot.call('GET', '/guilds/' + g.id + '/channels');
          if (c.ok && Array.isArray(c.json)) channels = c.json.filter((x) => x.type === 0 || x.type === 5).map((x) => ({ id: x.id, name: x.name })).slice(0, 300);
        }
        const [cfg, prem] = await Promise.all([getConfig(g.id), db.cmd('SISMEMBER', 'dash:premium', g.id)]);
        return res.status(200).json({ guild: Object.assign({}, g, { premium: Number(prem) === 1, botIn: inGuild }), channels, roles, config: cfg });
      }
      case 'save': {
        const g = find(b.id); if (!g) return fail(res, 404, 'You can\'t manage that server.');
        const c = b.config && typeof b.config === 'object' ? b.config : {};
        const prefix = str(c.prefix, 5); if (!prefix || /\s/.test(prefix)) return fail(res, 400, 'The prefix must be 1-5 characters with no spaces.');
        const present = await botIn(); let channelIds = null;
        const channelOk = async (id) => {
          if (!id) return true; if (!ID.test(String(id))) return false;
          if (!channelIds) { const r = present && present.has(g.id) ? await bot.call('GET', '/guilds/' + g.id + '/channels') : null; channelIds = new Set(r && r.ok && Array.isArray(r.json) ? r.json.map((x) => x.id) : []); }
          return channelIds.has(String(id));
        };
        const w = c.welcome || {}, l = c.logs || {};
        if (!(await channelOk(w.channelId)) || !(await channelOk(l.channelId))) return fail(res, 400, 'Pick channels from this server.');
        if (w.enabled && !w.channelId) return fail(res, 400, 'Choose a channel for the welcome message.');
        const cfg = { prefix, welcome: { enabled: !!w.enabled, channelId: w.channelId ? String(w.channelId) : '', message: str(w.message, 1000) || DEFAULTS.welcome.message }, logs: { channelId: l.channelId ? String(l.channelId) : '' }, updated: now, updatedBy: me.id };
        await db.setJSON('dash:guild:' + g.id, cfg);
        return res.status(200).json({ ok: true, config: cfg });
      }
      case 'premiumSet': {
        if (me.id !== OWNER_ID) return fail(res, 403, 'Only the owner can do that.');
        const id = String(b.id || ''); if (!ID.test(id)) return fail(res, 400, 'Bad server id.');
        await db.cmd(b.on ? 'SADD' : 'SREM', 'dash:premium', id); return res.status(200).json({ ok: true });
      }
      default: return fail(res, 400, 'Unknown action.');
    }
  } catch (e) {
    if (e && e.status === 401) return fail(res, 401, 'Your Discord session expired. Sign in again.');
    return fail(res, 500, 'Something went wrong. Please try again.');
  }
};
