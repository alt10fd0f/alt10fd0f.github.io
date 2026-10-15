/* Home page features: favorites (star filter), difficulty ratings (live), search, disabled tutorials. Needs site.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = Site.state;
  var LIVE = ['reminder', 'fakequote', 'modal', 'buttons', 'dropdown', 'application', 'tickets', 'timestamps', 'cookie', 'membercount', 'prefix', 'roblox-lookup'];
  var current = null;   // tutorial id being viewed, or null
  var favOnly = false;
  var favs = function () { return new Set((S.me && S.me.favorites) || []); };
  var disabled = function () { return new Set(S.cfg && S.cfg.disabled || []); };
  var hiddenIds = function () { return new Set(S.cfg && S.cfg.hidden || []); };
  var canSee = function () { return Site.isStaff(); };
  var ratingText = function (id) { var r = S.ratings[id]; return r && r.count ? r.avg.toFixed(1) + '/5' : '–/5'; };
  var starHtml = function (on) { return on ? '★' : '☆'; };

  // ---- map sidebar links to tutorial ids ----
  var HREF_TID = { '#reminder': 'reminder', '#fakequote': 'fakequote', '#modal': 'modal', '#buttons': 'buttons', '#dropdown': 'dropdown', '#application': 'application', '#timestamps': 'timestamps', '#cookie': 'cookie', '#membercount': 'membercount', '#prefix': 'prefix', '#roblox-lookup': 'roblox-lookup' };
  document.querySelectorAll('.sidebar a.sidebar-item').forEach(function (a) { var t = HREF_TID[a.getAttribute('href')]; if (t) a.dataset.tid = t; });
  document.querySelectorAll('.sidebar .sidebar-toggle').forEach(function (t) { if (/Tickets/i.test(t.textContent)) t.dataset.tid = 'tickets'; });

  // ---- favorite stars + difficulty badges on the cards ----
  function ensureMeta(c) {
    if (c.querySelector('.card-meta')) return;
    var meta = document.createElement('span'); meta.className = 'card-meta';
    meta.innerHTML = '<span class="diff" title="Average difficulty (1 easy - 5 hard)"></span><button type="button" class="fav-btn" aria-label="Favorite" title="Favorite"></button>';
    c.appendChild(meta);
    meta.querySelector('.fav-btn').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleFav(c.id); });
  }
  document.querySelectorAll('.tutorial-card').forEach(function (c) { if (LIVE.includes(c.id)) ensureMeta(c); });

  // ---- tutorial bar (favorite + rating) above an open tutorial ----
  var bar = $('tut-bar');
  function paintBar() {
    if (!bar) return;
    if (!current || !LIVE.includes(current)) { bar.hidden = true; return; }
    bar.hidden = false;
    var f = favs().has(current), mine = S.me && S.me.myRatings ? S.me.myRatings[current] || 0 : 0, r = S.ratings[current] || { count: 0, avg: 0 };
    var ratingsOn = !(S.cfg && S.cfg.features.ratings === false), favOn = !(S.cfg && S.cfg.features.favorites === false);
    var pips = '';
    for (var i = 1; i <= 5; i++) pips += '<button type="button" class="pip' + (i <= mine ? ' on' : '') + '" data-v="' + i + '" aria-label="Rate difficulty ' + i + ' out of 5" title="' + ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'][i - 1] + '">' + i + '</button>';
    bar.innerHTML =
      (favOn ? '<button type="button" class="fav-btn big' + (f ? ' on' : '') + '" id="tb-fav" title="' + (f ? 'Remove from favorites' : 'Add to favorites') + '">' + starHtml(f) + ' <span>' + (f ? 'Favorited' : 'Favorite') + '</span></button>' : '<span></span>') +
      (ratingsOn ? '<div class="tb-rate"><span class="tb-avg">Difficulty <b>' + ratingText(current) + '</b>' + (r.count ? ' <small>(' + r.count + ' rating' + (r.count === 1 ? '' : 's') + ')</small>' : '') + '</span>' +
        '<span class="tb-pips" title="Rate this tutorial\'s difficulty">' + pips + '</span><small class="tb-mine">' + (mine ? 'Your rating: ' + mine + '/5 (tap it again to clear)' : 'Rate it 1 (easy) - 5 (hard)') + '</small></div>' : '');
    var fb = $('tb-fav'); if (fb) fb.addEventListener('click', function () { toggleFav(current); });
    bar.querySelectorAll('.pip').forEach(function (p) { p.addEventListener('click', function () { rate(current, Number(p.dataset.v)); }); });
  }

  async function toggleFav(id) {
    if (!Site.requireLogin('Log in to save favorites.')) return;
    if (!S.me) return;
    var on = !favs().has(id);
    var list = S.me.favorites || []; S.me.favorites = on ? list.concat(id) : list.filter(function (x) { return x !== id; });
    paint();
    var r = await Site.api('user', { action: 'favorite', id: id, on: on });
    if (!r.ok) { S.me.favorites = on ? S.me.favorites.filter(function (x) { return x !== id; }) : S.me.favorites.concat(id); paint(); flash(r.json.error || 'Could not save favorite.'); }
  }
  async function rate(id, v) {
    if (!Site.requireLogin('Log in to rate difficulty.')) return;
    if (!S.me) return;
    S.me.myRatings = S.me.myRatings || {};
    var cur = S.me.myRatings[id] || 0, next = cur === v ? 0 : v, prev = cur;
    if (next) S.me.myRatings[id] = next; else delete S.me.myRatings[id];
    paint();
    var r = await Site.api('user', { action: 'rate', id: id, value: next });
    if (r.ok) { S.ratings[id] = { avg: r.json.avg, count: r.json.count }; }
    else { if (prev) S.me.myRatings[id] = prev; else delete S.me.myRatings[id]; flash(r.json.error || 'Could not save rating.'); }
    paint();
  }
  function flash(msg) { var s = $('tb-note'); if (!s) return; s.textContent = msg; setTimeout(function () { s.textContent = ''; }, 3500); }

  // ---- favorites filter star (next to Intro) ----
  var ff = $('fav-filter');
  if (ff) ff.addEventListener('click', function () {
    if (!favOnly && !Site.requireLogin('Log in to see your favorites.')) return;
    favOnly = !favOnly; paint();
  });

  // ---- search + favorites filter ----
  var input = $('tutorial-search'), empty = $('search-empty');
  if (input) input.addEventListener('input', paint);
  function paint() {
    syncCustom();
    var q = input ? input.value.trim().toLowerCase() : '';
    var F = favs(), D = disabled(), H = hiddenIds(), any = false;
    if (ff) { ff.classList.toggle('on', favOnly); ff.textContent = starHtml(favOnly); ff.setAttribute('aria-pressed', favOnly ? 'true' : 'false'); ff.title = favOnly ? 'Showing favorites. Click to show all.' : 'Click to show only your favorites'; }
    document.querySelectorAll('.tutorial-card').forEach(function (c) {
      var name = (c.querySelector('.name') || {}).textContent || '';
      var heading = c.parentElement && c.parentElement.previousElementSibling;
      var cat = heading ? (heading.dataset.category || heading.textContent || '').toLowerCase() : '';
      var match = !q || name.toLowerCase().includes(q) || cat.includes(q);
      var live = LIVE.includes(c.id); if (live) ensureMeta(c);
      var isHid = H.has(c.id), show = match && (!favOnly || F.has(c.id)) && !(isHid && !canSee());
      c.classList.toggle('staff-hidden', isHid && canSee());
      c.classList.toggle('hidden', !show);
      var off = live && D.has(c.id) && !canSee();
      c.classList.toggle('is-off', off);
      if (live) {
        var m = c.querySelector('.card-meta');
        m.querySelector('.diff').textContent = off ? 'Off' : ratingText(c.id);
        var fb = m.querySelector('.fav-btn'); fb.textContent = starHtml(F.has(c.id)); fb.classList.toggle('on', F.has(c.id));
        m.style.display = (S.cfg && S.cfg.features.ratings === false) ? 'none' : '';
        fb.style.display = (S.cfg && S.cfg.features.favorites === false) ? 'none' : '';
      }
      if (show) any = true;
    });
    document.querySelectorAll('.category-heading').forEach(function (h) {
      var g = h.nextElementSibling; if (!g || !g.classList.contains('tutorial-grid')) return;
      var vis = [].some.call(g.querySelectorAll('.tutorial-card'), function (c) { return !c.classList.contains('hidden'); });
      var hide = (q || favOnly) && !vis;
      h.classList.toggle('hidden', hide); g.classList.toggle('hidden', hide);
    });
    if (empty) {
      empty.style.display = any || (!q && !favOnly) ? 'none' : 'block';
      empty.textContent = favOnly && !q && !any ? 'No favorites yet. Open a tutorial and press the star to add it.' : 'No tutorials match your search.';
    }
    // sidebar
    document.querySelectorAll('.sidebar a.sidebar-item, .sidebar .sidebar-toggle').forEach(function (el) {
      if (el.closest('.intro-row')) return;
      var tid = el.dataset.tid;
      if (el.classList.contains('sidebar-toggle')) { el.style.display = favOnly && !F.has(tid) ? 'none' : ''; var nest = el.nextElementSibling; if (nest) nest.style.display = favOnly && !F.has(tid) ? 'none' : ''; return; }
      if (el.closest('.sidebar-nested')) return;
      var hideIt = (favOnly && !(tid && F.has(tid))) || !!(tid && H.has(tid) && !canSee());
      el.classList.toggle('staff-hidden', !!(tid && H.has(tid) && canSee()));
      el.style.display = hideIt ? 'none' : '';
      var off = tid && D.has(tid) && !canSee();
      el.classList.toggle('is-off', !!off);
    });
    document.querySelectorAll('.sidebar-sub').forEach(function (sub) {
      var cat = sub.previousElementSibling; if (!cat || !cat.classList.contains('sidebar-category')) return;
      var any2 = [].some.call(sub.children, function (ch) { return ch.style.display !== 'none'; });
      cat.style.display = favOnly && !any2 ? 'none' : ''; sub.style.display = favOnly && !any2 ? 'none' : '';
    });
    paintBar(); paintDisabled();
  }

  // ---- disabled tutorials ----
  var off = $('tut-off');
  function paintDisabled() {
    var main = document.querySelector('.main'); if (!main) return;
    var isOff = !!(current && (disabled().has(current) || hiddenIds().has(current)) && !canSee());
    main.classList.toggle('tut-off', isOff);
    if (off) off.hidden = !isOff;
    if (bar && isOff) bar.hidden = true;
  }

  // blocks clicks on disabled tutorials
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.tutorial-card.is-off, .sidebar a.is-off');
    if (a) { e.preventDefault(); e.stopPropagation(); }
  }, true);


  // ---- showcases made in the admin panel ----
  var made = {};          // id -> { side, card, ph: placeholder card id or '' , restore }
  var sig = '', staffList = null, staffAt = 0, wantShow = null, shown = null;
  var low = function (x) { return String(x || '').trim().toLowerCase(); };
  function catBlocks(name) {
    var cat = null, head = null;
    document.querySelectorAll('.sidebar-category').forEach(function (c) { if (!cat && low((c.querySelector('span') || {}).textContent) === low(name)) cat = c; });
    document.querySelectorAll('.category-heading').forEach(function (h) { if (!head && low(h.dataset.category || h.textContent) === low(name)) head = h; });
    if (!cat) {
      var sec = document.createElement('div'); sec.className = 'sidebar-section';
      sec.innerHTML = '<div class="sidebar-category open" onclick="toggleCategory(this)"><span></span><span class="arrow">▶</span></div><div class="sidebar-sub open"></div>';
      sec.querySelector('span').textContent = name;
      document.querySelector('.sidebar').appendChild(sec); cat = sec.firstChild;
    }
    if (!head) {
      head = document.createElement('h3'); head.className = 'category-heading'; head.dataset.category = low(name); head.textContent = name;
      var grid = document.createElement('div'); grid.className = 'tutorial-grid';
      var home = document.getElementById('view-home'), anchor = home.querySelector('#search-empty');
      (anchor ? anchor.parentNode : home).insertBefore(head, anchor || null); head.after(grid);
    }
    return { sub: cat.nextElementSibling, grid: head.nextElementSibling };
  }
  function dropCustom(id) {
    var m = made[id]; if (!m) return;
    if (m.ph) { m.restore(); } else { if (m.side) m.side.remove(); if (m.card) m.card.remove(); }
    var i = LIVE.indexOf(id); if (i > -1) LIVE.splice(i, 1);
    delete made[id];
  }
  function addCustom(s) {
    var m = made[s.id];
    if (m && m.title === s.title && m.cat === s.category && m.ph === (s.placeholder || '')) return;
    if (m) dropCustom(s.id);
    var b = catBlocks(s.category), side, card, restore = null, ph = s.placeholder || '';
    var phCard = ph ? document.getElementById(ph) : null;
    if (ph && phCard && phCard.classList.contains('tutorial-card')) {
      var nm = low((phCard.querySelector('.name') || {}).textContent);
      var phSide = [].find.call(document.querySelectorAll('.sidebar a.sidebar-item.disabled'), function (a) { return low(a.textContent) === nm; });
      var saved = { cid: phCard.id, href: phCard.getAttribute('href'), name: phCard.querySelector('.name').textContent, side: phSide, sideHref: null, sideText: phSide ? phSide.textContent : '' };
      phCard.id = s.id; phCard.setAttribute('href', '#' + s.id); phCard.querySelector('.name').textContent = s.title;
      if (phSide) { phSide.classList.remove('disabled'); phSide.removeAttribute('aria-disabled'); phSide.removeAttribute('tabindex'); phSide.removeAttribute('title'); phSide.setAttribute('href', '#' + s.id); phSide.dataset.tid = s.id; phSide.textContent = s.title; }
      card = phCard; side = phSide;
      restore = function () {
        phCard.id = saved.cid; phCard.setAttribute('href', saved.href); phCard.querySelector('.name').textContent = saved.name;
        var mt = phCard.querySelector('.card-meta'); if (mt) mt.remove();
        if (phSide) { phSide.classList.add('disabled'); phSide.setAttribute('aria-disabled', 'true'); phSide.setAttribute('tabindex', '-1'); phSide.setAttribute('title', 'Coming soon'); phSide.removeAttribute('href'); delete phSide.dataset.tid; phSide.textContent = saved.sideText; }
      };
    } else {
      ph = '';
      side = document.createElement('a'); side.className = 'sidebar-item'; side.href = '#' + s.id; side.dataset.tid = s.id; side.textContent = s.title;
      b.sub.appendChild(side);
      card = document.createElement('a'); card.className = 'tutorial-card'; card.id = s.id; card.href = '#' + s.id;
      card.innerHTML = '<span class="num">•</span><span class="name"></span>'; card.querySelector('.name').textContent = s.title;
      b.grid.appendChild(card);
      side.addEventListener('click', function () { var sb = document.querySelector('.sidebar'); if (sb) sb.classList.remove('open'); });
    }
    if (LIVE.indexOf(s.id) < 0) LIVE.push(s.id);
    ensureMeta(card);
    made[s.id] = { side: side, card: card, ph: ph, restore: restore, title: s.title, cat: s.category };
  }
  function syncCustom() {
    var list = (S.cfg && S.cfg.showcases) || [];
    if (canSee()) {
      if (!staffList || Date.now() - staffAt > 10000) {
        staffAt = Date.now();
        Site.api('admin', { action: 'showcaseList' }).then(function (r) { if (r.ok) { staffList = r.json.showcases || []; paint(); } });
      }
      if (staffList) list = staffList.map(function (x) { return { id: x.id, title: x.title, category: x.category, placeholder: x.placeholder, state: x.state }; });
    }
    var next = JSON.stringify(list);
    if (next !== sig) {
      sig = next;
      var ids = {}; list.forEach(function (s) { ids[s.id] = 1; });
      Object.keys(made).forEach(function (id) { if (!ids[id]) dropCustom(id); });
      list.forEach(addCustom);
    }
    if (wantShow && wantShow !== shown && (made[wantShow] || S.cfg)) loadShow(wantShow);
  }

  // ---- viewing one ----
  async function loadShow(id) {
    shown = id;
    var title = $('cs-title'), body = $('cs-body'); if (!title || !body) return;
    title.textContent = (made[id] && made[id].title) || ''; var cr = $('cs-crumb'); if (cr) cr.textContent = title.textContent; body.innerHTML = '<p class="md-sub">Loading…</p>';
    if (disabled().has(id) && !canSee()) return;
    var data = null;
    try { var r = await fetch(Site.apiBase + 'public?showcase=' + encodeURIComponent(id)); if (r.ok) data = await r.json(); } catch (e) {}
    if (!data && canSee()) { var a = await Site.api('admin', { action: 'showcaseGet', id: id }); if (a.ok) data = a.json.showcase; }
    if (shown !== id) return;
    if (!data) { body.innerHTML = '<p>This showcase is not available right now.</p>'; if (S.auth && !S.me) shown = null; return; }
    title.textContent = data.title; var cr2 = $('cs-crumb'); if (cr2) cr2.textContent = data.title; body.innerHTML = Site.md(data.content);
    document.title = data.title + ' | ALT10fd0f';
  }
  function showCustom(id) { wantShow = id; if (!id) { shown = null; return; } if (shown === id) return; if (made[id] || S.cfg) loadShow(id); else { shown = null; var tt = $('cs-title'), b = $('cs-body'); if (tt) tt.textContent = ''; if (b) b.innerHTML = '<p class="md-sub">Loading…</p>'; } }

  window.TutorialsUI = { showCustom: showCustom, setCurrent: function (id) { current = id; paint(); } };
  Site.on(paint);
  paint();
})();
