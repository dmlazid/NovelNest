'use strict';
(() => {
  const CLEAN_APP_PATH = /^\/(?:browse|finder|latest-releases|latest-novels|completed|latest|library|reading-desk|editorial(?:\/[^/?#]+)?|genre(?:\/[^/?#]+)?|about|privacy|terms|contact|copyright)\/?$/;

  const normalizeHref = raw => {
    if (!raw) return raw;
    if (raw.startsWith('./#/')) return raw.slice(3);
    if (raw.startsWith('#/')) return raw.slice(1);
    return raw;
  };

  function rewriteLinks() {
    document.querySelectorAll('a[href]').forEach(anchor => {
      const raw = anchor.getAttribute('href') || '';
      const clean = normalizeHref(raw);
      if (clean !== raw) anchor.setAttribute('href', clean);
    });
  }

  function isGenericRoute(pathname) {
    return pathname === '/' || CLEAN_APP_PATH.test(pathname);
  }

  function legacyHashToClean() {
    const hash = location.hash || '';
    if (hash === '#/' || hash === '#') return '/';
    const read = hash.match(/^#\/read\/([^/?#]+)\/(\d+)\/?$/);
    if (read) return '/novel/' + encodeURIComponent(decodeURIComponent(read[1])) + '/chapter-' + read[2] + '/';
    const novel = hash.match(/^#\/novel\/([^/?#]+)\/?$/);
    if (novel) return '/novel/' + encodeURIComponent(decodeURIComponent(novel[1])) + '/';
    if (hash.startsWith('#/')) return hash.slice(1);
    return null;
  }

  function cleanLegacyAddress() {
    const clean = legacyHashToClean();
    if (clean && history.replaceState) history.replaceState(history.state, '', clean);
  }

  function renderGenericRoute(path, push = false) {
    if (!window.NovelNestApp?.refresh || !history.replaceState) return false;
    const target = new URL(path, location.origin);
    if (target.origin !== location.origin || !isGenericRoute(target.pathname)) return false;
    const clean = target.pathname + target.search;
    if (push && history.pushState) history.pushState(null, '', clean);
    else history.replaceState(history.state, '', clean);

    // The app router natively reads clean paths. Never temporarily swap
    // into hash routing: route-rendered listeners may otherwise rewrite
    // history mid-render and cause a mobile navigation loop.
    window.NovelNestApp.refresh();
    rewriteLinks();
    return true;
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || (anchor.target && anchor.target !== '_self')) return;
    // Menu dialog owns its navigation. Intercepting it at document capture
    // prevented the dialog from closing and left the destination behind it.
    if (anchor.closest('.site-drawer')) return;
    const target = new URL(normalizeHref(anchor.getAttribute('href') || ''), location.href);
    if (target.origin !== location.origin || !isGenericRoute(target.pathname)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    renderGenericRoute(target.pathname + target.search, true);
  }, true);

  window.addEventListener('hashchange', () => {
    queueMicrotask(() => {
      cleanLegacyAddress();
      rewriteLinks();
    });
  });

  window.addEventListener('popstate', () => {
    queueMicrotask(() => {
      // app.js already routes on popstate. Avoid a second full render.
      cleanLegacyAddress();
      rewriteLinks();
    });
  });

  window.addEventListener('novelnest:route-rendered', () => {
    cleanLegacyAddress();
    rewriteLinks();
  });

  function boot() {
    const hadHashRoute = (location.hash || '').startsWith('#');
    cleanLegacyAddress();
    if (!hadHashRoute && location.pathname !== '/' && isGenericRoute(location.pathname)) {
      renderGenericRoute(location.pathname + location.search);
    }
    rewriteLinks();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
