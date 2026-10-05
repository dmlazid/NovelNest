(() => {
  const main = document.querySelector('#main');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function routeNovel() {
    const match = location.hash.match(/^#\/(?:novel|read)\/([^/]+)/);
    return match ? window.NOVELS.find(n => n.id === match[1]) : null;
  }

  function cleanCommon() {
    main.querySelectorAll('.sample-note').forEach(el => el.remove());
    main.querySelectorAll('[data-epub-download]').forEach(el => el.remove());
  }

  function cleanHome() {
    const isHome = !location.hash || location.hash === '#' || location.hash === '#/';
    if (!isHome) return;
    main.querySelector('.featured')?.remove();
    main.querySelectorAll('.section-head h2').forEach(h => {
      if (h.textContent.trim() === 'Stories to get lost in') h.textContent = 'Available now';
    });
  }

  function fixDetail(n) {
    if (!n || !location.hash.startsWith(`#/novel/${n.id}`)) return;
    setText(main.querySelector('.book-info .meta'), `${n.chapters.length} chapters · English · Licensed edition`);
    setText(main.querySelector('.description .meta'), 'Authorized publication · Published on NovelNest with permission from the rights holder.');

    const tocSection = main.querySelector('.toc')?.closest('section');
    if (tocSection && !main.querySelector(`[data-latest-licensed="${n.id}"]`)) {
      const latest = n.chapters.map((c, i) => ({c, i})).slice(-6).reverse();
      const section = document.createElement('section');
      section.dataset.latestLicensed = n.id;
      section.innerHTML = `<div class="section-head"><h2>Latest chapters</h2><span class="meta">Newest first</span></div><div class="toc">${latest.map(({c,i}) => `<a href="#/read/${n.id}/${i+1}"><span>${String(i+1).padStart(2,'0')}</span>${esc(c.title)}</a>`).join('')}</div>`;
      tocSection.parentNode.insertBefore(section, tocSection);
    }
  }

  function fixReader(n) {
    if (!n || !location.hash.startsWith(`#/read/${n.id}/`)) return;
    setText(main.querySelector('.reader-heading .meta'), `${n.title} · Licensed edition`);
  }

  function fixAbout() {
    if (!location.hash.startsWith('#/about')) return;
    const about = main.querySelector('.about');
    if (!about) return;
    const titles = window.NOVELS.map(n => esc(n.title)).join(' and ');
    about.innerHTML = `<span class="eyebrow">A home for stories</span><h1>About NovelNest</h1><p>NovelNest is a place to read authorized novels chapter by chapter.</p><h2>Our collection</h2><p>${titles || 'Authorized novels'} ${window.NOVELS.length === 1 ? 'is' : 'are'} available on-site with publication permission confirmed by the site owner.</p><h2>Your reading data</h2><p>Bookmarks, reading preferences, and your last opened chapter are stored in your browser on this device.</p>`;
  }

  function fix() {
    cleanCommon();
    cleanHome();
    const n = routeNovel();
    fixDetail(n);
    fixReader(n);
    fixAbout();
  }

  window.addEventListener('hashchange', () => setTimeout(fix, 0));
  setTimeout(fix, 0);
})();
