// Support ticket records. Tickets are opened and answered in Discord only; the site just lists them.
// A ticket's id is the id of its message in the modmail channel.

const db = require('./_db');

async function saveTicket(t) {
  await db.pipe([
    ['SET', 'ticket:' + t.id, JSON.stringify(t)],
    ['SADD', 'tickets', t.id],
    ['SADD', 'tickets:user:' + t.userId, t.id],
  ]);
}

const getTicket = (id) => db.getJSON('ticket:' + id);

async function updateTicket(id, patch) {
  const t = await getTicket(id);
  if (!t) return null;
  const next = Object.assign({}, t, patch);
  await db.setJSON('ticket:' + id, next);
  return next;
}

async function listTickets(status, limit) {
  const ids = (await db.cmd('SMEMBERS', 'tickets')) || [];
  ids.sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : BigInt(b) < BigInt(a) ? -1 : 0));
  const top = ids.slice(0, limit || 100);
  if (!top.length) return [];
  const rows = await db.cmd('MGET', ...top.map((id) => 'ticket:' + id));
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    try { const t = JSON.parse(r); if (status === 'all' || t.status === status) out.push(t); } catch (e) { /* skip */ }
  }
  return out;
}

async function userTickets(userId) {
  const ids = (await db.cmd('SMEMBERS', 'tickets:user:' + userId)) || [];
  if (!ids.length) return [];
  const rows = await db.cmd('MGET', ...ids.map((id) => 'ticket:' + id));
  return rows.map((r) => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
}

async function deleteUserTickets(userId) {
  const ids = (await db.cmd('SMEMBERS', 'tickets:user:' + userId)) || [];
  const cmds = ids.flatMap((id) => [['DEL', 'ticket:' + id], ['SREM', 'tickets', id]]);
  cmds.push(['DEL', 'tickets:user:' + userId]);
  await db.pipe(cmds);
  return ids.length;
}

module.exports = { saveTicket, getTicket, updateTicket, listTickets, userTickets, deleteUserTickets };
