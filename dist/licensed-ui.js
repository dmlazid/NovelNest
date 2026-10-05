(() => {
  const ID = 'got-a-gallery-in-the-wild';
  const SAMPLE_IDS = new Set(['the-city-above-the-clouds','when-the-peonies-bloom','the-thirteenth-hour']);
  const main = document.querySelector('#main');
  const novel = () => window.NOVELS.find(n => n.id === ID);
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function redirectOldSampleRoutes() {
    const match = location.hash.match(/^#\/(?:novel|read)\/([^/]+)/);
    if (match && SAMPLE_IDS.has(match[1])) {
      location.replace(`#/novel/${ID}`);
      return true;
    }
    return false;
  }

  function removeSampleCards() {
    main.querySelectorAll('a.book-card').forEach(card => {
      if (card.getAttribute('href') !== `#/novel/${ID}`) card.remove();
    });
  }

  function cleanGenres(n) {
    const allowed = new Set(['All', ...(n.tags || [])]);
    main.querySelectorAll('.chips .chip').forEach(chip => {
      if (!allowed.has(chip.textContent.trim())) chip.remove();
    });
    main.querySelectorAll('.genre-row').forEach(row => {
      const label = row.childNodes[0]?.textContent?.trim() || row.textContent.trim();
      if (!allowed.has(label)) row.remove();
    });
  }

  function cleanHome() {
    const isHome = !location.hash || location.hash === '#' || location.hash === '#/';
    if (!isHome) return;
    main.querySelector('.featured')?.remove();
    main.querySelectorAll('.sample-note').forEach(el => el.remove());
    main.querySelectorAll('.section-head h2').forEach(h => {
      if (h.textContent.trim() === 'Stories to get lost in') h.textContent = 'Available now';
    });
  }

  function cleanBrowse() {
    if (!location.hash.startsWith('#/browse')) return;
    const visible = main.querySelectorAll(`a.book-card[href="#/novel/${ID}"]`).length;
    const count = main.querySelector('.toolbar > .muted');
    if (count && !location.hash.includes('q=')) setText(count, `${visible} ${visible === 1 ? 'novel' : 'novels'}`);
    main.querySelectorAll('.sample-note').forEach(el => el.remove());
  }

  function cleanLibrary() {
    if (!location.hash.startsWith('#/library')) return;
    main.querySelectorAll('.sample-note').forEach(el => el.remove());
  }

  function fixDetail(n) {
    if (!location.hash.startsWith(`#/novel/${ID}`)) return;
    setText(main.querySelector('.book-info .meta'), `${n.chapters.length} chapters · English · Licensed edition`);
    setText(main.querySelector('.description .meta'), 'Authorized publication · Published on NovelNest with permission from the rights holder.');
    main.querySelectorAll('[data-epub-download]').forEach(el => el.remove());

    const tocSection = main.querySelector('.toc')?.closest('section');
    if (tocSection && !main.querySelector('[data-latest-gallery]')) {
      const latest = n.chapters.map((c,i)=>({c,i})).slice(-6).reverse();
      const section = document.createElement('section');
      section.dataset.latestGallery = '';
      section.innerHTML = `<div class="section-head"><h2>Latest chapters</h2><span class="meta">Newest first</span></div><div class="toc">${latest.map(({c,i})=>`<a href="#/read/${ID}/${i+1}"><span>${String(i+1).padStart(2,'0')}</span>${esc(c.title)}</a>`).join('')}</div>`;
      tocSection.parentNode.insertBefore(section, tocSection);
    }
  }

  function fixReader(n) {
    if (!location.hash.startsWith(`#/read/${ID}/`)) return;
    setText(main.querySelector('.reader-heading .meta'), `${n.title} · Licensed edition`);
  }

  function fixAbout() {
    if (!location.hash.startsWith('#/about')) return;
    const about = main.querySelector('.about');
    if (!about) return;
    about.innerHTML = '<span class="eyebrow">A home for stories</span><h1>About NovelNest</h1><p>NovelNest is a place to read authorized novels chapter by chapter.</p><h2>Our collection</h2><p>Got a Gallery in the Wild is available on-site as an authorized publication.</p><h2>Your reading data</h2><p>Bookmarks, reading preferences, and your last opened chapter are stored in your browser on this device.</p>';
  }

  function fix() {
    if (redirectOldSampleRoutes()) return;
    const n = novel();
    if (!n) return;
    removeSampleCards();
    cleanGenres(n);
    cleanHome();
    cleanBrowse();
    cleanLibrary();
    fixDetail(n);
    fixReader(n);
    fixAbout();
  }

  window.addEventListener('hashchange', () => setTimeout(fix, 0));
  setTimeout(fix, 0);
})();
