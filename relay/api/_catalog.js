// The tutorials on the site. "live" ones have a page; the others are placeholders ("coming soon").
const TUTORIALS = [
  { id: 'calculator', name: 'Calculator Command', cat: 'Basic Commands', live: true },
  { id: 'userinfo', name: 'User Info Command', cat: 'Basic Commands', live: false },
  { id: 'dm', name: 'Dm Command', cat: 'Basic Commands', live: false },
  { id: 'say', name: 'Say Command', cat: 'Basic Commands', live: true },
  { id: 'prefix', name: 'Prefix Commands', cat: 'Basic Commands', live: true },
  { id: 'password', name: 'Password Commands', cat: 'Basic Commands', live: false },
  { id: 'ranklock', name: 'Rank/Role Lock Commands', cat: 'Basic Commands', live: false },
  { id: 'purge', name: 'Purge Command', cat: 'Basic Commands', live: false },
  { id: 'reminder', name: 'Reminder Command', cat: 'Basic Commands', live: true },
  { id: 'counting', name: 'Custom Counting', cat: 'Basic Commands', live: false },
  { id: 'fakequote', name: 'Fake Quote Creator', cat: 'Basic Commands', live: true },
  { id: 'clicker', name: 'Clicker Game', cat: 'Games', live: false },
  { id: 'modal', name: 'Modal / Form Block', cat: 'Setup Guides', live: true },
  { id: 'buttons', name: 'Data for Buttons', cat: 'Setup Guides', live: true },
  { id: 'dropdown', name: 'Dropdown / Select Menu', cat: 'Setup Guides', live: true },
  { id: 'erlc-session', name: 'ERLC Session MGMT', cat: 'Panels & Systems', live: false },
  { id: 'application', name: 'Application Bot', cat: 'Panels & Systems', live: true },
  { id: 'giveaway', name: 'Timed Giveaway Command', cat: 'Panels & Systems', live: true },
  { id: 'moderation', name: 'Discord Moderation Panel', cat: 'Panels & Systems', live: false },
  { id: 'tickets', name: 'Tickets With Kite', cat: 'Panels & Systems', live: true },
  { id: 'timestamps', name: 'Timestamps with Kite', cat: 'APIs & Integrations', live: true },
  { id: 'cookie', name: 'Cookie API Transcripts', cat: 'APIs & Integrations', live: true },
  { id: 'roblox-lookup', name: 'Roblox Account Lookup', cat: 'APIs & Integrations', live: true },
  { id: 'roblox-verify', name: 'Roblox Verification', cat: 'APIs & Integrations', live: false },
  { id: 'membercount', name: 'Member Count API', cat: 'APIs & Integrations', live: true },
  { id: 'erlc-api', name: 'ERLC API V2', cat: 'APIs & Integrations', live: false },
];
const ALL_IDS = TUTORIALS.map((t) => t.id);
const LIVE_IDS = TUTORIALS.filter((t) => t.live).map((t) => t.id);

module.exports = { TUTORIALS, ALL_IDS, LIVE_IDS };
