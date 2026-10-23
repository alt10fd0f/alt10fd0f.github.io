// Community CAD (computer-aided dispatch) API. One endpoint, body { token, action, ... }.
// Access is an allowlist: the owner is always admin; everyone else must be added with a role in the CAD "Members" tab.
// Roles: civilian (own characters/vehicles) < officer (board, lookups, reports) < dispatch (manage calls/units) < admin (members, ER:LC key).
// Data lives in Redis hashes under "cad:*" (id -> JSON).

const crypto = require('crypto');
const db = require('./_db');
const { authenticate } = require('./_auth');
const { handleCommon, OWNER_ID, displayName } = require('./_shared');
const erlc = require('./_erlc');

const ROLES = ['civilian', 'officer', 'dispatch', 'admin'];
const STATUSES = ['Off duty', 'Available', 'Busy', 'En route', 'On scene', 'Break'];
const LICENSE = ['Valid', 'Suspended', 'Revoked', 'None'];
const REG = ['Valid', 'Expired', 'Suspended'];
const REPORT_TYPES = ['Arrest', 'Citation', 'Warning', 'Incident'];
const CAP = 800;
const ID = /^\d{5,25}$/;
const hits = new Map();
let live = { at: 0, data: null };

const rank = (r) => ROLES.indexOf(r);
const uid = () => crypto.randomBytes(5).toString('hex');
const s = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n) : '');
const one = (v, allowed, def) => (allowed.includes(v) ? v : def);
const list = async (key) => (((await db.cmd('HVALS', key)) || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean));
const get = async (key, id) => { const v = await db.cmd('HGET', key, id); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const put = (key, o) => db.cmd('HSET', key, o.id, JSON.stringify(o));
const count = (key) => db.cmd('HLEN', key);
const fail = (res, status, error) => res.status(status).json({ error });

async function memberOf(me) {
  if (me.id === OWNER_ID) return { id: me.id, role: 'admin' };
  const m = await get('cad:members', me.id);
  return m && ROLES.includes(m.role) ? m : null;
}

async function liveData() {
  if (Date.now() - live.at < 10000) return live.data;
  const key = await db.cmd('GET', 'cad:erlc');
  if (!key) return null;
  try {
    const r = await fetch('https://api.erlc.gg/v2/server?Players=true&Vehicles=true&ModCalls=true&EmergencyCalls=true', { headers: { 'server-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { error: 'ER:LC answered ' + r.status };
    const j = await r.json();
    live = { at: Date.now(), data: { players: (j.Players || []).slice(0, 100), vehicles: (j.Vehicles || []).slice(0, 150), modCalls: (j.ModCalls || []).slice(0, 50), emergencyCalls: (j.EmergencyCalls || []).slice(0, 50), name: j.Name || '', currentPlayers: j.CurrentPlayers, maxPlayers: j.MaxPlayers } };
    return live.data;
  } catch (e) { return { error: 'Could not reach ER:LC' }; }
}

async function releaseUnits(ids, callId) {
  for (const id of ids) {
    const u = await get('cad:units', id);
    if (u && u.callId === callId) { u.callId = ''; if (['En route', 'On scene', 'Busy'].includes(u.status)) u.status = 'Available'; u.updated = Date.now(); await put('cad:units', u); }
  }
}

module.exports = async (req, res) => {
  if (handleCommon(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return fail(res, 503, 'database not configured');
  const v = await authenticate(req, res);
  if (!v) return;
  const me = v.me, b = req.body || {}, a = String(b.action || '');

  const now = Date.now(), t = (hits.get(me.id) || []).filter((x) => now - x < 60000);
  if (t.length >= 150) return fail(res, 429, 'Too many requests. Slow down.');
  t.push(now); hits.set(me.id, t); if (hits.size > 2000) hits.clear();

  try {
    const mem = await memberOf(me);
    if (!mem) return fail(res, 403, 'Your Discord account is not on this CAD\'s access list. Ask an admin to add your user ID: ' + me.id);
    const role = mem.role, R = rank(role), name = displayName(me);
    if (mem.name !== name && me.id !== OWNER_ID) { mem.name = name; await put('cad:members', mem); }
    const leo = R >= 1, disp = R >= 2, admin = R >= 3;
    const need = (ok) => { if (!ok) { fail(res, 403, 'You do not have permission to do that.'); return false; } return true; };

    switch (a) {
      case 'me': {
        const unit = await get('cad:units', me.id);
        return res.status(200).json({ id: me.id, name, role, unit, erlc: !!(await db.cmd('GET', 'cad:erlc')), statuses: STATUSES });
      }

      // ---------- dispatch board ----------
      case 'board': {
        if (!need(leo)) return;
        const calls = await list('cad:calls');
        const open = calls.filter((c) => c.status === 'open').sort((x, y) => y.priority - x.priority || y.created - x.created);
        const closed = calls.filter((c) => c.status !== 'open').sort((x, y) => y.closedAt - x.closedAt).slice(0, 25);
        const units = (await list('cad:units')).filter((u) => u.status !== 'Off duty' || u.id === me.id).sort((x, y) => (x.callsign || '').localeCompare(y.callsign || ''));
        return res.status(200).json({ calls: open.concat(closed), units, now });
      }
      case 'callCreate': {
        if (!need(leo)) return;
        const title = s(b.title, 80); if (title.length < 3) return fail(res, 400, 'Give the call a title (3-80 characters).');
        if ((await count('cad:calls')) >= CAP) return fail(res, 400, 'Too many stored calls. Ask an admin to clear closed calls.');
        const c = { id: uid(), title, code: s(b.code, 12), location: s(b.location, 80), description: s(b.description, 600), priority: Math.min(3, Math.max(1, Number(b.priority) || 2)), status: 'open', units: [], notes: [], created: now, by: name, byId: me.id };
        await put('cad:calls', c); return res.status(200).json({ ok: true, call: c });
      }
      case 'callEdit': {
        const c = await get('cad:calls', String(b.id || '')); if (!c) return fail(res, 404, 'Call not found.');
        if (!need(disp || c.byId === me.id)) return;
        if (typeof b.title === 'string' && s(b.title, 80).length >= 3) c.title = s(b.title, 80);
        if (typeof b.code === 'string') c.code = s(b.code, 12);
        if (typeof b.location === 'string') c.location = s(b.location, 80);
        if (typeof b.description === 'string') c.description = s(b.description, 600);
        if (b.priority) c.priority = Math.min(3, Math.max(1, Number(b.priority) || c.priority));
        if (b.status === 'closed' && c.status === 'open') { c.status = 'closed'; c.closedAt = now; c.closedBy = name; await releaseUnits(c.units, c.id); c.units = []; }
        else if (b.status === 'open' && c.status !== 'open') { c.status = 'open'; c.closedAt = 0; }
        await put('cad:calls', c); return res.status(200).json({ ok: true, call: c });
      }
      case 'callNote': {
        if (!need(leo)) return;
        const c = await get('cad:calls', String(b.id || '')); if (!c) return fail(res, 404, 'Call not found.');
        const text = s(b.text, 300); if (!text) return fail(res, 400, 'Write a note first.');
        c.notes = (c.notes || []).concat({ by: name, text, time: now }).slice(-50);
        await put('cad:calls', c); return res.status(200).json({ ok: true, call: c });
      }
      case 'callAttach': {
        if (!need(leo)) return;
        const c = await get('cad:calls', String(b.id || '')); if (!c || c.status !== 'open') return fail(res, 404, 'That call is not open.');
        const target = b.userId && b.userId !== me.id ? String(b.userId) : me.id;
        if (target !== me.id && !need(disp)) return;
        const u = await get('cad:units', target); if (!u || u.status === 'Off duty') return fail(res, 400, 'That unit is not on duty.');
        if (b.detach) {
          c.units = c.units.filter((x) => x !== target); u.callId = ''; if (['En route', 'On scene', 'Busy'].includes(u.status)) u.status = 'Available';
        } else {
          if (u.callId && u.callId !== c.id) { const old = await get('cad:calls', u.callId); if (old) { old.units = old.units.filter((x) => x !== target); await put('cad:calls', old); } }
          if (!c.units.includes(target)) c.units.push(target);
          u.callId = c.id; u.status = 'En route';
        }
        u.updated = now; await put('cad:units', u); await put('cad:calls', c);
        return res.status(200).json({ ok: true });
      }
      case 'callDelete': {
        if (!need(admin)) return;
        const c = await get('cad:calls', String(b.id || '')); if (c) await releaseUnits(c.units, c.id);
        await db.cmd('HDEL', 'cad:calls', String(b.id || '')); return res.status(200).json({ ok: true });
      }
      case 'unitSet': {
        if (!need(leo)) return;
        const target = b.userId && b.userId !== me.id ? String(b.userId) : me.id;
        if (target !== me.id && !need(disp)) return;
        let u = await get('cad:units', target);
        if (!u) { if (target !== me.id) return fail(res, 404, 'Unit not found.'); u = { id: me.id, name, callsign: '', dept: '', status: 'Off duty', callId: '', updated: now }; }
        if (typeof b.callsign === 'string') u.callsign = s(b.callsign, 12).toUpperCase();
        if (typeof b.dept === 'string') u.dept = s(b.dept, 30);
        if (STATUSES.includes(b.status)) {
          if (b.status !== 'Off duty' && !u.callsign) return fail(res, 400, 'Set a callsign before going on duty.');
          u.status = b.status;
          if (b.status === 'Off duty' && u.callId) { const c = await get('cad:calls', u.callId); if (c) { c.units = c.units.filter((x) => x !== target); await put('cad:calls', c); } u.callId = ''; }
        }
        u.name = u.id === me.id ? name : u.name; u.updated = now; await put('cad:units', u);
        return res.status(200).json({ ok: true, unit: u });
      }

      // ---------- civilians ----------
      case 'charList': {
        if (!leo) return res.status(200).json({ chars: (await list('cad:chars')).filter((c) => c.owner === me.id).sort((x, y) => x.last.localeCompare(y.last)) });
        const q = s(b.q, 40).toLowerCase();
        const all = await list('cad:chars');
        const out = (b.mine ? all.filter((c) => c.owner === me.id) : q ? all.filter((c) => (c.first + ' ' + c.last).toLowerCase().includes(q) || c.id === q) : []).slice(0, 50);
        return res.status(200).json({ chars: out });
      }
      case 'charSave': {
        const first = s(b.first, 30), last = s(b.last, 30);
        if (!first || !last) return fail(res, 400, 'First and last name are required.');
        let c = b.id ? await get('cad:chars', String(b.id)) : null;
        if (b.id && !c) return fail(res, 404, 'Character not found.');
        if (c && c.owner !== me.id && !need(leo)) return;
        if (!c) {
          if (!admin && (await list('cad:chars')).filter((x) => x.owner === me.id).length >= 10) return fail(res, 400, 'You can have up to 10 characters.');
          if ((await count('cad:chars')) >= CAP) return fail(res, 400, 'The records database is full.');
          c = { id: uid(), owner: me.id, ownerName: name, license: 'Valid', flags: [], created: now };
        }
        Object.assign(c, { first, last, dob: s(b.dob, 20), gender: s(b.gender, 12), address: s(b.address, 80), phone: s(b.phone, 20), notes: s(b.notes, 400) });
        if (leo) { c.license = one(b.license, LICENSE, c.license); if (Array.isArray(b.flags)) c.flags = b.flags.map((f) => s(f, 30)).filter(Boolean).slice(0, 5); }
        await put('cad:chars', c); return res.status(200).json({ ok: true, char: c });
      }
      case 'charDelete': {
        const c = await get('cad:chars', String(b.id || '')); if (!c) return fail(res, 404, 'Character not found.');
        if (!need(c.owner === me.id || admin)) return;
        await db.cmd('HDEL', 'cad:chars', c.id);
        for (const vh of (await list('cad:veh')).filter((x) => x.charId === c.id)) await db.cmd('HDEL', 'cad:veh', vh.id);
        return res.status(200).json({ ok: true });
      }
      case 'vehList': {
        const all = await list('cad:veh');
        return res.status(200).json({ vehicles: (leo && b.charId ? all.filter((x) => x.charId === String(b.charId)) : all.filter((x) => x.owner === me.id)).slice(0, 100) });
      }
      case 'vehSave': {
        const plate = s(b.plate, 10).toUpperCase().replace(/[^A-Z0-9 -]/g, ''); if (plate.length < 2) return fail(res, 400, 'Enter a license plate.');
        const ch = await get('cad:chars', String(b.charId || '')); if (!ch) return fail(res, 400, 'Pick the character who owns this vehicle.');
        if (ch.owner !== me.id && !need(leo)) return;
        const all = await list('cad:veh');
        let vh = b.id ? all.find((x) => x.id === String(b.id)) : null;
        if (b.id && !vh) return fail(res, 404, 'Vehicle not found.');
        if (vh && vh.owner !== me.id && !need(leo)) return;
        if (all.some((x) => x.plate === plate && (!vh || x.id !== vh.id))) return fail(res, 409, 'That plate is already registered.');
        if (!vh) {
          if (!admin && all.filter((x) => x.owner === me.id).length >= 10) return fail(res, 400, 'You can have up to 10 vehicles.');
          if (all.length >= CAP) return fail(res, 400, 'The records database is full.');
          vh = { id: uid(), owner: me.id, registration: 'Valid', stolen: false, created: now };
        }
        Object.assign(vh, { plate, model: s(b.model, 40), color: s(b.color, 20), charId: ch.id, charName: ch.first + ' ' + ch.last, notes: s(b.notes, 200) });
        if (leo) { vh.registration = one(b.registration, REG, vh.registration); vh.stolen = !!b.stolen; }
        await put('cad:veh', vh); return res.status(200).json({ ok: true, vehicle: vh });
      }
      case 'vehDelete': {
        const vh = await get('cad:veh', String(b.id || '')); if (!vh) return fail(res, 404, 'Vehicle not found.');
        if (!need(vh.owner === me.id || admin)) return;
        await db.cmd('HDEL', 'cad:veh', vh.id); return res.status(200).json({ ok: true });
      }

      // ---------- officer tools ----------
      case 'search': {
        if (!need(leo)) return;
        const q = s(b.q, 40).toLowerCase(); if (q.length < 2) return fail(res, 400, 'Type at least 2 characters.');
        const [chars, veh, wars] = await Promise.all([list('cad:chars'), list('cad:veh'), list('cad:warrants')]);
        const cm = chars.filter((c) => (c.first + ' ' + c.last).toLowerCase().includes(q) || c.id === q).slice(0, 25);
        const ids = new Set(cm.map((c) => c.id));
        const vm = veh.filter((x) => x.plate.toLowerCase().includes(q) || ids.has(x.charId)).slice(0, 25);
        const wm = wars.filter((w) => w.status === 'active' && (ids.has(w.charId) || vm.some((x) => x.charId === w.charId))).slice(0, 25);
        const extra = vm.map((x) => x.charId).filter((id) => !ids.has(id));
        const more = chars.filter((c) => extra.includes(c.id));
        const l = await liveData();
        const liveVeh = l && l.vehicles ? l.vehicles.filter((x) => String(x.Plate || '').toLowerCase().includes(q) || String(x.Owner || '').toLowerCase().includes(q)).slice(0, 10) : [];
        return res.status(200).json({ chars: cm.concat(more), vehicles: vm, warrants: wm, liveVehicles: liveVeh });
      }
      case 'warrantList': {
        if (!need(leo)) return;
        return res.status(200).json({ warrants: (await list('cad:warrants')).sort((x, y) => y.created - x.created).slice(0, 100) });
      }
      case 'warrantSave': {
        if (!need(leo)) return;
        const ch = await get('cad:chars', String(b.charId || '')); if (!ch) return fail(res, 400, 'Pick a character.');
        const charge = s(b.charge, 120); if (!charge) return fail(res, 400, 'Enter the charge.');
        if ((await count('cad:warrants')) >= CAP) return fail(res, 400, 'Too many warrants stored.');
        const w = { id: uid(), charId: ch.id, charName: ch.first + ' ' + ch.last, charge, notes: s(b.notes, 300), status: 'active', by: name, byId: me.id, created: now };
        await put('cad:warrants', w); return res.status(200).json({ ok: true, warrant: w });
      }
      case 'warrantClose': {
        const w = await get('cad:warrants', String(b.id || '')); if (!w) return fail(res, 404, 'Warrant not found.');
        if (!need(disp || w.byId === me.id)) return;
        w.status = one(b.status, ['served', 'recalled'], 'served'); w.closedBy = name; w.closedAt = now;
        await put('cad:warrants', w); return res.status(200).json({ ok: true });
      }
      case 'reportList': {
        if (!need(leo)) return;
        let r = await list('cad:reports'); if (b.charId) r = r.filter((x) => x.charId === String(b.charId));
        return res.status(200).json({ reports: r.sort((x, y) => y.created - x.created).slice(0, 60) });
      }
      case 'reportCreate': {
        if (!need(leo)) return;
        const narrative = s(b.narrative, 2000); if (narrative.length < 5) return fail(res, 400, 'Write the narrative (at least 5 characters).');
        const ch = b.charId ? await get('cad:chars', String(b.charId)) : null;
        if ((await count('cad:reports')) >= CAP) return fail(res, 400, 'Too many reports stored.');
        const u = await get('cad:units', me.id);
        const r = { id: uid(), type: one(b.type, REPORT_TYPES, 'Incident'), charId: ch ? ch.id : '', charName: ch ? ch.first + ' ' + ch.last : s(b.charName, 60), charges: s(b.charges, 300), fine: Math.min(100000, Math.max(0, Math.floor(Number(b.fine) || 0))), narrative, callId: s(b.callId, 12), by: name, callsign: u ? u.callsign : '', created: now };
        await put('cad:reports', r); return res.status(200).json({ ok: true, report: r });
      }
      case 'reportDelete': {
        if (!need(admin)) return;
        await db.cmd('HDEL', 'cad:reports', String(b.id || '')); return res.status(200).json({ ok: true });
      }

      // ---------- ER:LC ----------
      case 'erlcLive': {
        if (!need(leo)) return;
        const d = await liveData(); if (!d) return fail(res, 404, 'ER:LC is not connected. An admin can add the server key.');
        if (d.error) return fail(res, 502, d.error);
        return res.status(200).json(d);
      }
      case 'erlcSave': {
        if (!need(admin)) return;
        const key = s(b.key, 200); if (key.length < 8 || /\s/.test(key)) return fail(res, 400, 'Enter your ER:LC server key.');
        const ok = await erlc.verifyKey(key); if (!ok.ok) return fail(res, ok.status, ok.error);
        await db.cmd('SET', 'cad:erlc', key); live = { at: 0, data: null }; return res.status(200).json({ ok: true });
      }
      case 'erlcClear': {
        if (!need(admin)) return;
        await db.cmd('DEL', 'cad:erlc'); live = { at: 0, data: null }; return res.status(200).json({ ok: true });
      }

      // ---------- members ----------
      case 'membersList': {
        if (!need(admin)) return;
        return res.status(200).json({ members: (await list('cad:members')).sort((x, y) => rank(y.role) - rank(x.role)), ownerId: OWNER_ID, roles: ROLES });
      }
      case 'memberSet': {
        if (!need(admin)) return;
        const id = String(b.id || ''); if (!ID.test(id) || id === OWNER_ID) return fail(res, 400, 'Enter a valid Discord user ID.');
        if (!ROLES.includes(b.role)) return fail(res, 400, 'Pick a role.');
        const cur = await get('cad:members', id);
        if (!cur && (await count('cad:members')) >= 300) return fail(res, 400, 'Member limit reached.');
        await put('cad:members', { id, role: b.role, name: (cur && cur.name) || s(b.name, 40) || id, added: (cur && cur.added) || now });
        return res.status(200).json({ ok: true });
      }
      case 'memberRemove': {
        if (!need(admin)) return;
        const id = String(b.id || ''); if (id === OWNER_ID) return fail(res, 400, 'The owner cannot be removed.');
        await db.cmd('HDEL', 'cad:members', id); await db.cmd('HDEL', 'cad:units', id); return res.status(200).json({ ok: true });
      }
      default: return fail(res, 400, 'Unknown action.');
    }
  } catch (e) { return fail(res, 500, 'Something went wrong. Please try again.'); }
};
