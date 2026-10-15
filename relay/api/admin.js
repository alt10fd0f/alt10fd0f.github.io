// Admin panel API. Owner (hard-coded Discord id) can do everything; staff can edit banner/notification and see tickets.
const db = require('./_db');
const { handleCommon, OWNER_ID } = require('./_shared');
const { authenticate, roleOf } = require('./_auth');
const { loadConfig, saveConfig, sanitizePatch, EMBED_VARS, DEFAULT_LOGIN_MESSAGE, LOGIN_OPTIONS } = require('./_config');
const { TUTORIALS } = require('./_catalog');
const { listTickets } = require('./_tickets');
const sc = require('./_showcases');

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
        return res.status(200).json({ role, ownerId: OWNER_ID, storage: db.ready(), config: cfg, staff: staffList, tickets, tutorials: TUTORIALS, vars: EMBED_VARS, defaultLogin: DEFAULT_LOGIN_MESSAGE, loginOptions: LOGIN_OPTIONS.map((o) => o.label) });
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
          const s = await sc.get(String(b.id || ''));
          return s ? res.status(200).json({ showcase: s }) : res.status(404).json({ error: 'not found' });
        }
        return res.status(200).json({ showcases: await sc.all(), categories: sc.CATEGORIES, placeholders: TUTORIALS.filter((t) => sc.PLACEHOLDERS.includes(t.id)).map((t) => ({ id: t.id, name: t.name, cat: t.cat })) });
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
      case 'showcaseDelete': {
        if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete showcases.' });
        if (!db.ready()) return res.status(503).json({ error: 'Storage is not set up yet.' });
        if (!sc.ID.test(String(b.id || ''))) return res.status(400).json({ error: 'Bad id.' });
        await sc.remove(b.id);
        return res.status(200).json({ ok: true });
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
