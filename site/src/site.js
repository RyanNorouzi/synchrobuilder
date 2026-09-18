// Synchrobuilder site: copy buttons, theme toggle, and the single-file preview router. No dependencies, no tracking.
(function () {
  var root = document.documentElement;
  function readStored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeStored(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage may be unavailable */ } }

  // Theme: honour a stored choice; otherwise leave the system decide via prefers-color-scheme.
  var stored = readStored('sb-theme');
  if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
  var toggle = document.querySelector('.theme-toggle');
  function currentTheme() {
    var explicit = root.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function labelToggle() { if (toggle) toggle.textContent = currentTheme() === 'dark' ? 'Light mode' : 'Dark mode'; }
  if (toggle) {
    labelToggle();
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      writeStored('sb-theme', next);
      labelToggle();
    });
  }

  // Copy buttons: copy the command text next to the button.
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.parentElement.querySelector('code');
      var text = code ? code.textContent.trim() : '';
      function done(ok) {
        btn.setAttribute('data-state', ok ? 'done' : 'error');
        btn.textContent = ok ? 'Copied' : 'Select it';
        setTimeout(function () { btn.removeAttribute('data-state'); btn.textContent = 'Copy'; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });
  });

  // Single-file preview: one page visible at a time, chosen by the hash.
  if (document.body.getAttribute('data-mode') === 'single') {
    var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
    var links = Array.prototype.slice.call(document.querySelectorAll('.site-nav a, .brand'));
    function show() {
      var id = (location.hash || '#home').replace('#', '');
      var found = false;
      pages.forEach(function (p) { var on = p.id === 'page-' + id; p.classList.toggle('is-active', on); if (on) found = true; });
      if (!found) pages.forEach(function (p) { p.classList.toggle('is-active', p.id === 'page-home'); });
      links.forEach(function (a) {
        var target = (a.getAttribute('href') || '').replace('#', '');
        if (a.classList.contains('site-nav') || a.closest('.site-nav')) {
          if (target === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        }
      });
      window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', show);
    show();
  }
})();
