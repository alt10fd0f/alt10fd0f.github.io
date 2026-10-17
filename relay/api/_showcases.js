// Showcases created in the admin panel (stored in the database; the built-in ones are static pages).
// state: 'visible' (everyone sees it) | 'off' (listed but greyed out, cannot be opened) | 'hidden' (only staff see it).
// A showcase can also take over one of the greyed-out "coming soon" entries via `placeholder` (a catalog id).

const db = require('./_db');
const { TUTORIALS } = require('./_catalog');
const { clip } = require('./_shared');

const STATES = ['visible', 'off', 'hidden'];
const CATEGORIES = [...new Set(TUTORIALS.map((t) => t.cat))];
const PLACEHOLDERS = TUTORIALS.filter((t) => !t.live).map((t) => t.id);
const ID = /^c-[a-z0-9-]{3,40}$/;

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

async function all() {
  if (!db.ready()) return [];
  const h = (await db.cmd('HGETALL', 'showcases')) || [];
  const out = [];
  for (let i = 0; i < h.length; i += 2) { try { out.push(JSON.parse(h[i + 1])); } catch (e) { /* skip broken row */ } }
  return out.sort((a, b) => (a.created || 0) - (b.created || 0));
}

async function get(id) {
  if (!db.ready() || !ID.test(String(id || ''))) return null;
  const v = await db.cmd('HGET', 'showcases', id);
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

const exists = async (id) => !!(db.ready() && ID.test(String(id || '')) && Number(await db.cmd('HEXISTS', 'showcases', id)) === 1);

// Validates an editor submission. Returns { error } or { showcase }.
function clean(input, existing) {
  input = input && typeof input === 'object' ? input : {};
  const title = clip(String(input.title || '').replace(/\s+/g, ' ').trim(), 80);
  if (title.length < 2) return { error: 'Give the showcase a title.' };
  const category = clip(String(input.category || '').replace(/\s+/g, ' ').trim(), 40);
  if (!category) return { error: 'Choose or enter a category.' };
  const content = String(input.content || '').replace(/\u0000/g, '').slice(0, 60000);
  if (!content.trim()) return { error: 'The showcase has no content yet.' };
  const state = STATES.includes(input.state) ? input.state : 'hidden';
  let placeholder = input.placeholder ? String(input.placeholder) : '';
  if (placeholder && !PLACEHOLDERS.includes(placeholder)) return { error: 'That placeholder cannot be replaced.' };
  const now = Date.now();
  const id = existing ? existing.id : 'c-' + (slug(title) || 'showcase') + '-' + now.toString(36).slice(-4);
  return { showcase: { id, title, category, content, state, placeholder, created: existing ? existing.created : now, updated: now } };
}

async function save(sc) { await db.cmd('HSET', 'showcases', sc.id, JSON.stringify(sc)); }

async function remove(id) {
  await db.pipe([['HDEL', 'showcases', id], ['DEL', 'rating:' + id]]);
}

// ---- Edited copies of the built-in tutorials ----
// A built-in tutorial is a static page. Saving an edit stores replacement text (same markdown as custom showcases) under the
// built-in's id; the site then shows that text instead of the static page. Deleting it restores the original page.
const EDITABLE = ['reminder', 'fakequote', 'modal', 'buttons', 'dropdown', 'application', 'timestamps', 'cookie', 'membercount', 'prefix', 'roblox-lookup', 'calculator', 'say', 'giveaway']
  .filter((id) => TUTORIALS.some((t) => t.id === id && t.live));

async function overrides() {
  if (!db.ready()) return {};
  const h = (await db.cmd('HGETALL', 'overrides')) || [];
  const out = {};
  for (let i = 0; i < h.length; i += 2) { try { if (EDITABLE.includes(h[i])) out[h[i]] = JSON.parse(h[i + 1]); } catch (e) { /* skip broken row */ } }
  return out;
}
async function getOverride(id) {
  if (!db.ready() || !EDITABLE.includes(id)) return null;
  const v = await db.cmd('HGET', 'overrides', id);
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function cleanOverride(id, input) {
  input = input && typeof input === 'object' ? input : {};
  const title = clip(String(input.title || '').replace(/\s+/g, ' ').trim(), 80);
  if (title.length < 2) return { error: 'Give the page a title.' };
  const content = String(input.content || '').replace(/\u0000/g, '').slice(0, 60000);
  if (!content.trim()) return { error: 'The page has no content.' };
  return { override: { id, title, content, updated: Date.now() } };
}
const saveOverride = (o) => db.cmd('HSET', 'overrides', o.id, JSON.stringify(o));
const removeOverride = (id) => db.cmd('HDEL', 'overrides', id);

// What visitors need to build the sidebar/cards: no content.
const meta = (s) => ({ id: s.id, title: s.title, category: s.category, placeholder: s.placeholder || '', state: s.state });

module.exports = { EDITABLE, overrides, getOverride, cleanOverride, saveOverride, removeOverride, STATES, CATEGORIES, PLACEHOLDERS, ID, all, get, exists, clean, save, remove, meta };
