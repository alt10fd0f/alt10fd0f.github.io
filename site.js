/* Shared site shell: Discord login, header icons, theme, user panel, support form, banner/notifications,
   and maintenance cover. Pages call Site.init({ header: '#nav-right' }). */
(function () {
  'use strict';
  var CLIENT_ID = '1520497604360671263';
  var REDIRECT = 'https://alt10fd0f.github.io/';
  var API = 'https://kite-login-notify-sanfranrps.vercel.app/api/';
  var OWNER_ID = '989152479222579260';
  var SCOPES = 'guilds email identify';
  var AUTH_KEY = 'discord_auth_v2';
  var OWNER_PROFILE = 'https://discord.com/users/' + OWNER_ID;
  var GITHUB_URL = 'https://github.com/alt10fd0f/alt10fd0f.github.io';
  var ICONS = { discord: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z', github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' };

  var listeners = [];
  var S = { auth: null, cfg: null, ratings: {}, me: null, storage: true };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  var ssGet = function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  var ssSet = function (k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} };

  function emit() { listeners.forEach(function (f) { try { f(S); } catch (e) { console.error(e); } }); }
  function on(f) { listeners.push(f); }

  // ---------- auth ----------
  function authRead() { try { var a = JSON.parse(lsGet(AUTH_KEY)); return a && a.expires > Date.now() ? a : null; } catch (e) { return null; } }
  function authWrite(a) { lsSet(AUTH_KEY, a ? JSON.stringify(a) : null); S.auth = a; }
  function avatarOf(u) { return u.avatar ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=64' : 'https://cdn.discordapp.com/embed/avatars/' + Number((BigInt(u.id) >> 22n) % 6n) + '.png'; }
  function nameOf(u) { return (S.me && S.me.profile && S.me.profile.nickname) || u.global_name || u.username; }
  function login(opts) {
    opts = opts || {};
    var state = crypto.getRandomValues(new Uint32Array(4)).join('-');
    ssSet('discord_state', state);
    if (opts.returnTo) ssSet('return_to', opts.returnTo);
    location.href = 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(CLIENT_ID) + '&response_type=token&redirect_uri=' + encodeURIComponent(REDIRECT) +
      '&scope=' + encodeURIComponent(SCOPES) + '&state=' + state + (opts.switchAccount ? '&prompt=consent' : '');
  }
  function logout() { authWrite(null); S.me = null; renderHeader(); emit(); }

  async function api(name, body) {
    var a = S.auth;
    try {
      var r = await fetch(API + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token: a && a.token }, body)) });
      var j = await r.json().catch(function () { return {}; });
      if ((r.status === 401 || (r.status === 400 && j.error === 'bad token')) && a) { authWrite(null); S.me = null; renderHeader(); emit(); }
      return { ok: r.ok, status: r.status, json: j };
    } catch (e) { return { ok: false, status: 0, json: { error: 'The site\'s server is not responding right now (it may be updating). Nothing was saved. Please try again later.' } }; }
  }

  async function handleReturn() {
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('access_token')) return false;
    var token = p.get('access_token'), expires = Number(p.get('expires_in') || 0) * 1000;
    var ok = !!p.get('state') && p.get('state') === ssGet('discord_state');
    ssSet('discord_state', null);
    history.replaceState(null, '', location.pathname + location.search);
    if (!ok) return false;
    try {
      var r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) return false;
      authWrite({ token: token, expires: Date.now() + expires, user: await r.json() });
      fetch(API + 'notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) }).catch(function () {});
      var back = ssGet('return_to'); ssSet('return_to', null);
      if (back && back !== location.pathname.split('/').pop()) { location.replace(back); return true; }
    } catch (e) {}
    return false;
  }

  // ---------- data ----------
  async function loadPublic() {
    try {
      var r = await fetch(API + 'public');
      if (!r.ok) return;
      var j = await r.json();
      S.cfg = j.config; S.ratings = j.ratings || {}; S.storage = j.storage !== false;
    } catch (e) {}
  }
  async function loadMe() {
    if (!S.auth) { S.me = null; return; }
    var r = await api('user', { action: 'me' });
    S.me = r.ok ? r.json : null;
  }
  var isStaff = function () { return !!((S.me && S.me.role) || (S.auth && S.auth.user && S.auth.user.id === OWNER_ID)); };

  // ---------- header ----------
  var KITE_ICON = 'kite-icon.png';
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>'; }
  function renderHeader() {
    var host = S.headerEl; if (!host) return;
    var kite = S.cfg && S.cfg.links && S.cfg.links.kite;
    var html = '<div class="auth-slot">';
    if (S.auth) html += '<button class="user-btn" id="s-user" type="button" title="Your account"><img alt="" src="' + esc(avatarOf(S.auth.user)) + '"><span>' + esc(nameOf(S.auth.user)) + '</span></button>';
    else html += '<button class="login-btn" id="s-login" type="button">Login with Discord</button>';
    html += '</div>';
    html += '<button class="icon-btn" id="s-theme" type="button" title="Switch dark / light mode" aria-label="Switch dark or light mode"></button>';
    html += '<a class="icon-btn" href="' + OWNER_PROFILE + '" target="_blank" rel="noopener" title="ALT10fd0f on Discord" aria-label="Discord profile">' + icon('discord') + '</a>';
    html += kite ? '<a class="icon-btn" href="' + esc(kite) + '" target="_blank" rel="noopener" title="Kite on Discord" aria-label="Kite Discord"><img alt="" src="' + KITE_ICON + '"></a>'
      : '<span class="icon-btn off" title="Kite Discord link not set yet"><img alt="" src="' + KITE_ICON + '"></span>';
    host.innerHTML = html;
    var u = $('s-user'); if (u) u.addEventListener('click', openUser);
    var l = $('s-login'); if (l) l.addEventListener('click', function () { openLogin(); });
    $('s-theme').addEventListener('click', toggleTheme);
    paintTheme();
  }

  // ---------- theme ----------
  function theme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
  function paintTheme() { var b = $('s-theme'); if (b) b.textContent = theme() === 'light' ? '☾' : '☀'; if (b) b.style.fontSize = '1.1rem'; }
  function setTheme(t) {
    document.documentElement.dataset.theme = t; lsSet('site_theme', t); paintTheme();
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#ffffff' : '#94CEC4';
    document.querySelectorAll('iframe').forEach(function (f) { try { f.contentDocument.documentElement.dataset.theme = t; } catch (e) {} });
  }
  function toggleTheme() { setTheme(theme() === 'light' ? 'dark' : 'light'); }

  // ---------- popups ----------
  function overlay(id, inner, cls) {
    var o = document.createElement('div');
    o.className = 'auth-overlay'; o.id = id; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.innerHTML = '<div class="auth-card ' + (cls || '') + '">' + inner + '</div>';
    o.addEventListener('mousedown', function (e) { if (e.target === o) o.classList.remove('show'); });
    document.body.appendChild(o);
    return o;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.querySelectorAll('.auth-overlay.show').forEach(function (o) { if (o.id !== 'o-maint') o.classList.remove('show'); }); });

  function buildLogin() {
    overlay('o-login',
      '<h2>Welcome to Kite Tutorials</h2>' +
      '<p id="l-note" class="auth-note"></p>' +
      '<p>Log in with Discord so we know who you are. When you log in, the site owner is sent your Discord username, avatar, email address, basic account details (locale, account age, 2FA and Nitro status), the list of servers you are in (and whether you are in the Kite support server). A copy of your server list and these details is kept so the site owner can view them in your login report, and is deleted if you request data deletion. Nothing else is collected.</p>' +
      '<button class="login-btn" id="l-go" type="button">Login with Discord</button>' +
      '<p class="legal">By logging in you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> and the <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>' +
      '<div style="text-align:center"><button class="auth-skip" id="l-skip" type="button">Not now</button></div>', 'center');
    $('l-go').addEventListener('click', function () { login({ returnTo: ssGet('login_return') || undefined }); });
    $('l-skip').addEventListener('click', function () { $('o-login').classList.remove('show'); ssSet('login_dismissed', '1'); });
  }
  function openLogin(note, after) {
    if (after) ssSet('after_login', after);
    var n = $('l-note'); n.textContent = note || ''; n.style.display = note ? 'block' : 'none';
    $('o-login').classList.add('show');
  }
  function requireLogin(note, after) { if (S.auth) return true; ssSet('login_dismissed', null); openLogin(note, after); return false; }

  // support form
  function buildSupport() {
    var o = overlay('o-support',
      '<h2>Submit a support request</h2><p class="status" id="sp-as" style="margin:0 0 .3rem"></p>' +
      '<form id="sp-form"><label class="lbl" for="sp-cat">Category</label><select id="sp-cat" required><option>Question</option><option>Bug report</option><option>Tutorial request</option><option>Other</option></select>' +
      '<label class="lbl" for="sp-sub">Subject</label><input id="sp-sub" type="text" minlength="3" maxlength="100" required autocomplete="off">' +
      '<label class="lbl" for="sp-msg">Message</label><textarea id="sp-msg" rows="6" minlength="10" maxlength="1500" required></textarea>' +
      '<div class="sup-count"><span id="sp-count">0</span>/1500</div>' +
      '<p class="legal">Your request is sent to the support team on Discord, and a copy is sent to you by DM from the Kite Tutorials bot (make sure your DMs are open). Your Discord username and, unless you turned it off in your account panel, your email are included so we can reply.</p>' +
      '<div class="sup-actions"><button type="button" class="auth-skip" id="sp-cancel">Cancel</button><button type="submit" class="login-btn" id="sp-send">Send request</button></div>' +
      '<div class="status" id="sp-status" role="status"></div></form>', 'sup-card');
    $('sp-cancel').addEventListener('click', function () { o.classList.remove('show'); });
    $('sp-msg').addEventListener('input', function (e) { $('sp-count').textContent = e.target.value.length; });
    $('sp-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var st = $('sp-status'), btn = $('sp-send');
      if (!S.auth) { st.className = 'status err'; st.textContent = 'Your login expired. Please log in again.'; return; }
      btn.disabled = true; st.className = 'status'; st.textContent = 'Sending...';
      var r = await api('support', { category: $('sp-cat').value, subject: $('sp-sub').value, message: $('sp-msg').value });
      btn.disabled = false;
      if (r.ok) {
        st.className = 'status ok'; st.textContent = r.json.dm === false ? 'Request sent! (We could not DM you a copy, so check that your DMs are open.)' : 'Request sent! A copy was sent to your Discord DMs.';
        $('sp-form').reset(); $('sp-count').textContent = '0';
        setTimeout(function () { o.classList.remove('show'); }, 2600);
      } else { st.className = 'status err'; st.textContent = r.json.error || 'Something went wrong. Please try again.'; }
    });
  }
  function openSupport() {
    if (!requireLogin('Log in to submit a support request.', 'support')) return;
    var u = S.auth.user; $('sp-as').textContent = 'Submitting as ' + nameOf(u) + ' (@' + u.username + ')';
    $('sp-status').textContent = ''; $('o-support').classList.add('show'); $('sp-sub').focus();
  }

  // showcase submission form (goes to the owner's webhook trigger / staff channel)
  function buildSubmit() {
    var cats = ['Basic Commands', 'Games', 'Setup Guides', 'Panels & Systems', 'APIs & Integrations', 'Other'];
    var o = overlay('o-submit',
      '<h2>Submit a showcase</h2><p class="status" id="sb-as" style="margin:0 0 .3rem"></p>' +
      '<form id="sb-form"><label class="lbl" for="sb-title">Title</label><input id="sb-title" type="text" minlength="3" maxlength="80" required autocomplete="off" placeholder="e.g. Welcome message with buttons">' +
      '<label class="lbl" for="sb-cat">Category</label><select id="sb-cat" required>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="lbl" for="sb-link">Link to your showcase (optional)</label><input id="sb-link" type="url" maxlength="300" placeholder="https://discord.com/channels/..." autocomplete="off">' +
      '<label class="lbl" for="sb-text">Your showcase</label><textarea id="sb-text" rows="8" minlength="30" maxlength="6000" required placeholder="Explain what it does and the steps to build it. Share codes are not needed."></textarea>' +
      '<div class="sup-count"><span id="sb-count">0</span>/6000</div>' +
      '<p class="legal">Your submission is sent to the site owner. Your Discord username and ID and, unless you turned it off in your account panel, your email are included so I can contact you. By submitting you allow me to review it and, if I like it, publish it on this site. Only submit your own work.</p>' +
      '<div class="sup-actions"><button type="button" class="auth-skip" id="sb-cancel">Cancel</button><button type="submit" class="login-btn" id="sb-send">Submit showcase</button></div>' +
      '<div class="status" id="sb-status" role="status"></div></form>', 'sup-card');
    $('sb-cancel').addEventListener('click', function () { o.classList.remove('show'); });
    $('sb-text').addEventListener('input', function (e) { $('sb-count').textContent = e.target.value.length; });
    $('sb-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var st = $('sb-status'), btn = $('sb-send');
      if (!S.auth) { st.className = 'status err'; st.textContent = 'Your login expired. Please log in again.'; return; }
      btn.disabled = true; st.className = 'status'; st.textContent = 'Sending...';
      var r = await api('submit', { title: $('sb-title').value, category: $('sb-cat').value, link: $('sb-link').value, content: $('sb-text').value });
      btn.disabled = false;
      if (r.ok) {
        st.className = 'status ok'; st.textContent = 'Thank you! Your showcase was submitted.';
        $('sb-form').reset(); $('sb-count').textContent = '0';
        setTimeout(function () { o.classList.remove('show'); }, 2400);
      } else { st.className = 'status err'; st.textContent = r.json.error || 'Something went wrong. Please try again.'; }
    });
  }
  function openSubmit() {
    if (!requireLogin('Log in to submit a showcase.', 'submit')) return;
    var u = S.auth.user; $('sb-as').textContent = 'Submitting as ' + nameOf(u) + ' (@' + u.username + ')';
    $('sb-status').textContent = ''; $('o-submit').classList.add('show'); $('sb-title').focus();
  }

  // user panel
  function buildUser() {
    var o = overlay('o-user', '<div id="u-body"></div>', 'up-card');
    return o;
  }
  function openUser() {
    if (!S.auth) return openLogin();
    var u = S.auth.user, p = (S.me && S.me.profile) || { nickname: '', shareEmail: true };
    var favs = (S.me && S.me.favorites || []).length, rated = S.me ? Object.keys(S.me.myRatings || {}).length : 0;
    var role = (S.me && S.me.role) || (S.auth && S.auth.user && S.auth.user.id === OWNER_ID ? 'owner' : null);
    $('u-body').innerHTML =
      '<div class="up-head"><img alt="" src="' + esc(avatarOf(u)) + '"><div><b>' + esc(u.global_name || u.username) + '</b><small>@' + esc(u.username) + (role ? ' · ' + role : '') + '</small></div></div>' +
      '<h3>Your information</h3>' +
      '<label class="lbl" for="u-nick">Display name on this site (shown in login reports and support requests)</label>' +
      '<input id="u-nick" type="text" maxlength="32" placeholder="' + esc(u.global_name || u.username) + '" value="' + esc(p.nickname || '') + '">' +
      '<label class="chk"><input id="u-email" type="checkbox"' + (p.shareEmail !== false ? ' checked' : '') + '><span>Include my email address in login reports and support requests</span></label>' +
      '<div class="row-actions"><button class="btn2 primary" id="u-save" type="button">Save</button></div>' +
      '<div class="status" id="u-status" role="status"></div>' +
      (S.storage ? '' : '<p class="up-data">Saving is not available right now (storage is not set up).</p>') +
      '<hr><h3>Your data</h3>' +
      '<p class="up-data">Stored about you: your Discord ID, username, display name and avatar id, your display preferences above, ' + favs + ' favorite tutorial(s), ' + rated + ' difficulty rating(s), and your support request records. ' +
      'See the <a href="privacy.html" target="_blank" rel="noopener" style="color:var(--accent)">Privacy Policy</a>.</p>' +
      '<div class="row-actions"><button class="btn2 danger" id="u-del" type="button">Request data deletion</button></div>' +
      '<hr><div class="row-actions">' +
      (role ? '<a class="btn2" href="admin.html">Admin panel</a>' : '') +
      '<button class="btn2" id="u-switch" type="button">Switch account</button><button class="btn2" id="u-out" type="button">Log out</button><button class="auth-skip" id="u-close" type="button" style="margin:0 0 0 auto">Close</button></div>';
    $('u-close').addEventListener('click', function () { $('o-user').classList.remove('show'); });
    $('u-out').addEventListener('click', function () { $('o-user').classList.remove('show'); logout(); });
    $('u-switch').addEventListener('click', function () { authWrite(null); login({ switchAccount: true }); });
    $('u-save').addEventListener('click', async function () {
      var st = $('u-status'); st.className = 'status'; st.textContent = 'Saving...';
      var r = await api('user', { action: 'profile', nickname: $('u-nick').value, shareEmail: $('u-email').checked });
      if (r.ok) { S.me.profile = r.json.profile; st.className = 'status ok'; st.textContent = 'Saved.'; renderHeader(); emit(); }
      else { st.className = 'status err'; st.textContent = r.json.error || 'Could not save.'; }
    });
    $('u-del').addEventListener('click', function () {
      $('u-body').innerHTML = '<h2>Delete your data?</h2><p>This erases what the site stores about you: your profile and preferences, favorites, difficulty ratings and support request records. You will be logged out.</p>' +
        '<p class="up-data">Copies of past messages already in Discord (the login reports and support requests our team received) are removed by the site owner, who is notified of your request. Discord itself keeps its own data about you; manage that in Discord.</p>' +
        '<label class="chk"><input id="d-ok" type="checkbox"><span>I understand this cannot be undone.</span></label>' +
        '<div class="row-actions"><button class="btn2 danger" id="d-go" type="button" disabled>Delete my data</button><button class="auth-skip" id="d-no" type="button" style="margin:0">Cancel</button></div><div class="status" id="d-status"></div>';
      $('d-ok').addEventListener('change', function (e) { $('d-go').disabled = !e.target.checked; });
      $('d-no').addEventListener('click', openUser);
      $('d-go').addEventListener('click', async function () {
        $('d-go').disabled = true; $('d-status').textContent = 'Deleting...';
        var r = await api('user', { action: 'delete', confirm: true });
        if (r.ok) { $('d-status').className = 'status ok'; $('d-status').textContent = 'Your data was deleted.'; setTimeout(function () { $('o-user').classList.remove('show'); logout(); }, 1400); }
        else { $('d-status').className = 'status err'; $('d-status').textContent = r.json.error || 'Could not delete. Please try again.'; $('d-go').disabled = false; }
      });
    });
    $('o-user').classList.add('show');
  }

  // ---------- banner, notification, maintenance ----------
  function buildChrome() {
    var b = document.createElement('div'); b.className = 'site-banner'; b.id = 'site-banner'; document.body.insertBefore(b, document.body.firstChild);
    var t = document.createElement('div'); t.className = 'site-toast'; t.id = 'site-toast'; t.setAttribute('role', 'status'); t.innerHTML = '<button type="button" aria-label="Dismiss">×</button><b></b><p></p>'; document.body.appendChild(t);
    t.querySelector('button').addEventListener('click', function () { t.classList.remove('show'); lsSet('seen_notif', t.dataset.id); });
    var m = document.createElement('div'); m.className = 'maint'; m.id = 'o-maint';
    m.innerHTML = '<div class="box"><h1>Be right back</h1><p id="m-text"></p><button class="login-btn" id="m-login" type="button" style="display:inline-block">Staff login</button></div>'; document.body.appendChild(m);
    $('m-login').addEventListener('click', function () { login(); });
    var r = document.createElement('div'); r.className = 'admin-ribbon'; r.id = 'admin-ribbon'; r.textContent = 'The site is switched off for visitors. You can see it because you are staff.'; document.body.appendChild(r);
  }
  function paintChrome() {
    var c = S.cfg; if (!c) return;
    var b = $('site-banner'), on = c.banner && c.banner.enabled && c.banner.text;
    document.documentElement.classList.toggle('has-banner', !!on);
    if (on) { b.className = 'site-banner ' + (c.banner.style || 'info'); b.innerHTML = esc(c.banner.text) + (c.banner.link ? ' <a href="' + esc(c.banner.link) + '" target="_blank" rel="noopener">Learn more</a>' : ''); }
    var n = c.notification, t = $('site-toast');
    if (n && n.enabled && (n.text || n.title) && lsGet('seen_notif') !== n.id) { t.dataset.id = n.id; t.querySelector('b').textContent = n.title || 'Notice'; t.querySelector('p').textContent = n.text; t.classList.add('show'); }
    else t.classList.remove('show');
    var off = c.siteEnabled === false, staff = isStaff();
    $('m-text').textContent = c.maintenanceMessage || '';
    $('o-maint').classList.toggle('show', off && !staff);
    $('admin-ribbon').classList.toggle('show', off && staff);
  }

  // ---------- init ----------
  async function init(opts) {
    opts = opts || {};
    S.headerEl = opts.header ? document.querySelector(opts.header) : null;
    S.auth = authRead();
    lsSet('discord_auth', null);
    buildChrome(); buildLogin(); buildSupport(); buildSubmit(); buildUser();
    renderHeader();
    if (await handleReturn()) return;
    S.auth = authRead();
    await Promise.all([loadPublic(), loadMe()]);
    renderHeader(); paintChrome(); emit();
    // post-login actions
    if (S.auth) {
      var after = ssGet('after_login'); ssSet('after_login', null);
      if (after === 'support') openSupport();
      if (after === 'submit') openSubmit();
    } else if (opts.promptLogin !== false && !ssGet('login_dismissed') && (!S.cfg || S.cfg.features.loginPrompt !== false)) openLogin();
    var sb = $('support-open'); if (sb) sb.addEventListener('click', openSupport);
    var sub = $('submit-open'); if (sub) sub.addEventListener('click', openSubmit);
    var hint = $('support-hint'); var paintHint = function () { if (hint) hint.textContent = S.auth ? 'Submitting as ' + nameOf(S.auth.user) + '.' : 'You need to be logged in with Discord to submit a request.'; };
    on(paintHint); paintHint();
    on(function () { paintChrome(); });
    // live refresh (ratings, banner, notification, maintenance)
    setInterval(async function () { if (document.hidden) return; await loadPublic(); renderHeader(); emit(); }, 15000);
    document.addEventListener('visibilitychange', async function () { if (!document.hidden) { await loadPublic(); emit(); } });
  }


  // ---------- tiny safe markdown (used for admin-made showcases) ----------
  // Everything is HTML-escaped first; only a fixed set of tags is produced. Links/images must be https (or a file in this site).
  function md(src) {
    var E = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
    var okImg = function (u) { return /^https:\/\/[^\s"']+$/i.test(u) || /^[\w][\w./-]*\.(png|jpe?g|gif|webp|svg)$/i.test(u); };
    function inline(t) {
      t = E(t);
      var codes = [];
      t = t.replace(/`([^`\n]+)`/g, function (m, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
      t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, u) { return okImg(u.replace(/&amp;/g, '&')) ? '<img src="' + u + '" alt="' + alt + '" loading="lazy">' : m; });
      t = t.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      t = t.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,:;!?])/g, '$1<em>$2</em>').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,:;!?])/g, '$1<em>$2</em>');
      return t.replace(/\u0000(\d+)\u0000/g, function (m, i) { return '<code>' + codes[+i] + '</code>'; });
    }
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n'), out = [], i = 0, para = [], stack = [];
    function flushPara() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    function closeLists(to) { while (stack.length > to) out.push('</li></' + stack.pop().tag + '>'); }
    while (i < lines.length) {
      var ln = lines[i], m;
      if (/^\s*```/.test(ln)) {
        var fi = /^\s*/.exec(ln)[0].length; // a fence indented under a list item stays inside that item
        flushPara(); if (!(fi && stack.length)) closeLists(0); var buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(fi ? lines[i].slice(Math.min(fi, /^\s*/.exec(lines[i])[0].length)) : lines[i]); i++; }
        i++; out.push('<pre><code>' + E(buf.join('\n')) + '</code></pre>'); continue;
      }
      if ((m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(ln)) && !/^-#\s/.test(ln)) {
        flushPara();
        var depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2) + 1, tag = /\d/.test(m[2]) ? 'ol' : 'ul';
        if (depth > stack.length + 1) depth = stack.length + 1;
        if (depth <= stack.length) { closeLists(depth); out.push('</li><li>'); }
        else { out.push('<' + tag + (tag === 'ul' ? ' class="md-list"' : '') + '><li>'); stack.push({ tag: tag }); }
        out.push(inline(m[3])); i++; continue;
      }
      if (stack.length && /^\s+\S/.test(ln)) { out.push('<br>' + inline(ln.trim())); i++; continue; }
      closeLists(0);
      if (!ln.trim()) { flushPara(); i++; continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(ln))) { flushPara(); var lvl = m[1].length >= 3 ? 'h3' : 'h2'; out.push('<' + lvl + '>' + inline(m[2]) + '</' + lvl + '>'); i++; continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(ln)) { flushPara(); out.push('<hr>'); i++; continue; }
      if ((m = /^-#\s+(.*)$/.exec(ln))) { flushPara(); out.push('<p class="md-sub">' + inline(m[1]) + '</p>'); i++; continue; }
      if (/^>\s?/.test(ln)) {
        flushPara(); var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<div class="md-note">' + q.map(inline).join('<br>') + '</div>'); continue;
      }
      para.push(ln); i++;
    }
    flushPara(); closeLists(0);
    return out.join('');
  }

  window.Site = {
    state: S, apiBase: API, md: md, init: init, on: on, api: api, login: login, logout: logout, openLogin: openLogin, requireLogin: requireLogin, openSupport: openSupport, openSubmit: openSubmit,
    isStaff: isStaff, esc: esc, emit: emit, setTheme: setTheme, reloadPublic: loadPublic, reloadMe: loadMe, avatarOf: avatarOf, OWNER_ID: OWNER_ID,
  };
})();
