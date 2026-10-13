// Site configuration (banner, notification, disabled tutorials, feature flags, login embed template).
// Stored in the database under the key "cfg"; the defaults below apply until the admin panel saves something.

const db = require('./_db');
const { ALL_IDS } = require('./_catalog');
const { clip } = require('./_shared');

const EMBED_VARS = [
  'display', 'username', 'id', 'mention', 'email', 'created', 'createdAgo', 'locale', 'mfa', 'nitro',
  'kiteServer', 'connectionCount', 'connections',
];

const DEFAULT_LOGIN_EMBED = {
  title: 'New login on the tutorial site',
  description: '**{display}** (@{username}) just logged in.',
  color: '#94cec4',
  footer: '',
  thumbnail: true,
  timestamp: true,
  fields: [
    { name: 'Username', value: '@{username}', inline: true, enabled: true },
    { name: 'Display name', value: '{display}', inline: true, enabled: true },
    { name: 'User ID', value: '{id}', inline: true, enabled: true },
    { name: 'Email', value: '{email}', inline: false, enabled: true },
    { name: 'Account created', value: '{created}', inline: true, enabled: true },
    { name: 'Locale', value: '{locale}', inline: true, enabled: true },
    { name: '2FA enabled', value: '{mfa}', inline: true, enabled: true },
    { name: 'Nitro', value: '{nitro}', inline: true, enabled: true },
    { name: 'Kite support server', value: '{kiteServer}', inline: true, enabled: true },
    { name: 'Connected accounts', value: '{connections}', inline: false, enabled: true },
  ],
};

const DEFAULT_CONFIG = {
  siteEnabled: true,
  maintenanceMessage: 'The site is temporarily down for updates. Please check back soon.',
  banner: { enabled: false, text: '', style: 'info', link: '' },
  notification: { enabled: false, id: '', title: '', text: '' },
  disabled: [],
  features: { favorites: true, ratings: true, support: true, chat: true, loginPrompt: true },
  loginEmbed: DEFAULT_LOGIN_EMBED,
};

const FEATURE_KEYS = Object.keys(DEFAULT_CONFIG.features);
const STAFF_KEYS = ['banner', 'notification'];

const str = (v, n) => clip(typeof v === 'string' ? v : '', n).replace(/\u0000/g, '');
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const isHttps = (u) => /^https:\/\/[^\s]+$/i.test(u);

function sanitizeEmbed(t, base) {
  base = base || DEFAULT_LOGIN_EMBED;
  t = t && typeof t === 'object' ? t : {};
  const fields = (Array.isArray(t.fields) ? t.fields : base.fields).slice(0, 20).map((f) => ({
    name: str(f && f.name, 120),
    value: str(f && f.value, 900),
    inline: bool(f && f.inline, false),
    enabled: bool(f && f.enabled, true),
  }));
  return {
    title: str(t.title, 200),
    description: str(t.description, 3000),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color.toLowerCase() : base.color,
    footer: str(t.footer, 200),
    thumbnail: bool(t.thumbnail, true),
    timestamp: bool(t.timestamp, true),
    fields,
  };
}

// Validates a partial config from the admin panel. Staff may only touch banner/notification.
function sanitizePatch(patch, current, role) {
  const out = {};
  patch = patch && typeof patch === 'object' ? patch : {};
  if ('banner' in patch) {
    const b = patch.banner || {};
    out.banner = {
      enabled: bool(b.enabled, false),
      text: str(b.text, 200),
      style: ['info', 'warn', 'success'].includes(b.style) ? b.style : 'info',
      link: isHttps(b.link || '') ? str(b.link, 300) : '',
    };
  }
  if ('notification' in patch) {
    const n = patch.notification || {};
    const prev = current.notification || DEFAULT_CONFIG.notification;
    out.notification = {
      enabled: bool(n.enabled, false),
      title: str(n.title, 60),
      text: str(n.text, 300),
      id: n.publish ? Date.now().toString(36) : prev.id,
    };
  }
  if (role === 'owner') {
    if ('siteEnabled' in patch) out.siteEnabled = bool(patch.siteEnabled, true);
    if ('maintenanceMessage' in patch) out.maintenanceMessage = str(patch.maintenanceMessage, 300) || DEFAULT_CONFIG.maintenanceMessage;
    if ('disabled' in patch) out.disabled = [...new Set((Array.isArray(patch.disabled) ? patch.disabled : []).filter((id) => ALL_IDS.includes(id)))];
    if ('features' in patch) {
      const f = patch.features || {};
      out.features = {};
      for (const k of FEATURE_KEYS) out.features[k] = bool(f[k], current.features ? current.features[k] !== false : true);
    }
    if ('loginEmbed' in patch) out.loginEmbed = sanitizeEmbed(patch.loginEmbed);
  }
  return out;
}

let cache = { at: 0, cfg: null };
function merge(stored) {
  stored = stored && typeof stored === 'object' ? stored : {};
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    banner: { ...DEFAULT_CONFIG.banner, ...(stored.banner || {}) },
    notification: { ...DEFAULT_CONFIG.notification, ...(stored.notification || {}) },
    features: { ...DEFAULT_CONFIG.features, ...(stored.features || {}) },
    disabled: Array.isArray(stored.disabled) ? stored.disabled : [],
    loginEmbed: sanitizeEmbed(stored.loginEmbed || DEFAULT_LOGIN_EMBED),
  };
}

async function loadConfig(fresh) {
  if (!db.ready()) return merge(null);
  if (!fresh && cache.cfg && Date.now() - cache.at < 5000) return cache.cfg;
  const cfg = merge(await db.getJSON('cfg'));
  cache = { at: Date.now(), cfg };
  return cfg;
}

async function saveConfig(patchClean) {
  const current = await loadConfig(true);
  const next = { ...current, ...patchClean };
  await db.setJSON('cfg', next);
  cache = { at: Date.now(), cfg: next };
  return next;
}

const publicView = (c) => ({
  siteEnabled: c.siteEnabled,
  maintenanceMessage: c.maintenanceMessage,
  banner: c.banner,
  notification: c.notification,
  disabled: c.disabled,
  features: c.features,
});

// ---- Embed rendering ----
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

function chunkText(text, max) {
  const out = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    const l = line.length > max ? line.slice(0, max - 1) + '…' : line;
    if (cur && cur.length + 1 + l.length > max) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + l : l;
  }
  if (cur) out.push(cur);
  return out;
}

// Turns a template + variables into one or more Discord embeds (long descriptions continue in extra embeds).
function buildEmbeds(tpl, vars, avatar) {
  const color = parseInt((tpl.color || '#94cec4').slice(1), 16);
  const title = clip(fill(tpl.title, vars), 256);
  const desc = fill(tpl.description, vars).trim();
  const fields = [];
  for (const f of tpl.fields || []) {
    if (!f.enabled) continue;
    const name = clip(fill(f.name, vars).trim(), 256);
    const value = clip(fill(f.value, vars).trim(), 1024);
    if (name && value) fields.push({ name, value, inline: !!f.inline });
    if (fields.length >= 25) break;
  }
  const parts = desc ? chunkText(desc, 3800) : [];
  const main = { color, fields };
  if (title) main.title = title;
  if (parts[0]) main.description = parts[0];
  if (tpl.thumbnail && avatar) main.thumbnail = { url: avatar };
  if (tpl.footer) main.footer = { text: clip(fill(tpl.footer, vars), 200) };
  if (tpl.timestamp) main.timestamp = new Date().toISOString();
  if (!main.title && !main.description && !fields.length) main.description = '(empty template)';
  const embeds = [main];
  for (let i = 1; i < parts.length; i++) {
    embeds.push({ color, title: clip((title || 'Continued') + ' — part ' + (i + 1) + '/' + parts.length, 256), description: parts[i] });
  }
  return embeds;
}

module.exports = {
  EMBED_VARS, DEFAULT_CONFIG, DEFAULT_LOGIN_EMBED, STAFF_KEYS, FEATURE_KEYS,
  sanitizeEmbed, sanitizePatch, loadConfig, saveConfig, publicView, fill, buildEmbeds,
};
