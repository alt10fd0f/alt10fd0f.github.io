// Site configuration (banner, notification, disabled tutorials, feature flags, login embed template).
// Stored in the database under the key "cfg"; the defaults below apply until the admin panel saves something.

const db = require('./_db');
const { ALL_IDS } = require('./_catalog');
const { clip } = require('./_shared');

const EMBED_VARS = [
  'display', 'username', 'id', 'mention', 'email', 'created', 'createdAgo', 'locale', 'mfa', 'nitro',
  'kiteServer', 'connectionCount', 'connections',
];

// The login report is a Components V2 message: one container with the text (+ optional avatar thumbnail) and an optional dropdown.
const DEFAULT_LOGIN_MESSAGE = {
  text: '**User**\n> {mention} [`{id}`]\n\n**Account Data**\n>>> Email • ||{email}||\nCreated At • {created}\n2FA Enabled • {mfa}\nNitro • {nitro}\nKite Support Server • {kiteServer}\nConnected Accounts • {connectionCount}\n{connections}',
  thumbnail: true,
  accent: '',
  dropdown: { enabled: true, placeholder: 'Select an option' },
};

const DEFAULT_CONFIG = {
  siteEnabled: true,
  maintenanceMessage: 'The site is temporarily down for updates. Please check back soon.',
  banner: { enabled: false, text: '', style: 'info', link: '' },
  notification: { enabled: false, id: '', title: '', text: '' },
  disabled: [],
  hidden: [],
  features: { favorites: true, ratings: true, support: true, loginPrompt: true },
  loginMessage: DEFAULT_LOGIN_MESSAGE,
  links: { kite: '' },
};

const FEATURE_KEYS = Object.keys(DEFAULT_CONFIG.features);
const STAFF_KEYS = ['banner', 'notification'];

const str = (v, n) => clip(typeof v === 'string' ? v : '', n).replace(/\u0000/g, '');
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const isHttps = (u) => /^https:\/\/[^\s]+$/i.test(u);

function sanitizeLogin(t) {
  t = t && typeof t === 'object' ? t : {};
  const d = t.dropdown && typeof t.dropdown === 'object' ? t.dropdown : {};
  return {
    text: str(t.text, 3000).trim() || DEFAULT_LOGIN_MESSAGE.text,
    thumbnail: bool(t.thumbnail, true),
    accent: /^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent.toLowerCase() : '',
    dropdown: { enabled: bool(d.enabled, true), placeholder: str(d.placeholder, 100).trim() || 'Select an option' },
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
    if ('hidden' in patch) out.hidden = [...new Set((Array.isArray(patch.hidden) ? patch.hidden : []).filter((id) => ALL_IDS.includes(id)))];
    if ('disabled' in patch) out.disabled = [...new Set((Array.isArray(patch.disabled) ? patch.disabled : []).filter((id) => ALL_IDS.includes(id)))];
    if ('features' in patch) {
      const f = patch.features || {};
      out.features = {};
      for (const k of FEATURE_KEYS) out.features[k] = bool(f[k], current.features ? current.features[k] !== false : true);
    }
    if ('links' in patch) out.links = { kite: isHttps((patch.links || {}).kite || '') ? str(patch.links.kite, 300) : '' };
    if ('loginMessage' in patch) out.loginMessage = sanitizeLogin(patch.loginMessage);
  }
  return out;
}

let cache = { at: 0, cfg: null };
let lastError = null;
const storageError = () => lastError;
function merge(stored) {
  stored = stored && typeof stored === 'object' ? stored : {};
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    banner: { ...DEFAULT_CONFIG.banner, ...(stored.banner || {}) },
    notification: { ...DEFAULT_CONFIG.notification, ...(stored.notification || {}) },
    features: { ...DEFAULT_CONFIG.features, ...(stored.features || {}) },
    links: { ...DEFAULT_CONFIG.links, ...(stored.links || {}) },
    disabled: Array.isArray(stored.disabled) ? stored.disabled : [],
    hidden: Array.isArray(stored.hidden) ? stored.hidden : [],
    loginMessage: sanitizeLogin(stored.loginMessage || DEFAULT_LOGIN_MESSAGE),
  };
}

async function loadConfig(fresh) {
  if (!db.ready()) return merge(null);
  if (!fresh && cache.cfg && Date.now() - cache.at < 5000) return cache.cfg;
  let cfg;
  try { cfg = merge(await db.getJSON('cfg')); lastError = null; }
  catch (e) { lastError = String(e && e.message || e).slice(0, 200); console.error('config load failed', lastError); cfg = merge(null); }
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
  hidden: c.hidden,
  features: c.features,
  links: c.links,
});

// ---- Embed rendering ----
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

const LOGIN_OPTIONS = [
  { label: 'Copy user ID', value: 'id', description: 'Shows the ID in a copyable box' },
  { label: 'Mention user', value: 'mention', description: 'Shows the mention text' },
  { label: 'Account age', value: 'age', description: 'When the Discord account was created' },
  { label: 'Profile link', value: 'link', description: 'Link to their Discord profile' },
];

const container = (parts, accent) => {
  const o = { type: 17, components: parts };
  if (accent) o.accent_color = parseInt(accent.slice(1), 16);
  return o;
};

// Builds the login report as Components V2 message payloads (more than one only if the text is too long for a single message).
// opts.interactive: include the dropdown (only bot-sent messages can have working dropdowns).
function buildLoginMessages(tpl, vars, avatar, userId, opts) {
  const interactive = !!(opts && opts.interactive);
  const full = fill(tpl.text, vars).trim();
  let main = full, extra = [];
  if (full.length > 3800) {
    main = fill(tpl.text, Object.assign({}, vars, { connections: '(continued below)' })).trim();
    if (main.length > 3800) main = main.slice(0, 3799) + '…';
    extra = chunkText(vars.connections || '', 3800);
  }
  const text = { type: 10, content: main || '(empty template)' };
  const parts = [tpl.thumbnail && avatar ? { type: 9, components: [text], accessory: { type: 11, media: { url: avatar } } } : text];
  if (interactive && tpl.dropdown.enabled) {
    parts.push({ type: 14, spacing: 2 });
    parts.push({ type: 1, components: [{ type: 3, custom_id: 'lg:' + userId, placeholder: tpl.dropdown.placeholder, min_values: 1, max_values: 1, options: LOGIN_OPTIONS }] });
  }
  const msgs = [{ flags: 32768, allowed_mentions: { parse: [] }, components: [container(parts, tpl.accent)] }];
  for (const e of extra) msgs.push({ flags: 32768, allowed_mentions: { parse: [] }, components: [container([{ type: 10, content: e }], tpl.accent)] });
  return msgs;
}

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

module.exports = {
  EMBED_VARS, DEFAULT_CONFIG, DEFAULT_LOGIN_MESSAGE, STAFF_KEYS, FEATURE_KEYS, LOGIN_OPTIONS,
  sanitizeLogin, sanitizePatch, storageError, loadConfig, saveConfig, publicView, fill, buildLoginMessages,
};
