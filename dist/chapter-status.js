(() => {
  const KEY = 'novelnest.chapter-status';
  const records = new Map();
  const read = key => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const stored = read(KEY);
  for (const novel of window.NOVELS || []) {
    const valid = number => Number.isInteger(number) && number > 0 && number <= novel.chapters.length;
    const entry = stored[novel.id];
    const started = new Set(Array.isArray(entry?.started) ? entry.started.filter(valid) : []);
    const finished = new Set(Array.isArray(entry?.finished) ? entry.finished.filter(valid) : []);
    for (const number of finished) started.add(number);
    records.set(novel.id, { started, finished, count: novel.chapters.length });
  }

  function persist(unfinish = null) {
    // Read again before writing: another tab may have finished chapters while
    // this tab still had an older in-memory copy. Keep unknown catalog IDs.
    const stored=read(KEY);
    for(const [id,entry] of records){
      const before=stored[id]||{};
      const started=new Set([...(before.started||[]),...entry.started]);
      const finished=new Set([...(before.finished||[]),...entry.finished]);
      if(unfinish?.id===id)finished.delete(unfinish.number);
      for(const number of finished)started.add(number);
      stored[id]={started:[...started].sort((a,b)=>a-b),finished:[...finished].sort((a,b)=>a-b)};
      entry.started=started;entry.finished=finished;
    }
    try{localStorage.setItem(KEY,JSON.stringify(stored));window.NovelNestAccounts?.changed();}catch{}
  }

  // Preserve earlier reading history without assuming that opening a chapter finished it.
  let migrated = false;
  for (const [key, position] of Object.entries(read('novelnest.positions'))) {
    const match = key.match(/^([^:]+):(\d+)$/);
    if (!match || !position || typeof position !== 'object') continue;
    const entry = records.get(match[1]), number = Number(match[2]);
    if (entry && number > 0 && number <= entry.count && !entry.started.has(number)) {
      entry.started.add(number);
      migrated = true;
    }
  }
  if (migrated) persist();

  function validEntry(id, number) {
    const entry = records.get(id);
    return entry && Number.isInteger(number) && number > 0 && number <= entry.count ? entry : null;
  }

  function status(id, number) {
    const entry = validEntry(id, number);
    return entry?.finished.has(number) ? 'finished' : entry?.started.has(number) ? 'in-progress' : 'unread';
  }

  function opened(id, number) {
    const entry = validEntry(id, number);
    if (!entry || entry.started.has(number)) return;
    entry.started.add(number);
    persist();
  }

  function setFinished(id, number, finished) {
    const entry = validEntry(id, number);
    if (!entry) return;
    entry.started.add(number);
    if (finished) entry.finished.add(number);
    else entry.finished.delete(number);
    persist(finished?null:{id,number});
  }

  function reload() {
    const value = read(KEY);
    for (const [id, entry] of records) {
      const valid = n => Number.isInteger(n) && n > 0 && n <= entry.count;
      entry.started = new Set((value[id]?.started || []).filter(valid));
      entry.finished = new Set((value[id]?.finished || []).filter(valid));
      for (const n of entry.finished) entry.started.add(n);
    }
    const current = target(), control = document.querySelector('.chapter-completion');
    if (current && control) updateControl(control, current);
  }
  window.NovelNestReading = { status, opened, setFinished, reload };

  function target() {
    const hashMatch = location.hash.match(/^#\/read\/([^/]+)\/(\d+)$/);
    const cleanPathMatch = (location.pathname || '').match(/^\/novel\/([^/]+)\/chapter-(\d+)\/?$/);
    const oldPathMatch = (location.pathname || '').match(/^\/read\/([^/]+)\/?$/);
    const match = hashMatch || cleanPathMatch || (oldPathMatch ? [null, oldPathMatch[1], new URLSearchParams(location.search || '').get('chapter')] : null);
    if (!match || !match[2]) return null;
    const number = Number(match[2]);
    const novel = (window.NOVELS || []).find(n => n.id === decodeURIComponent(match[1]));
    const chapter = novel?.chapters[number - 1];
    return chapter && !chapter.lazy && !chapter.removedDuplicate ? { id: novel.id, number } : null;
  }

  function updateControl(control, current) {
    const finished = status(current.id, current.number) === 'finished';
    const label = control.querySelector('[data-chapter-status-label]');
    label.textContent = finished ? 'Finished' : 'In progress';
    label.dataset.state = finished ? 'finished' : 'in-progress';
    const button = control.querySelector('[data-toggle-chapter-finished]');
    button.textContent = finished ? 'Mark as in progress' : 'Mark chapter finished';
    button.setAttribute('aria-pressed', String(finished));
  }

  window.addEventListener('novelnest:reader-ready', () => {
    const current = target();
    const nav = document.querySelector('.chapter-nav');
    if (!current || !nav) return;
    opened(current.id, current.number);
    let control = document.querySelector('.chapter-completion');
    if (!control) {
      control = document.createElement('div');
      control.className = 'chapter-completion';
      control.innerHTML = '<span class="chapter-state" data-chapter-status-label role="status"></span><button type="button" class="button outline" data-toggle-chapter-finished>Mark chapter finished</button>';
      nav.insertAdjacentElement('afterend', control);
    }
    updateControl(control, current);
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-toggle-chapter-finished]')) return;
    const current = target();
    const control = document.querySelector('.chapter-completion');
    if (!current || !control) return;
    setFinished(current.id, current.number, status(current.id, current.number) !== 'finished');
    updateControl(control, current);
  });
})();
