// Custom showcases created in the admin panel (stored in the database).
// Built-in showcases are the static pages in the repo; they can only be shown/hidden (config "disabled").
// Keys: show:<id> (JSON), shows (set of ids). ids look like "c-my-showcase-ab12".

const db = require('./_db');
const { clip } = require('./_shared');

const SHOW_ID = /^c-[a-z0-9-]{3,48}$/;
const isShowId = (id) => typeof id === 'string' && SHOW_ID.test(id);

const str = (v, n) => clip(typeof v === 'string' ? v : '', n).replace(/\u0000/g, '');

function slug(title) {
  const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return 'c-' + (s || 'showcase') + '-' + Math.random().toString(36).slice(2, 6);
}

// Validates admin input. Returns { error } or { show }. `existing` keeps the id/created of an edited showcase.
function sanitizeShow(input, existing) {
  input = input && typeof input === 'object' ? input : {};
  const title = str(input.title, 80).trim();
  if (title.length < 2) return { error: 'Give the showcase a title (at least 2 characters).' };
  const content = str(input.content, 40000);
  const cat = str(input.cat, 40).replace(/\s+/g, ' ').trim() || 'Custom';
  return {
    show: {
      id: existing ? existing.id : slug(title),
      title,
      cat,
      content,
      hidden: input.hidden === true,
      created: existing ? existing.created : Date.now(),
      updated: Date.now(),
    },
  };
}

const getShow = (id) => (isShowId(id) ? db.getJSON('show:' + id) : Promise.resolve(null));

// All showcases (hidden ones too), newest first. Content is included only when withContent is true.
async function listShows(withContent) {
  if (!db.ready()) return [];
  const ids = ((await db.cmd('SMEMBERS', 'shows')) || []).filter(isShowId);
  if (!ids.length) return [];
  const rows = await db.cmd('MGET', ...ids.map((id) => 'show:' + id));
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    try {
      const s = JSON.parse(r);
      out.push(withContent ? s : { id: s.id, title: s.title, cat: s.cat, hidden: !!s.hidden, updated: s.updated });
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

async function saveShow(show) {
  await db.pipe([['SET', 'show:' + show.id, JSON.stringify(show)], ['SADD', 'shows', show.id]]);
}

// Removes the showcase and everything attached to it (ratings). Favorites are filtered out on read.
async function deleteShow(id) {
  await db.pipe([['DEL', 'show:' + id], ['SREM', 'shows', id], ['DEL', 'rating:' + id]]);
}

const exists = async (id) => !!(isShowId(id) && db.ready() && Number(await db.cmd('SISMEMBER', 'shows', id)) === 1);

module.exports = { isShowId, sanitizeShow, getShow, listShows, saveShow, deleteShow, exists };
