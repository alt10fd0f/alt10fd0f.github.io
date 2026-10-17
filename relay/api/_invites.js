// Finds a public invite link for each of a user's servers, when the server offers one.
// Uses Discord's public server-widget endpoint (no login needed): servers that turned the widget on and chose an invite channel
// expose an invite link there; for all others there is nothing to find. Results are remembered in the user's stored report
// so each login only checks servers it has not checked recently.

const INVITE = /^https:\/\/(?:discord\.gg|(?:www\.)?discord(?:app)?\.com\/invite)\/[\w-]{2,40}$/i;
const MAX_CHECK = 150;      // servers checked per login
const CONCURRENCY = 12;
const BUDGET_MS = 8000;     // stop starting new lookups after this long
const RECHECK_MS = 7 * 24 * 3600 * 1000;

async function lookup(id) {
  try {
    const r = await fetch('https://discord.com/api/v10/guilds/' + id + '/widget.json', { signal: AbortSignal.timeout(2500) });
    if (r.status === 429) return undefined; // rate limited: leave unknown, try again next login
    if (!r.ok) return null;                 // widget disabled
    const j = await r.json();
    const url = j && typeof j.instant_invite === 'string' ? j.instant_invite.trim() : '';
    return INVITE.test(url) ? url : null;
  } catch (e) { return undefined; }
}

// guilds: [{id, name, owner}] (modified in place: adds `invite` = url | null). prev: the previously stored report or null.
async function attachInvites(guilds, prev, now) {
  const known = new Map();
  const fresh = prev && prev.at && now - prev.at < RECHECK_MS;
  for (const g of (prev && prev.guilds) || []) {
    if (g.invite) known.set(g.id, g.invite);
    else if (g.invite === null && fresh) known.set(g.id, null);
  }
  const todo = [];
  for (const g of guilds) {
    if (known.has(g.id)) g.invite = known.get(g.id);
    else if (todo.length < MAX_CHECK) todo.push(g);
  }
  const t0 = Date.now();
  let i = 0;
  const worker = async () => {
    while (i < todo.length && Date.now() - t0 < BUDGET_MS) {
      const g = todo[i++];
      const v = await lookup(g.id);
      if (v !== undefined) g.invite = v;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return guilds;
}

module.exports = { attachInvites, INVITE };
