/* Home page features: favorites (star filter), difficulty ratings (live), search, disabled tutorials. Needs site.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = Site.state;
  var LIVE = ['reminder', 'fakequote', 'modal', 'buttons', 'dropdown', 'application', 'tickets', 'timestamps', 'cookie', 'membercount'];
  var current = null;   // tutorial id being viewed, or null
  var favOnly = false;
  var favs = function () { return new Set((S.me && S.me.favorites) || []); };
  var disabled = function () { return new Set(S.cfg && S.cfg.disabled || []); };
  var canSee = function () { return Site.isStaff(); };
  var ratingText = function (id) { var r = S.ratings[id]; return r && r.count ? r.avg.toFixed(1) + '/5' : '–/5'; };
  var starHtml = function (on) { return on ? '★' : '☆'; };

  // ---- map sidebar links to tutorial ids ----
  var HREF_TID = { '#reminder': 'reminder', '#fakequote': 'fakequote', '#modal': 'modal', '#buttons': 'buttons', '#dropdown': 'dropdown', '#application': 'application', '#timestamps': 'timestamps', '#cookie': 'cookie', '#membercount': 'membercount' };
  document.querySelectorAll('.sidebar a.sidebar-item').forEach(function (a) { var t = HREF_TID[a.getAttribute('href')]; if (t) a.dataset.tid = t; });
  document.querySelectorAll('.sidebar .sidebar-toggle').forEach(function (t) { if (/Tickets/i.test(t.textContent)) t.dataset.tid = 'tickets'; });

  // ---- favorite stars + difficulty badges on the cards ----
  document.querySelectorAll('.tutorial-card').forEach(function (c) {
    if (!LIVE.includes(c.id)) return;
    var meta = document.createElement('span'); meta.className = 'card-meta';
    meta.innerHTML = '<span class="diff" title="Average difficulty (1 easy - 5 hard)"></span><button type="button" class="fav-btn" aria-label="Favorite" title="Favorite"></button>';
    c.appendChild(meta);
    meta.querySelector('.fav-btn').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleFav(c.id); });
  });

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
    var q = input ? input.value.trim().toLowerCase() : '';
    var F = favs(), D = disabled(), any = false;
    if (ff) { ff.classList.toggle('on', favOnly); ff.textContent = starHtml(favOnly); ff.setAttribute('aria-pressed', favOnly ? 'true' : 'false'); ff.title = favOnly ? 'Showing favorites. Click to show all.' : 'Click to show only your favorites'; }
    document.querySelectorAll('.tutorial-card').forEach(function (c) {
      var name = (c.querySelector('.name') || {}).textContent || '';
      var heading = c.parentElement && c.parentElement.previousElementSibling;
      var cat = heading ? (heading.dataset.category || heading.textContent || '').toLowerCase() : '';
      var match = !q || name.toLowerCase().includes(q) || cat.includes(q);
      var live = LIVE.includes(c.id);
      var show = match && (!favOnly || F.has(c.id));
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
      var hideIt = favOnly && !(tid && F.has(tid));
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
    var isOff = !!(current && disabled().has(current) && !canSee());
    main.classList.toggle('tut-off', isOff);
    if (off) off.hidden = !isOff;
    if (bar && isOff) bar.hidden = true;
  }

  // blocks clicks on disabled tutorials
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.tutorial-card.is-off, .sidebar a.is-off');
    if (a) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  window.TutorialsUI = { setCurrent: function (id) { current = id; paint(); } };
  Site.on(paint);
  paint();
})();
