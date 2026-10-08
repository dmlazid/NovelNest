(() => {
  const pending = new Set();
  const failed = new Set();

  function currentTarget() {
    const hashMatch = location.hash.match(/^#\/read\/([^/]+)\/(\d+)$/);
    const cleanPathMatch = (location.pathname || '').match(/^\/novel\/([^/]+)\/chapter-(\d+)\/?$/);
    const oldPathMatch = (location.pathname || '').match(/^\/read\/([^/]+)\/?$/);
    const match = hashMatch || cleanPathMatch || (oldPathMatch ? [null, oldPathMatch[1], new URLSearchParams(location.search || '').get('chapter')] : null);
    if (!match || !match[2]) return null;
    const novel = (window.NOVELS || []).find(n => n.id === decodeURIComponent(match[1]));
    const number = Number(match[2]);
    if (!novel?.lazyChunks || number < 1 || number > novel.chapters.length) return null;
    const index = number - 1;
    const chunk = Math.floor(index / novel.lazyChunks.capacity) + 1;
    return { novel, index, number, chunk, key: `${novel.id}:${window.NOVELNEST_STATIC_READERS ? number : chunk}` };
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
      if (window.NovelNestApp?.refresh) window.NovelNestApp.refresh();
      else window.dispatchEvent(new Event('hashchange'));
      return;
    }
    if (failed.has(key)) { showError(key); return; }
    document.querySelector('.prose')?.setAttribute('aria-busy', 'true');
    if (pending.has(key)) return;
    pending.add(key);
    if (window.NOVELNEST_STATIC_READERS) {
      // The published HTML is both the readable page and the source of chapter
      // text. It avoids shipping a second 500 MB copy of the same chapters.
      fetch(`/novel/${encodeURIComponent(novel.id)}/chapter-${number}/`)
        .then(response => {
          if (!response.ok) throw new Error(`Chapter HTTP ${response.status}`);
          return response.text();
        })
        .then(html => {
          const page = new DOMParser().parseFromString(html, 'text/html');
          const prose = page.querySelector('[data-static-chapter]');
          if (prose?.dataset.staticChapter !== novel.id || Number(prose.dataset.chapterNumber) !== number) throw new Error('Wrong chapter');
          const paragraphs = [...prose.querySelectorAll('p')].map(p => p.textContent);
          if (!paragraphs.length || paragraphs.some(p => !p.trim())) throw new Error('Empty chapter');
          novel.chapters[index] = { ...chapter, paragraphs, number, lazy: false };
          if (currentTarget()?.key === key) window.NovelNestApp.refresh();
        })
        .catch(() => { failed.add(key); showError(key); })
        .finally(() => pending.delete(key));
      return;
    }
    const file = `${novel.lazyChunks.prefix}${String(chunk).padStart(2, '0')}.js`;
    const script = document.createElement('script');
    script.src = '/' + (window.NOVELNEST_ASSETS?.[file] || file).replace(/^\/+/, '');
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
  window.addEventListener('novelnest:route-rendered', () => setTimeout(hydrateCurrent, 0));
  setTimeout(hydrateCurrent, 0);
})();
