(() => {
  const ID = 'got-a-gallery-in-the-wild';
  const main = document.querySelector('#main');
  const novel = () => window.NOVELS.find(n => n.id === ID);
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function fixCards() {
    document.querySelectorAll(`a.book-card[href="#/novel/${ID}"]`).forEach(card => {
      setText(card.querySelector('.meta'), 'Licensed novel');
    });
  }

  function fixDetail(n) {
    if (!location.hash.startsWith(`#/novel/${ID}`)) return;
    setText(main.querySelector('.book-info .meta'), `${n.chapters.length} chapters · English · Licensed edition`);
    setText(main.querySelector('.description .meta'), 'Authorized publication · Published on NovelNest with permission from the rights holder.');

    const actions = main.querySelector('.detail .actions');
    if (actions && !actions.querySelector('[data-epub-download]')) {
      const link = document.createElement('a');
      link.className = 'button outline';
      link.href = n.epub;
      link.setAttribute('download','');
      link.dataset.epubDownload = '';
      link.textContent = 'Download EPUB';
      actions.appendChild(link);
    }

    const tocSection = main.querySelector('.toc')?.closest('section');
    if (tocSection && !main.querySelector('[data-latest-gallery]')) {
      const latest = n.chapters.map((c,i)=>({c,i})).slice(-6).reverse();
      const section = document.createElement('section');
      section.dataset.latestGallery = '';
      section.innerHTML = `<div class="section-head"><h2>Latest chapters</h2><span class="meta">Newest first</span></div>
        <div class="toc">${latest.map(({c,i})=>`<a href="#/read/${ID}/${i+1}"><span>${String(i+1).padStart(2,'0')}</span>${esc(c.title)}</a>`).join('')}</div>`;
      tocSection.parentNode.insertBefore(section, tocSection);
    }
  }

  function fixReader(n) {
    if (!location.hash.startsWith(`#/read/${ID}/`)) return;
    setText(main.querySelector('.reader-heading .meta'), `${n.title} · Licensed edition`);
  }

  function fixNotes() {
    main.querySelectorAll('.sample-note').forEach(p => {
      if (p.textContent.includes('Sample stories can be read here') || p.textContent.includes('Read our original samples here')) {
        setText(p, 'Read original samples and authorized novels directly on NovelNest. External listings open on their source website.');
      }
    });
  }

  function fixAbout() {
    if (!location.hash.startsWith('#/about')) return;
    main.querySelectorAll('.about p').forEach(p => {
      if (p.textContent.includes('NovelNest has not imported novels or cover art from FreeWebNovel')) {
        setText(p, 'NovelNest includes original demonstration stories and may also host novels that the site owner is authorized to publish. Got a Gallery in the Wild is currently available on-site as an authorized publication.');
      } else if (p.textContent.includes('Chapters may be added to NovelNest when the owner has the necessary publishing permission')) {
        setText(p, 'Book listings can be saved to your library. Full chapters are hosted on NovelNest only when the site owner has the necessary publishing permission.');
      }
    });
  }

  function fix() {
    const n = novel();
    if (!n) return;
    fixCards();
    fixDetail(n);
    fixReader(n);
    fixNotes();
    fixAbout();
  }

  window.addEventListener('hashchange', () => setTimeout(fix, 0));
  fix();
})();
