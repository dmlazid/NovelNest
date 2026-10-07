(() => {
  const main = document.querySelector('#main');
  const PAGE_SIZE = 40;
  const tocPages = Object.create(null);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const readerHref = (id, number) => `/read/${encodeURIComponent(id)}/?chapter=${number}`;

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function readLocal(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writePrefs(next) {
    try { localStorage.setItem('novelnest.preferences', JSON.stringify(next)); } catch {}
  }

  function prefs() {
    const p = readLocal('novelnest.preferences', {});
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  }

  function progressFor(id) {
    const progress = readLocal('novelnest.progress', {});
    return progress && progress[id] ? progress[id] : null;
  }

  function routeNovel() {
    const hashMatch = location.hash.match(/^#\/(?:novel|read)\/([^/?#]+)/);
    if (hashMatch) return (window.NOVELS || []).find(n => n.id === decodeURIComponent(hashMatch[1])) || null;
    const pathMatch = location.pathname.match(/^\/(?:novel|read)\/([^/]+)\/?$/);
    return pathMatch ? (window.NOVELS || []).find(n => n.id === decodeURIComponent(pathMatch[1])) || null : null;
  }

  function currentReaderNumber() {
    const hashMatch = location.hash.match(/^#\/read\/[^/]+\/(\d+)/);
    if (hashMatch) return Number(hashMatch[1]);
    if (!/^\/read\/[^/]+\/?$/.test(location.pathname)) return null;
    const value = Number(new URLSearchParams(location.search).get('chapter'));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function cleanCommon() {
    main.querySelectorAll('.sample-note').forEach(el => el.remove());
    main.querySelectorAll('[data-epub-download]').forEach(el => el.remove());
    main.querySelectorAll('.book-card .meta').forEach(el => {
      if (/sample story/i.test(el.textContent || '')) el.remove();
    });
  }

  function cleanHome() {
    const isHome = !location.hash || location.hash === '#' || location.hash === '#/';
    if (!isHome) return;
    main.querySelector('.featured')?.remove();
    main.querySelectorAll('.section-head h2').forEach(h => {
      if (h.textContent.trim() === 'Stories to get lost in') h.textContent = 'Available now';
    });
  }

  function rangeLabel(page, total) {
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(total, start + PAGE_SIZE - 1);
    return `C.${start} - C.${end}`;
  }

  function chapterLink(n, c, index, progress) {
    const state = window.NovelNestReading?.status(n.id, index + 1) || 'unread';
    const label = {unread: 'Unread', 'in-progress': 'In progress', finished: 'Finished'}[state];
    return `<a href="${readerHref(n.id, index + 1)}"><span class="chapter-entry-number">${String(index + 1).padStart(2, '0')}</span><span class="chapter-entry-text"><span class="chapter-entry-title">${esc(c.title)}</span><span class="chapter-entry-meta"><span class="chapter-state" data-state="${state}">${label}</span>${progress?.chapter === index ? '<small>Last opened</small>' : ''}</span></span></a>`;
  }

  function renderTocPage(n, tocSection, requestedPage) {
    if (!tocSection) return;
    const toc = tocSection.querySelector('.toc');
    if (!toc) return;

    const pageCount = Math.max(1, Math.ceil(n.chapters.length / PAGE_SIZE));
    let page = Number.isInteger(requestedPage) ? requestedPage : tocPages[n.id];
    if (!Number.isInteger(page)) {
      const progress = progressFor(n.id);
      page = progress && Number.isInteger(progress.chapter) ? Math.floor(progress.chapter / PAGE_SIZE) : 0;
    }
    page = Math.max(0, Math.min(pageCount - 1, page));
    tocPages[n.id] = page;

    const start = page * PAGE_SIZE;
    const end = Math.min(n.chapters.length, start + PAGE_SIZE);
    const progress = progressFor(n.id);

    toc.innerHTML = n.chapters.slice(start, end).map((c, offset) => {
      const i = start + offset;
      return chapterLink(n, c, i, progress);
    }).join('');

    tocSection.querySelector('.toc-pager')?.remove();
    tocSection.querySelector('.toc-page-note')?.remove();

    const pager = document.createElement('div');
    pager.className = 'toc-pager';
    pager.dataset.novelId = n.id;
    pager.innerHTML = `
      <button type="button" data-toc-action="first" ${page === 0 ? 'disabled' : ''}>First</button>
      <button type="button" data-toc-action="prev" ${page === 0 ? 'disabled' : ''}>Previous</button>
      <select data-toc-range aria-label="Chapter range">
        ${Array.from({length: pageCount}, (_, i) => `<option value="${i}" ${i === page ? 'selected' : ''}>${rangeLabel(i, n.chapters.length)}</option>`).join('')}
      </select>
      <button type="button" data-toc-action="next" ${page === pageCount - 1 ? 'disabled' : ''}>Next</button>
      <button type="button" data-toc-action="last" ${page === pageCount - 1 ? 'disabled' : ''}>Last</button>`;
    tocSection.appendChild(pager);

    const note = document.createElement('div');
    note.className = 'toc-page-note';
    note.textContent = `${start + 1}–${end} of ${n.chapters.length} chapters`;
    tocSection.appendChild(note);
  }

  function fixDetail(n) {
    if (!n || !(location.hash.startsWith(`#/novel/${n.id}`) || location.pathname.replace(/\/+$/, '') === `/novel/${encodeURIComponent(n.id)}`)) return;
    setText(main.querySelector('.book-info .meta'), `${n.chapters.length} chapters · English · ${'Licensed edition'}`);
    const licenseNote = main.querySelector('.description .meta');
    if (licenseNote) licenseNote.remove();

    const p = prefs();
    if (p.autoResume === 'no') {
      const primary = main.querySelector('.actions a.button');
      if (primary) {
        primary.href = readerHref(n.id, 1);
        primary.textContent = 'Start reading';
      }
    }

    const tocSection = main.querySelector('.toc')?.closest('section');
    if (!tocSection) return;

    if (!main.querySelector(`[data-latest-licensed="${n.id}"]`)) {
      const latest = n.chapters.map((c, i) => ({c, i})).slice(-6).reverse();
      const section = document.createElement('section');
      section.dataset.latestLicensed = n.id;
      section.innerHTML = `<div class="section-head"><h2>Latest chapters</h2><span class="meta">Newest first</span></div><div class="toc">${latest.map(({c,i}) => chapterLink(n, c, i, progressFor(n.id))).join('')}</div>`;
      tocSection.parentNode.insertBefore(section, tocSection);
    }

    renderTocPage(n, tocSection);
  }

  function chapterOptions(n, current) {
    return n.chapters.map((c, i) => `<option value="${i + 1}" ${i + 1 === current ? 'selected' : ''}>Ch.${i + 1} ${esc(c.title || '')}</option>`).join('');
  }

  function settingsPanel(p) {
    const theme = ['light','sepia','night'].includes(p.theme) ? p.theme : 'light';
    const size = Math.min(30, Math.max(16, Number(p.size) || 20));
    const font = p.readerFont || 'Georgia';
    const line = String(p.readerLine || '1.9');
    const mode = p.readerMode || 'scroll';
    const auto = p.autoResume || 'yes';
    const width = p.readerWidth || 'normal';

    return `<div class="reader-settings-panel" data-reader-settings-panel hidden>
      <div class="reader-setting-row"><span>Background</span><select data-reader-setting="theme"><option value="light" ${theme==='light'?'selected':''}>Light</option><option value="sepia" ${theme==='sepia'?'selected':''}>Sepia</option><option value="night" ${theme==='night'?'selected':''}>Night</option></select></div>
      <div class="reader-setting-row"><span>Font family</span><select data-reader-setting="readerFont"><option value="Georgia" ${font==='Georgia'?'selected':''}>Georgia</option><option value="Arial" ${font==='Arial'?'selected':''}>Arial</option><option value="DM Sans" ${font==='DM Sans'?'selected':''}>DM Sans</option><option value="system" ${font==='system'?'selected':''}>System</option></select></div>
      <div class="reader-setting-row"><span>Font size</span><select data-reader-setting="size">${[16,18,20,22,24,26,28,30].map(v=>`<option value="${v}" ${v===size?'selected':''}>${v}px</option>`).join('')}</select></div>
      <div class="reader-setting-row"><span>Line height</span><select data-reader-setting="readerLine"><option value="1.6" ${line==='1.6'?'selected':''}>160%</option><option value="1.75" ${line==='1.75'?'selected':''}>175%</option><option value="1.9" ${line==='1.9'?'selected':''}>190%</option><option value="2.05" ${line==='2.05'?'selected':''}>205%</option></select></div>
      <div class="reader-setting-row"><span>Read mode</span><div class="reader-choice-group"><label><input type="radio" name="readerMode" value="scroll" data-reader-setting="readerMode" ${mode==='scroll'?'checked':''}> Scroll</label><label><input type="radio" name="readerMode" value="page" data-reader-setting="readerMode" ${mode==='page'?'checked':''}> Page</label></div></div>
      <div class="reader-setting-row"><span>Auto resume</span><div class="reader-choice-group"><label><input type="radio" name="autoResume" value="yes" data-reader-setting="autoResume" ${auto==='yes'?'checked':''}> Yes</label><label><input type="radio" name="autoResume" value="no" data-reader-setting="autoResume" ${auto==='no'?'checked':''}> No</label></div></div>
      <div class="reader-setting-row"><span>Reading width</span><div class="reader-choice-group"><label><input type="radio" name="readerWidth" value="wide" data-reader-setting="readerWidth" ${width==='wide'?'checked':''}> Wide</label><label><input type="radio" name="readerWidth" value="normal" data-reader-setting="readerWidth" ${width==='normal'?'checked':''}> Normal</label><label><input type="radio" name="readerWidth" value="narrow" data-reader-setting="readerWidth" ${width==='narrow'?'checked':''}> Narrow</label></div></div>
    </div>`;
  }

  function applyReaderPrefs() {
    const wrap = main.querySelector('.reader-wrap');
    if (!wrap) return;
    const p = prefs();
    const theme = ['light','sepia','night'].includes(p.theme) ? p.theme : 'light';
    const size = Math.min(30, Math.max(16, Number(p.size) || 20));
    const line = Number(p.readerLine) || 1.9;
    const fontMap = {
      Georgia: 'Georgia, serif',
      Arial: 'Arial, sans-serif',
      'DM Sans': "'DM Sans', sans-serif",
      system: 'system-ui, sans-serif'
    };
    const widthMap = {wide:'980px',normal:'790px',narrow:'620px'};

    document.body.dataset.theme = theme;
    document.documentElement.style.setProperty('--reader-size', `${size}px`);
    document.documentElement.style.setProperty('--reader-line-height', String(line));
    document.documentElement.style.setProperty('--reader-font-family', fontMap[p.readerFont] || fontMap.Georgia);
    document.documentElement.style.setProperty('--reader-content-width', widthMap[p.readerWidth] || widthMap.normal);
    wrap.dataset.readMode = p.readerMode === 'page' ? 'page' : 'scroll';
  }

  function fixReader(n) {
    if (!n || !(location.hash.startsWith(`#/read/${n.id}/`) || location.pathname.replace(/\/+$/, '') === `/read/${encodeURIComponent(n.id)}`)) return;
    const current = currentReaderNumber();
    if (!current) return;

    setText(main.querySelector('.reader-heading .meta'), `${n.title} · ${'Licensed edition'}`);

    const oldTools = main.querySelector('.reader-tools');
    if (oldTools) {
      const modern = document.createElement('div');
      modern.className = 'modern-reader-shell';
      modern.innerHTML = `<div class="modern-reader-tools">
        ${current > 1 ? `<a class="reader-nav-button" href="${readerHref(n.id, current - 1)}" aria-label="Previous chapter">‹</a>` : '<span class="reader-nav-button disabled" aria-hidden="true">‹</span>'}
        <select class="reader-chapter-select" data-chapter-jump="${n.id}" aria-label="Jump to chapter">${chapterOptions(n, current)}</select>
        <button class="reader-settings-button" type="button" data-reader-settings-toggle aria-label="Reader settings">⚙</button>
        ${current < n.chapters.length ? `<a class="reader-nav-button" href="${readerHref(n.id, current + 1)}" aria-label="Next chapter">›</a>` : '<span class="reader-nav-button disabled" aria-hidden="true">›</span>'}
      </div>${settingsPanel(prefs())}`;
      oldTools.replaceWith(modern);
    }

    applyReaderPrefs();
    window.dispatchEvent(new Event('novelnest:reader-ready'));
  }

  function fixAbout() {
    if (!location.hash.startsWith('#/about')) return;
    const about = main.querySelector('.about');
    if (!about) return;
    const titles = (window.NOVELS || []).map(n => esc(n.title)).join(' and ');
    about.innerHTML = `<span class="eyebrow">A home for stories</span><h1>About NovelNest</h1><p>NovelNest is a place to read novels chapter by chapter.</p><h2>Our collection</h2><p>${titles || 'Novels'} ${(window.NOVELS || []).length === 1 ? 'is' : 'are'} available to read on NovelNest.</p><h2>Your reading data</h2><p>You can read as a guest, with bookmarks and reading progress stored on this device, or sign in with Google to sync bookmarks, chapter labels, and reading positions using Firebase. Each account has its own library. Appearance preferences stay on this device. Google processes sign-in information; NovelNest uses your account ID to store your reading data. Chapter alerts appear inside the site for saved novels when you revisit or refresh. No email or phone push notifications are sent.</p>`;
  }

  function fix() {
    cleanCommon();
    cleanHome();
    const n = routeNovel();
    fixDetail(n);
    fixReader(n);
    fixAbout();
    window.dispatchEvent(new Event('novelnest:view-ready'));
  }

  main.addEventListener('click', e => {
    const toggle = e.target.closest('[data-synopsis-toggle]');
    if (toggle) {
      const container = toggle.closest('[data-synopsis]');
      const preview = container?.querySelector('[data-synopsis-preview]');
      const full = container?.querySelector('[data-synopsis-full]');
      if (preview && full) {
        const expand = toggle.getAttribute('aria-expanded') !== 'true';
        preview.hidden = expand;
        full.hidden = !expand;
        toggle.setAttribute('aria-expanded', String(expand));
        toggle.textContent = expand ? 'See less' : 'See more';
      }
      return;
    }
    const action = e.target.closest('[data-toc-action]');
    if (action) {
      const pager = action.closest('.toc-pager');
      const n = (window.NOVELS || []).find(x => x.id === pager?.dataset.novelId);
      const tocSection = pager?.closest('section');
      if (!n || !tocSection) return;
      const pageCount = Math.max(1, Math.ceil(n.chapters.length / PAGE_SIZE));
      let page = tocPages[n.id] || 0;
      if (action.dataset.tocAction === 'first') page = 0;
      if (action.dataset.tocAction === 'prev') page -= 1;
      if (action.dataset.tocAction === 'next') page += 1;
      if (action.dataset.tocAction === 'last') page = pageCount - 1;
      renderTocPage(n, tocSection, page);
      tocSection.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }

    const settings = e.target.closest('[data-reader-settings-toggle]');
    if (settings) {
      const panel = main.querySelector('[data-reader-settings-panel]');
      if (panel) panel.hidden = !panel.hidden;
    }
  });

  main.addEventListener('change', e => {
    const range = e.target.closest('[data-toc-range]');
    if (range) {
      const pager = range.closest('.toc-pager');
      const n = (window.NOVELS || []).find(x => x.id === pager?.dataset.novelId);
      const tocSection = pager?.closest('section');
      if (n && tocSection) renderTocPage(n, tocSection, Number(range.value));
      return;
    }

    const jump = e.target.closest('[data-chapter-jump]');
    if (jump) {
      const number = Number(jump.value);
      if (Number.isInteger(number) && number > 0) location.href = readerHref(jump.dataset.chapterJump, number);
      return;
    }

    const setting = e.target.closest('[data-reader-setting]');
    if (setting) {
      const p = prefs();
      const key = setting.dataset.readerSetting;
      p[key] = setting.value;
      writePrefs(p);
      applyReaderPrefs();
      window.dispatchEvent(new Event('novelnest:reader-layout'));
    }
  });

  window.addEventListener('hashchange', () => setTimeout(fix, 0));
  setTimeout(fix, 0);
})();
