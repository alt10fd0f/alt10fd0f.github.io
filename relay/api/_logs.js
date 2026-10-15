// Log delivery. Each event (login, support) can go to the built-in logs (bot thread / ticket channel),
// to a webhook trigger (any https URL, Discord webhooks get a proper message), or both. Chosen in the admin panel.

const { sleep } = require('./_shared');

const EVENTS = ['login', 'support'];
const MODES = ['builtin', 'webhook', 'both'];
const DEFAULT_LOGGING = { login: { mode: 'builtin', url: '' }, support: { mode: 'builtin', url: '' } };

const DISCORD_HOOK = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/i;

// https only, no localhost / IP literals / internal names (the owner sets this, but keep the relay from being pointed inward).
function safeUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    if (x.protocol !== 'https:' || x.username || x.password) return '';
    const h = x.hostname.toLowerCase();
    if (!h.includes('.') || h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':') || /\.(local|internal|lan|home|localhost)$/.test(h)) return '';
    return x.toString().slice(0, 500);
  } catch (e) { return ''; }
}

function sanitizeLogging(l, cur) {
  l = l && typeof l === 'object' ? l : {};
  const out = {};
  for (const ev of EVENTS) {
    const x = l[ev] && typeof l[ev] === 'object' ? l[ev] : {};
    const prev = (cur && cur[ev]) || DEFAULT_LOGGING[ev];
    // An empty url field keeps the saved one unless "clear" is set, so staff views that mask it can't wipe it.
    const url = x.clear ? '' : typeof x.url === 'string' && x.url.trim() ? safeUrl(x.url) : prev.url;
    let mode = MODES.includes(x.mode) ? x.mode : 'builtin';
    if (mode !== 'builtin' && !url) mode = 'builtin';
    out[ev] = { mode, url };
  }
  return out;
}

const wants = (cfg, ev, what) => {
  const l = (cfg.logging && cfg.logging[ev]) || DEFAULT_LOGGING[ev];
  if (what === 'builtin') return l.mode !== 'webhook';
  return l.mode !== 'builtin' && !!l.url;
};
const urlOf = (cfg, ev) => ((cfg.logging && cfg.logging[ev]) || DEFAULT_LOGGING[ev]).url;

async function post(url, body, attempt) {
  try {
    const isDiscord = DISCORD_HOOK.test(url);
    const target = isDiscord ? url + (body.components ? '?with_components=true' : '') : url;
    const r = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'KiteTutorials-Webhook/1.0' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (r.status === 429 && !attempt) { await sleep(1200); return post(url, body, 1); }
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, status: 0 }; }
}

// payload: { event, data (generic JSON), discord: [ready-made Discord message bodies] }
async function sendWebhook(url, payload) {
  if (!url) return { ok: false, status: 0 };
  if (DISCORD_HOOK.test(url)) {
    let last = { ok: true, status: 204 };
    const msgs = payload.discord || [];
    for (let i = 0; i < msgs.length; i++) {
      if (i) await sleep(500);
      last = await post(url, Object.assign({ username: 'Kite Tutorials', allowed_mentions: { parse: [] } }, msgs[i]));
      if (!last.ok) return last;
    }
    return last;
  }
  return post(url, { event: payload.event, time: new Date().toISOString(), data: payload.data || {} });
}

module.exports = { EVENTS, MODES, DEFAULT_LOGGING, DISCORD_HOOK, safeUrl, sanitizeLogging, wants, urlOf, sendWebhook };
