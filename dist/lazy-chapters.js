(() => {
  const pending = new Set();
  const failed = new Set();

  function currentTarget() {
    const match = location.hash.match(/^#\/read\/([^/]+)\/(\d+)$/);
    if (!match) return null;
    const novel = (window.NOVELS || []).find(n => n.id === match[1]);
    const number = Number(match[2]);
    if (!novel?.lazyChunks || number < 1 || number > novel.chapters.length) return null;
    const index = number - 1;
    const chunk = Math.floor(index / novel.lazyChunks.capacity) + 1;
    return { novel, index, number, chunk, key: `${novel.id}:${chunk}` };
  }

  function findLoaded(novel, number) {
    const pool = window[novel.lazyChunks.global] || [];
    return pool.find(ch => Number(ch.number ?? (novel.lazyChunks.numberFromTitle ? ch.title?.match(/^Chapter\s+(\d+)/i)?.[1] : NaN)) === number);
  }

  function showError(key) {
    if (currentTarget()?.key !== key) return;
    const prose = document.querySelector('.prose');
    if (!prose) return;
    prose.setAttribute('aria-busy', 'false');
    prose.innerHTML = '<p role="alert">This chapter could not load. Check your connection and try again. If the site has just updated, refresh the page.</p><button class="button outline" data-retry-chapter>Try again</button>';
  }

  function hydrateCurrent() {
    const target = currentTarget();
    if (!target) return;
    const { novel, index, number, chunk, key } = target;
    const chapter = novel.chapters[index];
    if (!chapter?.lazy) return;
    const loaded = findLoaded(novel, number);
    if (loaded) {
      novel.chapters[index] = { ...chapter, ...loaded, number, lazy: false };
      window.dispatchEvent(new Event('hashchange'));
      return;
    }
    if (failed.has(key)) { showError(key); return; }
    document.querySelector('.prose')?.setAttribute('aria-busy', 'true');
    if (pending.has(key)) return;
    pending.add(key);
    const file = `${novel.lazyChunks.prefix}${String(chunk).padStart(2, '0')}.js`;
    const script = document.createElement('script');
    script.src = window.NOVELNEST_ASSETS?.[file] || file;
    script.dataset.lazyChapterChunk = key;
    script.onload = () => {
      pending.delete(key);
      if (!findLoaded(novel, number)) failed.add(key);
      // A slow previous request must not reset the current reader's scroll.
      if (currentTarget()?.key === key) hydrateCurrent();
    };
    script.onerror = () => {
      pending.delete(key);
      failed.add(key);
      script.remove();
      showError(key);
    };
    document.head.appendChild(script);
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-retry-chapter]')) return;
    const target = currentTarget();
    if (!target) return;
    failed.delete(target.key);
    const prose = document.querySelector('.prose');
    if (prose) prose.innerHTML = '<p>Loading chapter…</p>';
    hydrateCurrent();
  });
  window.addEventListener('hashchange', () => setTimeout(hydrateCurrent, 0));
  setTimeout(hydrateCurrent, 0);
})();
