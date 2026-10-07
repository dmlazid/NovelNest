(() => {
  const STORAGE_KEY = 'novelnest.positions';
  const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
  let positions;
  try { positions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { positions = {}; }
  if (typeof positions !== 'object' || Array.isArray(positions)) positions = {};
  let active = null, generation = 0, saveTimer = 0, scrollFrame = 0;

  function persist() {
    clearTimeout(saveTimer);
    // Keep storage small even after reading hundreds of chapters.
    const entries = Object.entries(positions).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, 200);
    positions = Object.fromEntries(entries);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); window.NovelNestAccounts?.changed(); } catch {}
  }

  function measure() {
    if (!active) return null;
    const { prose, wrap } = active;
    const paragraphs = [...prose.querySelectorAll('p')];
    if (!paragraphs.length) return null;
    const page = wrap.dataset.readMode === 'page';
    const box = prose.getBoundingClientRect();
    const edge = page ? box.left : 16;
    let index = paragraphs.findIndex(p => {
      const rect = p.getBoundingClientRect();
      return (page ? rect.right : rect.bottom) > edge;
    });
    if (index < 0) index = paragraphs.length - 1;
    const rect = paragraphs[index].getBoundingClientRect();
    const fraction = clamp((edge - (page ? rect.left : rect.top)) / Math.max(1, page ? rect.width : rect.height));
    const range = page ? prose.scrollWidth - prose.clientWidth : box.height - window.innerHeight + 32;
    const distance = page ? prose.scrollLeft : 16 - box.top;
    const percent = Math.round(100 * (range > 0 ? clamp(distance / range) : (page || box.bottom <= window.innerHeight ? 1 : 0)));
    return { paragraph: index, fraction, percent, start: page ? prose.scrollLeft === 0 && window.scrollY === 0 : window.scrollY === 0, at: Date.now() };
  }

  function capture(writeNow = false) {
    if (!active || active.restoring) return;
    const position = measure();
    if (!position) return;
    const previous = positions[active.key];
    if (previous && ['paragraph', 'fraction', 'percent', 'start'].every(key => previous[key] === position[key])) position.at = previous.at;
    active.position = position;
    positions[active.key] = position;
    active.label.textContent = `${position.percent}% read`;
    active.meter.value = position.percent;
    if (writeNow) persist();
    else { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); }
  }

  function restore(position) {
    if (!active || !position) return;
    const current = active;
    const paragraphs = current.prose.querySelectorAll('p');
    const index = Number.isInteger(position.paragraph) ? Math.max(0, Math.min(paragraphs.length - 1, position.paragraph)) : 0;
    const paragraph = paragraphs[index];
    if (!paragraph) return;
    current.restoring = true;
    const rect = paragraph.getBoundingClientRect();
    if (position.start) {
      current.prose.scrollLeft = 0;
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (current.wrap.dataset.readMode === 'page') {
      const box = current.prose.getBoundingClientRect();
      current.prose.scrollLeft += rect.left - box.left;
      window.scrollTo({ top: Math.max(0, window.scrollY + box.top - 16), behavior: 'instant' });
    } else {
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + clamp(position.fraction) * rect.height - 16), behavior: 'instant' });
    }
    requestAnimationFrame(() => {
      if (active !== current) return;
      current.restoring = false;
      capture();
    });
  }

  function ready() {
    const ticket = ++generation;
    requestAnimationFrame(() => {
      if (ticket !== generation) return;
      const hashMatch = location.hash.match(/^#\/read\/([^/]+)\/(\d+)$/);
      const cleanPathMatch = (location.pathname || '').match(/^\/novel\/([^/]+)\/chapter-(\d+)\/?$/);
      const oldPathMatch = (location.pathname || '').match(/^\/read\/([^/]+)\/?$/);
      const match = hashMatch || cleanPathMatch || (oldPathMatch ? [null, oldPathMatch[1], new URLSearchParams(location.search || '').get('chapter')] : null);
      if (!match || !match[2]) return;
      const novel = (window.NOVELS || []).find(n => n.id === decodeURIComponent(match[1]));
      const chapter = novel?.chapters[Number(match[2]) - 1];
      const wrap = document.querySelector('.reader-wrap');
      const prose = wrap?.querySelector('.prose');
      // Do not save a loading placeholder over a real reading position.
      if (!chapter || chapter.lazy || !prose) return;
      if (active?.prose === prose) return;
      const key = `${novel.id}:${match[2]}`;
      const saved = positions[key];
      const bar = document.createElement('div');
      bar.className = 'reader-position-bar';
      bar.setAttribute('aria-label', 'Reading progress');
      bar.innerHTML = '<div><span data-reading-percent>0% read</span><progress max="100" value="0" aria-label="Chapter reading progress"></progress></div><button type="button" data-reader-top>↑ Back to top</button>';
      wrap.appendChild(bar);
      active = { key, prose, wrap, position: null, restoring: false, label: bar.querySelector('[data-reading-percent]'), meter: bar.querySelector('progress') };
      prose.addEventListener('scroll', onScroll, { passive: true });
      let autoResume = true;
      try { autoResume = JSON.parse(localStorage.getItem('novelnest.preferences'))?.autoResume !== 'no'; } catch {}
      if (autoResume && saved && typeof saved === 'object') restore(saved);
      else capture();
    });
  }

  function onScroll() {
    if (!active || active.restoring || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; capture(); });
  }

  function stop() {
    clearTimeout(saveTimer);
    active = null;
    generation++;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  window.NovelNestPositions = { capture: () => capture(true), stop, reload() {
    clearTimeout(saveTimer);
    try { positions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { positions = {}; }
  } };
  window.addEventListener('novelnest:before-route', () => { capture(true); stop(); });
  window.addEventListener('novelnest:reader-ready', ready);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', () => capture(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) capture(true); });
  // Restore the same paragraph after changing the font, width, or reading mode.
  window.addEventListener('novelnest:reader-layout', () => { if (active) restore(active.position); });
  window.addEventListener('resize', () => { if (active) restore(active.position); });
  document.fonts?.ready.then(() => { if (active) restore(active.position); });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-reader-top]') || !active) return;
    restore({ paragraph: 0, fraction: 0, start: true });
  });
})();
