// Admin panel API. Owner (hard-coded Discord id) can do everything; staff can edit banner/notification and see tickets.
const db = require('./_db');
const { handleCommon, OWNER_ID } = require('./_shared');
const { authenticate, roleOf } = require('./_auth');
const { loadConfig, saveConfig, sanitizePatch, EMBED_VARS, DEFAULT_LOGIN_MESSAGE, LOGIN_OPTIONS } = require('./_config');
const { TUTORIALS } = require('./_catalog');
const { listTickets } = require('./_tickets');
const sc = require('./_showcases');
const logs = require('./_logs');
const bot = require('./_bot');

const ENDPOINT = 'https://kite-login-notify-sanfranrps.vercel.app/api/interactions';

const ID = /^\d{5,25}$/;

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  const v = await authenticate(req, res);
  if (!v) return;
  const role = await roleOf(v.me.id);
  if (!role) return res.status(403).json({ error: 'Not allowed.' });
  const b = req.body || {};
  try {
    switch (b.action) {
      case 'state': {
        const cfg = await loadConfig(true);
        const staff = db.ready() ? (await db.cmd('SMEMBERS', 'staff')) || [] : [];
        const profs = staff.length ? await db.cmd('MGET', ...staff.map((id) => 'user:' + id)) : [];
        const staffList = staff.map((id, i) => { let n = ''; try { n = JSON.parse(profs[i]).display || ''; } catch (e) {} return { id, name: n }; });
        const tickets = db.ready() ? await listTickets('open', 50) : [];
        return res.status(200).json({ role, ownerId: OWNER_ID, storage: db.ready(), config: role === 'owner' ? cfg : Object.assign({}, cfg, { logging: undefined }), staff: staffList, tickets, tutorials: TUTORIALS, vars: EMBED_VARS, defaultLogin: DEFAULT_LOGIN_MESSAGE, loginOptions: LOGIN_OPTIONS.map((o) => o.label) });
      }
      case 'save': {
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        const cfg = await loadConfig(true);
        const clean = sanitizePatch(b.patch, cfg, role);
        if (!Object.keys(clean).length) return res.status(403).json({ error: 'Nothing you are allowed to change.' });
        return res.status(200).json({ ok: true, config: await saveConfig(clean) });
      }
      case 'staffAdd':
      case 'staffRemove': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can manage staff.' });
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (!ID.test(String(b.id || '')) || b.id === OWNER_ID) return res.status(400).json({ error: 'Enter a valid Discord user ID.' });
        await db.cmd(b.action === 'staffAdd' ? 'SADD' : 'SREM', 'staff', b.id);
        return res.status(200).json({ ok: true });
      }
      case 'showcaseList':
      case 'showcaseGet': {
        // Staff may read everything (including hidden showcases) so they can preview; only the owner can change them.
        if (!db.ready()) return res.status(200).json({ showcases: [] });
        if (b.action === 'showcaseGet') {
          if (sc.EDITABLE.includes(String(b.id))) { const o = await sc.getOverride(String(b.id)); return o ? res.status(200).json({ showcase: o }) : res.status(404).json({ error: 'not found' }); }
          const s = await sc.get(String(b.id || ''));
          return s ? res.status(200).json({ showcase: s }) : res.status(404).json({ error: 'not found' });
        }
        const ov = await sc.overrides();
        const builtins = TUTORIALS.filter((t) => sc.EDITABLE.includes(t.id)).map((t) => ({ id: t.id, name: t.name, cat: t.cat, edited: !!ov[t.id], updated: ov[t.id] ? ov[t.id].updated : 0 }));
        return res.status(200).json({ builtins, showcases: await sc.all(), categories: sc.CATEGORIES, placeholders: TUTORIALS.filter((t) => sc.PLACEHOLDERS.includes(t.id)).map((t) => ({ id: t.id, name: t.name, cat: t.cat })) });
      }
      case 'showcaseSave': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can edit showcases.' });
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        const existing = b.id ? await sc.get(String(b.id)) : null;
        if (b.id && !existing) return res.status(404).json({ error: 'That showcase no longer exists.' });
        const r = sc.clean(b.showcase, existing);
        if (r.error) return res.status(400).json({ error: r.error });
        // One placeholder can only be taken over by one showcase.
        if (r.showcase.placeholder) {
          const clash = (await sc.all()).find((s) => s.placeholder === r.showcase.placeholder && s.id !== r.showcase.id);
          if (clash) return res.status(400).json({ error: 'That placeholder is already used by "' + clash.title + '".' });
        }
        await sc.save(r.showcase);
        return res.status(200).json({ ok: true, showcase: r.showcase });
      }
      case 'overrideGet': {
        const o = await sc.getOverride(String(b.id || ''));
        return res.status(200).json({ override: o });
      }
      case 'overrideSave': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can edit tutorials.' });
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (!sc.EDITABLE.includes(String(b.id || ''))) return res.status(400).json({ error: 'That tutorial cannot be edited.' });
        const r = sc.cleanOverride(b.id, b.page);
        if (r.error) return res.status(400).json({ error: r.error });
        await sc.saveOverride(r.override);
        return res.status(200).json({ ok: true, override: r.override });
      }
      case 'overrideDelete': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can restore tutorials.' });
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (!sc.EDITABLE.includes(String(b.id || ''))) return res.status(400).json({ error: 'Bad id.' });
        await sc.removeOverride(b.id);
        return res.status(200).json({ ok: true });
      }
      case 'showcaseDelete': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete showcases.' });
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (!sc.ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad id.' });
        await sc.remove(b.id);
        return res.status(200).json({ ok: true });
      }
      case 'testHook': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can do that.' });
        const ev = logs.EVENTS.includes(b.event) ? b.event : 'login';
        const url = logs.safeUrl(b.url) || logs.urlOf(await loadConfig(true), ev);
        if (!url) return res.status(400).json({ error: 'Enter a valid https webhook URL first.' });
        const r = await logs.sendWebhook(url, {
          event: 'test', data: { note: 'Test from the Kite Tutorials admin panel', for: ev },
          discord: [{ flags: 32768, components: [{ type: 17, components: [{ type: 10, content: '**Webhook trigger test**\nThis is a test message from the Kite Tutorials admin panel (' + ev + ' logs).' }] }] }],
        });
        return r.ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: 'The webhook answered with an error (' + (r.status || 'no response') + '). Check the URL.' });
      }
      case 'discordCheck':
      case 'discordFix': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can do that.' });
        if (!process.env.DISCORD_BOT_TOKEN) return res.status(200).json({ tokenSet: false });
        if (b.action === 'discordFix') {
          const f = await bot.call('PATCH', '/applications/@me', { interactions_endpoint_url: ENDPOINT });
          if (!f.ok) return res.status(502).json({ error: 'Discord refused to set it (' + f.status + '): ' + ((f.json && f.json.message) || 'unknown') + (f.json && f.json.errors ? ' ' + JSON.stringify(f.json.errors).slice(0, 300) : '') });
        }
        const app = await bot.call('GET', '/applications/@me');
        const logsCh = await bot.call('GET', '/channels/' + (require('./_shared').logsChannelId()));
        const mail = process.env.DISCORD_MODMAIL_CHANNEL_ID ? await bot.call('GET', '/channels/' + process.env.DISCORD_MODMAIL_CHANNEL_ID) : null;
        const chInfo = (c) => (c ? (c.ok ? { ok: true, name: c.json.name, type: c.json.type } : { ok: false, status: c.status }) : null);
        return res.status(200).json({
          tokenSet: true,
          app: app.ok ? { name: app.json.name, endpoint: app.json.interactions_endpoint_url || '', keyMatches: !!process.env.DISCORD_PUBLIC_KEY && app.json.verify_key === process.env.DISCORD_PUBLIC_KEY } : { error: app.status },
          expectedEndpoint: ENDPOINT,
          logsChannel: chInfo(logsCh), modmailChannel: chInfo(mail),
        });
      }
      case 'tickets': {
        const list = db.ready() ? await listTickets(b.status === 'all' ? 'all' : 'open', 100) : [];
        return res.status(200).json({ tickets: list });
      }
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
