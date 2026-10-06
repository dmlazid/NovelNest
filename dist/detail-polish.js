(() => {
  const main = document.querySelector('#main');
  const AUTH_NOTE = 'Published on NovelNest with permission from the rights holder, as confirmed by the site owner.';

  function currentNovel() {
    const match = location.hash.match(/^#\/(?:novel|read)\/([^/?#]+)/);
    return match ? (window.NOVELS || []).find(n => n.id === match[1]) : null;
  }

  function polishDetail() {
    const n = currentNovel();
    if (!n) return;

    if (location.hash.startsWith(`#/novel/${n.id}`)) {
      const info = main.querySelector('.book-info .meta');
      if (info) info.textContent = `${n.chapters.length} chapters · English · Licensed edition`;

      const description = main.querySelector('.description');
      if (description) {
        const note = description.querySelector('p.meta');
        if (note) note.textContent = AUTH_NOTE;

        const summary = Array.from(description.querySelectorAll(':scope > p')).find(p => !p.classList.contains('meta'));
        if (summary && summary.textContent.trim().length > 420 && !summary.dataset.collapsibleReady) {
          summary.dataset.collapsibleReady = 'true';
          summary.classList.add('novel-summary-collapsed');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'summary-toggle';
          button.textContent = 'See more';
          button.setAttribute('aria-expanded', 'false');
          summary.insertAdjacentElement('afterend', button);
        }
      }
    }

    if (location.hash.startsWith(`#/read/${n.id}/`)) {
      const meta = main.querySelector('.reader-heading .meta');
      if (meta) meta.textContent = `${n.title} · Licensed edition`;
    }
  }

  main.addEventListener('click', event => {
    const button = event.target.closest('.summary-toggle');
    if (!button) return;
    const summary = button.previousElementSibling;
    if (!summary?.classList.contains('novel-summary-collapsed') && !summary?.classList.contains('novel-summary-expanded')) return;
    const expanded = summary.classList.toggle('novel-summary-expanded');
    summary.classList.toggle('novel-summary-collapsed', !expanded);
    button.textContent = expanded ? 'See less' : 'See more';
    button.setAttribute('aria-expanded', String(expanded));
  });

  window.addEventListener('novelnest:view-ready', polishDetail);
  window.addEventListener('hashchange', () => setTimeout(polishDetail, 0));
  setTimeout(polishDetail, 0);
})();
