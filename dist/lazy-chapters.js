(() => {
  const pending = new Set();

  function currentTarget() {
    const match = location.hash.match(/^#\/read\/([^/]+)\/(\d+)/);
    if (!match) return null;
    const novel = (window.NOVELS || []).find(n => n.id === match[1]);
    const number = Number(match[2]);
    if (!novel || !Number.isInteger(number) || number < 1 || number > novel.chapters.length) return null;
    return {novel, index: number - 1, number};
  }

  function findLoaded(novel, number) {
    if (!novel.lazyChunks?.global) return null;
    const pool = window[novel.lazyChunks.global] || [];
    return pool.find(ch => Number(ch.number) === number) || null;
  }

  function rerender() {
    window.dispatchEvent(new Event('hashchange'));
  }

  function hydrateCurrent() {
    const target = currentTarget();
    if (!target) return;
    const {novel, index, number} = target;
    const chapter = novel.chapters[index];
    if (!chapter?.lazy || !novel.lazyChunks) return;

    const already = findLoaded(novel, number);
    if (already) {
      novel.chapters[index] = {...chapter, ...already, lazy: false};
      rerender();
      return;
    }

    const capacity = Number(novel.lazyChunks.capacity) || 100;
    const chunk = Math.floor(index / capacity) + 1;
    const key = `${novel.id}:${chunk}`;
    if (pending.has(key)) return;
    pending.add(key);

    const script = document.createElement('script');
    script.src = `${novel.lazyChunks.prefix}${String(chunk).padStart(2, '0')}.js`;
    script.dataset.lazyChapterChunk = key;
    script.onload = () => {
      pending.delete(key);
      const loaded = findLoaded(novel, number);
      if (loaded) {
        novel.chapters[index] = {...chapter, ...loaded, lazy: false};
        rerender();
      } else {
        document.querySelector('#toast')?.classList.add('show');
      }
    };
    script.onerror = () => {
      pending.delete(key);
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'Could not load this chapter. Please reload and try again.';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
      }
    };
    document.head.appendChild(script);
  }

  window.addEventListener('hashchange', () => setTimeout(hydrateCurrent, 0));
  setTimeout(hydrateCurrent, 0);
})();
