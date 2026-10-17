// Answers for the login report dropdown (and its page buttons), built as embeds.
// Long lists are split over several embeds (each well under Discord's limits); a message holds up to 3 of them,
// and anything beyond that is reached with the Prev / Next buttons.

const COLOR = 0x94cec4;
const PER_EMBED = 1800;   // characters of text in one embed
const EMBEDS_PER_PAGE = 3; // 3 x 1800 stays under Discord's 6000-character total per message
const clean = (s) => String(s == null ? '' : s).replace(/[`*_~|>\\]/g, '');
const yn = (v) => (v ? 'Yes' : 'No');

function chunk(lines) {
  const out = [];
  let cur = '';
  for (let l of lines) {
    if (l.length > PER_EMBED) l = l.slice(0, PER_EMBED - 1) + '…';
    if (cur && (cur + '\n' + l).length > PER_EMBED) { out.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) out.push(cur);
  return out.length ? out : ['(nothing to show)'];
}

function paged(title, lines, r, pick, uid, page) {
  const parts = chunk(lines);
  const pages = Math.ceil(parts.length / EMBEDS_PER_PAGE);
  page = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const slice = parts.slice(page * EMBEDS_PER_PAGE, (page + 1) * EMBEDS_PER_PAGE);
  const embeds = slice.map((text, i) => {
    const e = { color: COLOR, description: text };
    e.title = page === 0 && i === 0 ? title : title.replace(/ \(\d+\)$/, '') + ' (continued)';
    if (i === slice.length - 1) {
      e.footer = { text: (pages > 1 ? 'Page ' + (page + 1) + '/' + pages + ' · ' : '') + 'Saved at their last login' };
      if (r && r.at) e.timestamp = new Date(r.at).toISOString();
    }
    return e;
  });
  const out = { embeds, allowed_mentions: { parse: [] } };
  if (pages > 1) {
    const b = (label, p, off) => ({ type: 2, style: 2, label, custom_id: 'lgp:' + uid + ':' + pick + ':' + p, disabled: off });
    out.components = [{ type: 1, components: [b('◀ Previous', page - 1, page === 0), { type: 2, style: 2, label: (page + 1) + ' / ' + pages, custom_id: 'lgn:' + uid, disabled: true }, b('Next ▶', page + 1, page >= pages - 1)] }];
  } else out.components = [];
  return out;
}

const one = (title, description) => ({ embeds: [{ color: COLOR, title, description }], allowed_mentions: { parse: [] }, components: [] });

// pick: id | mention | age | link | servers | other ; r: the stored report (or null)
function view(pick, uid, r, page) {
  const created = Math.floor((Number(BigInt(uid) >> 22n) + 1420070400000) / 1000);
  if (pick === 'id') return one('User ID', '`' + uid + '`');
  if (pick === 'mention') return one('Mention', '`<@' + uid + '>`');
  if (pick === 'age') return one('Account age', 'Created <t:' + created + ':F> (<t:' + created + ':R>)');
  if (pick === 'link') return one('Profile link', 'https://discord.com/users/' + uid);
  if (pick === 'connections') return one('Connected accounts', 'Connected accounts are no longer collected.');
  if (pick !== 'servers' && pick !== 'other') return one('Unknown option', 'That option is not available.');
  if (!r) return one('No stored data', 'There is nothing stored for this user yet. They may have logged in before this was added, or their data was deleted.');
  if (pick === 'servers') {
    if (!r.guilds) return one('Servers', 'Their server list was not shared (the servers permission was not granted).');
    const lines = r.guilds.map((g) => '**' + clean(g.name) + '** · `' + g.id + '`' + (g.owner ? ' · 👑 owner' : '') + (g.invite && /^https:\/\/[\w./-]+$/.test(g.invite) ? ' · [invite](' + g.invite + ')' : ''));
    const total = r.guildCount != null ? r.guildCount : r.guilds.length;
    const withInvite = r.guilds.filter((g) => g.invite).length;
    lines.push('-# Invite links: ' + withInvite + ' of ' + r.guilds.length + ' servers have a public invite (servers must turn on their widget with an invite channel).');
    if (total > r.guilds.length) lines.push('…and ' + (total - r.guilds.length) + ' more not stored');
    return paged('Servers (' + total + ')', lines, r, pick, uid, page);
  }
  const o = r.other || {};
  const lines = [
    'Username • `@' + clean(o.handle || '?') + '`',
    'Discord display name • ' + clean(o.globalName || 'None set'),
    'Name used on this site • ' + clean(o.siteName || 'Same as Discord'),
    'Email verified by Discord • ' + yn(o.emailVerified) + ' (shared in reports: ' + yn(o.emailShared) + ')',
    'Locale • ' + clean(o.locale || 'unknown'),
    'Badges • ' + ((o.badges || []).length ? o.badges.join(', ') : 'None'),
    'Accent color • ' + (o.accentColor ? '`' + o.accentColor + '`' : 'None'),
    'Avatar • ' + (o.avatar || 'Default'),
    'Banner • ' + (o.banner || 'None'),
    'Servers • ' + (r.guildCount != null ? r.guildCount : 'Not shared'),
    'First seen on site • ' + (o.firstSeen ? '<t:' + Math.floor(o.firstSeen / 1000) + ':F>' : 'unknown'),
    'Logins • ' + (o.logins || 1),
    'Permissions granted • ' + ((o.scopes || []).join(', ') || 'unknown'),
  ];
  return paged('Other data', lines, r, pick, uid, page);
}

module.exports = { view };
