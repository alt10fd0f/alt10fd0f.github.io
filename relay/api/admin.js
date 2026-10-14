// Admin panel API. Owner (hard-coded Discord id) can do everything; staff can edit banner/notification and see tickets.
const db = require('./_db');
const { handleCommon, OWNER_ID } = require('./_shared');
const { authenticate, roleOf } = require('./_auth');
const { loadConfig, saveConfig, sanitizePatch, EMBED_VARS, DEFAULT_LOGIN_MESSAGE, LOGIN_OPTIONS } = require('./_config');
const { TUTORIALS } = require('./_catalog');
const { listTickets } = require('./_tickets');

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
