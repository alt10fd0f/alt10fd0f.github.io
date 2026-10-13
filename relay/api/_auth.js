// Authentication helpers: who is calling, what role they have, and their stored profile.

const db = require('./_db');
const { verifyToken, OWNER_ID } = require('./_shared');

// Verifies body.token (a Discord OAuth token issued to our app). Sends the error response itself if it fails.
async function authenticate(req, res) {
  const v = await verifyToken(req.body && req.body.token);
  if (v.error) { res.status(v.status).json({ error: v.error }); return null; }
  return v;
}

// 'owner' (hard-coded Discord user id), 'staff' (added in the admin panel), or null.
async function roleOf(id) {
  if (id === OWNER_ID) return 'owner';
  if (!db.ready()) return null;
  try { if (Number(await db.cmd('SISMEMBER', 'staff', id)) === 1) return 'staff'; } catch (e) { /* treat as no role */ }
  return null;
}

const getProfile = (id) => db.getJSON('user:' + id);
const saveProfile = (p) => db.setJSON('user:' + p.id, p);

// Nicknames: letters, numbers, spaces and a few safe punctuation marks only (no mentions or markdown).
const cleanNickname = (s) =>
  typeof s === 'string' ? s.replace(/[^\p{L}\p{N} ._'\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32) : '';

module.exports = { authenticate, roleOf, getProfile, saveProfile, cleanNickname };
