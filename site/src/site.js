// Synchrobuilder site: theme, copy buttons, smooth scroll, reveals, preview router.
// Lenis is vendored locally (site/src/vendor), so the page still makes no third-party request.
// Every enhancement here is optional: with JavaScript off, or with reduced motion requested,
// the page renders complete and static.
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function readStored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeStored(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage may be unavailable */ } }

  /* ---------------------------------------------------------------- theme -- */
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

  /* ---------------------------------------------------------- copy buttons -- */
  Array.prototype.forEach.call(document.querySelectorAll('.copy'), function (btn) {
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

  /* --------------------------------------------------------- smooth scroll -- */
  // Lenis decouples scrolling from the browser default so long documentation
  // pages settle rather than snap. Skipped entirely when the visitor asks for
  // reduced motion, and skipped if the vendored script did not load.
  var lenis = null;
  if (!reduced && typeof window.Lenis === 'function') {
    try {
      lenis = new window.Lenis({
        duration: 0.9,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true,
        touchMultiplier: 1.6
      });
      var raf = function (time) { lenis.raf(time); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    } catch (e) {
      lenis = null;
    }
  }

  // In-page anchors: hand them to Lenis when it is running, otherwise let the
  // browser do it. Either way the URL hash still updates.
  Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (link) {
    link.addEventListener('click', function (event) {
      var id = link.getAttribute('href');
      if (!id || id === '#' || link.classList.contains('skip-link')) return;
      var target = document.querySelector(id);
      if (!target) return;
      if (lenis) {
        event.preventDefault();
        lenis.scrollTo(target, { offset: -80 });
        history.replaceState(null, '', id);
      }
    });
  });

  /* ------------------------------------------------------- reading progress -- */
  var header = document.querySelector('.site-header');
  if (header && !reduced) {
    var ticking = false;
    var paint = function () {
      var height = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0;
      header.style.setProperty('--progress', ratio.toFixed(4));
      ticking = false;
    };
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(paint);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    paint();
  }

  /* ----------------------------------------------------------- entry reveal -- */
  // Blocks below the fold cascade in on approach. Three rules keep this safe:
  // the hidden state is applied by script, so it never exists without the code
  // that clears it; anything near the first screen is shown at once; and a
  // timer clears everything left over, so no content can be stranded invisible.
  if (!reduced && 'IntersectionObserver' in window) {
    var candidates = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal-group]'), function (group) {
      var kids = group.children;
      for (var i = 0; i < kids.length; i++) candidates.push([kids[i], Math.min(i, 5) * 70]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal-block]'), function (el) {
      candidates.push([el, 0]);
    });

    var pending = [];
    candidates.forEach(function (pair) {
      var el = pair[0];
      // Already on screen, or close to it: never hide it in the first place.
      if (el.getBoundingClientRect().top < window.innerHeight * 1.1) return;
      el.setAttribute('data-reveal', '');
      el.style.setProperty('--reveal-delay', pair[1] + 'ms');
      pending.push(el);
    });

    if (pending.length) {
      var reveal = function (el) { el.classList.add('is-in'); };
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          observer.unobserve(entry.target);
        });
      }, { rootMargin: '220px 0px 220px 0px', threshold: 0.01 });
      pending.forEach(function (el) { observer.observe(el); });
      // Failsafe: whatever has not been reached by now is shown regardless.
      setTimeout(function () {
        pending.forEach(reveal);
        observer.disconnect();
      }, 4000);
    }
  }

  /* ---------------------------------------------------------- preview router -- */
  // Single-file preview only: one page visible at a time, chosen by the hash.
  if (document.body.getAttribute('data-mode') === 'single') {
    var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
    var links = Array.prototype.slice.call(document.querySelectorAll('.site-nav a, .brand'));
    var show = function () {
      var id = (location.hash || '#home').replace('#', '');
      var found = false;
      pages.forEach(function (p) { var on = p.id === 'page-' + id; p.classList.toggle('is-active', on); if (on) found = true; });
      if (!found) pages.forEach(function (p) { p.classList.toggle('is-active', p.id === 'page-home'); });
      links.forEach(function (a) {
        var target = (a.getAttribute('href') || '').replace('#', '');
        if (a.closest('.site-nav')) {
          if (target === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        }
      });
      if (lenis) lenis.scrollTo(0, { immediate: true }); else window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', show);
    show();
  }
})();
