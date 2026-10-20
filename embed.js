// Loaded by each tutorial page. When a page is shown inside the main site (in an iframe) it hides its own
// navbar/sidebar/footer and sends links to other tutorials back to the parent so they open in the same view.
(function () {
  var MAP = { 'reminder.html': 'reminder', 'fakequote.html': 'fakequote', 'modal.html': 'modal', 'buttons-data.html': 'buttons', 'dropdown.html': 'dropdown', 'application.html': 'application', 'timestamps.html': 'timestamps', 'cookie-api.html': 'cookie', 'membercount.html': 'membercount', 'roblox-lookup.html': 'roblox-lookup', 'prefix.html': 'prefix', 'calculator.html': 'calculator', 'say.html': 'say', 'giveaway.html': 'giveaway', 'erlc-api.html': 'erlc-api' };
  // Theme (dark/light) shared with the main page.
  try { var th = localStorage.getItem('site_theme'); if (th) document.documentElement.setAttribute('data-theme', th); } catch (e) {}
  var lt = document.createElement('style');
  lt.textContent = ':root[data-theme=light]{--bg:#f6f7f9;--bg2:#fff;--bg3:#eef0f3;--bg-secondary:#fff;--bg-tertiary:#eef0f3;--bg-hover:#e9ecf0;--text:#1f2328;--muted:#5a6670;--text-muted:#5a6670;--sec:#38414a;--text-secondary:#38414a;--accent:#23796c;--border:#d3d8de;color-scheme:light}:root[data-theme=light] code{color:#b4415f}';
  (document.head || document.documentElement).appendChild(lt);
  var embedded = false;
  try { embedded = window.top !== window.self && window.parent.location.origin === location.origin && /embed=1/.test(location.search); } catch (e) {}
  if (!embedded) return;
  var st = document.createElement('style');
  st.textContent = '.navbar,.sidebar,.footer,.toc{display:none!important}.layout{display:block!important;margin-top:0!important}.main{margin:0!important;max-width:none!important;min-width:0!important;width:100%!important;padding:0 0 2rem!important}pre{max-width:100%}img,table{max-width:100%}body{min-height:0!important;overflow-y:hidden}';
  document.head.appendChild(st);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank') return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href)) return;
    var file = href.split('#')[0].split('?')[0];
    if (MAP[file]) { e.preventDefault(); window.parent.location.hash = MAP[file]; }
    else if (file === 'index.html' || file === '' || file === './') { e.preventDefault(); window.parent.location.hash = href.indexOf('#') > -1 ? href.split('#')[1] : ''; }
  });
})();
