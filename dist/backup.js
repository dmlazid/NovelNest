(() => {
  const keys = { saved: 'novelnest.saved', progress: 'novelnest.progress', positions: 'novelnest.positions', chapterStatus: 'novelnest.chapter-status' };
  const books = new Map((window.NOVELS || []).map(n => [n.id, n.chapters.length]));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const validTime = value => Number.isFinite(value) && value >= 0;
  const check = (condition, message = 'This backup contains invalid reading data.') => { if (!condition) throw Error(message); };

  function normalize(data) {
    check(object(data) && Array.isArray(data.saved) && object(data.progress) && object(data.positions) && object(data.chapterStatus));
    const result = { saved: [], progress: {}, positions: {}, chapterStatus: {} };
    check(data.saved.every(id => typeof id === 'string'));
    result.saved = [...new Set(data.saved.filter(id => books.has(id)))];
    for (const [id, value] of Object.entries(data.progress)) {
      if (!books.has(id)) continue;
      check(object(value) && Number.isInteger(value.chapter) && value.chapter >= 0 && value.chapter < books.get(id) && validTime(value.at));
      result.progress[id] = { chapter: value.chapter, at: value.at };
    }
    for (const [key, value] of Object.entries(data.positions)) {
      const match = key.match(/^([^:]+):(\d+)$/);
      if (!match || !books.has(match[1])) continue;
      check(Number(match[2]) > 0 && Number(match[2]) <= books.get(match[1]));
      check(object(value) && Number.isInteger(value.paragraph) && value.paragraph >= 0 && value.paragraph <= 1000000 && Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1 && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100 && typeof value.start === 'boolean' && validTime(value.at));
      result.positions[`${match[1]}:${Number(match[2])}`] = { paragraph: value.paragraph, fraction: value.fraction, percent: value.percent, start: value.start, at: value.at };
    }
    for (const [id, value] of Object.entries(data.chapterStatus)) {
      if (!books.has(id)) continue;
      check(object(value) && Array.isArray(value.started) && Array.isArray(value.finished));
      check([...value.started, ...value.finished].every(n => Number.isInteger(n) && n > 0 && n <= books.get(id)));
      result.chapterStatus[id] = { started: [...new Set([...value.started, ...value.finished])], finished: [...new Set(value.finished)] };
    }
    result.positions = Object.fromEntries(Object.entries(result.positions).sort((a, b) => b[1].at - a[1].at).slice(0, 200));
    return result;
  }

  function readCurrent() {
    const data = {};
    for (const [name, key] of Object.entries(keys)) {
      const raw = localStorage.getItem(key);
      data[name] = raw === null ? (name === 'saved' ? [] : {}) : JSON.parse(raw);
    }
    return normalize(data);
  }

  function parse(text) {
    check(typeof text === 'string' && text.length <= 1000000, 'Choose a NovelNest JSON backup smaller than 1 MB.');
    let backup;
    try { backup = JSON.parse(text); } catch { throw Error('This file is not valid JSON. Choose a NovelNest backup.'); }
    check(backup?.format === 'novelnest-backup' && backup.version === 1, 'This file is not a supported NovelNest backup.');
    return normalize(backup.data);
  }

  function combine(current, restored) {
    current = normalize(current); restored = normalize(restored);
    current.saved = [...new Set([...current.saved, ...restored.saved])];
    for (const name of ['progress', 'positions']) {
      for (const [key, value] of Object.entries(restored[name])) {
        if (!current[name][key] || value.at > current[name][key].at) current[name][key] = value;
      }
    }
    for (const [id, value] of Object.entries(restored.chapterStatus)) {
      const old = current.chapterStatus[id] || { started: [], finished: [] };
      current.chapterStatus[id] = { started: [...new Set([...old.started, ...value.started])], finished: [...new Set([...old.finished, ...value.finished])] };
    }
    return normalize(current);
  }

  function write(data) {
    data = normalize(data);
    const before = Object.fromEntries(Object.values(keys).map(key => [key, localStorage.getItem(key)]));
    const written = [];
    try {
      for (const [name, key] of Object.entries(keys)) {
        localStorage.setItem(key, JSON.stringify(data[name]));
        written.push(key);
      }
    } catch {
      let recovered = true;
      for (const key of written.reverse()) {
        try { if (before[key] === null) localStorage.removeItem(key); else localStorage.setItem(key, before[key]); } catch { recovered = false; }
      }
      throw Error(recovered ? 'Restore could not be saved. Your existing data was kept. Check browser storage and try again.' : 'Restore could not finish. Keep your backup file and retry when browser storage is available.');
    }
  }

  window.NovelNestBackup = { parse, combine, readCurrent, write };
  let pending = null, selection = 0;
  const main = document.querySelector('#main');
  const status = message => { const node = main.querySelector('[data-backup-message]'); if (node) node.textContent = message; };

  function mount() {
    pending = null; selection++;
    if (location.hash !== '#/library' || main.querySelector('#library-backup')) return;
    const section = document.createElement('section');
    section.id = 'library-backup';
    section.className = 'library-backup';
    section.innerHTML = '<h2>Backup &amp; restore</h2><p>Keep a copy of your saved novels, reading positions, and chapter labels. Save the file before clearing your browser or moving to another phone.</p><div class="actions"><button type="button" class="button" data-backup-export>Download backup</button><button type="button" class="button outline" data-backup-pick>Choose backup file</button><input type="file" accept=".json,application/json" data-backup-file hidden></div><div class="backup-preview" data-backup-preview hidden><p data-backup-summary></p><p class="meta">Restore adds to your current library, keeps newer reading positions, and combines Finished labels. Only novels available on this site are restored. Reader appearance settings stay unchanged.</p><div class="actions"><button type="button" class="button" data-backup-restore>Restore this backup</button><button type="button" class="button outline" data-backup-cancel>Cancel</button></div></div><p data-backup-message role="status" aria-live="polite"></p>';
    main.appendChild(section);
    try {
      if (sessionStorage.getItem('novelnest.backup-restored')) {
        sessionStorage.removeItem('novelnest.backup-restored');
        status('Backup restored. Your library and reading progress are ready.');
      }
    } catch {}
  }

  main.addEventListener('click', event => {
    if (event.target.closest('[data-backup-export]')) {
      try {
        const backup = { format: 'novelnest-backup', version: 1, createdAt: new Date().toISOString(), data: readCurrent() };
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `NovelNest-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        status('Backup download started. Keep the JSON file somewhere safe.');
      } catch { status('Could not read your saved data. Check that browser storage is available.'); }
    }
    if (event.target.closest('[data-backup-pick]')) main.querySelector('[data-backup-file]')?.click();
    if (event.target.closest('[data-backup-cancel]')) {
      pending = null; selection++;
      main.querySelector('[data-backup-preview]').hidden = true;
      status('Restore cancelled. Your data has not changed.');
    }
    if (event.target.closest('[data-backup-restore]') && pending) {
      try {
        write(combine(readCurrent(), pending));
        pending = null;
        try { sessionStorage.setItem('novelnest.backup-restored', 'yes'); } catch {}
        location.reload();
      } catch (error) { status(error.message || 'Could not restore this backup.'); }
    }
  });

  main.addEventListener('change', async event => {
    if (!event.target.matches('[data-backup-file]')) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const ticket = ++selection;
    pending = null;
    main.querySelector('[data-backup-preview]').hidden = true;
    try {
      check(file.size <= 1000000, 'Choose a NovelNest JSON backup smaller than 1 MB.');
      const data = parse(await file.text());
      if (ticket !== selection || location.hash !== '#/library') return;
      pending = data;
      const finished = Object.values(data.chapterStatus).reduce((total, n) => total + n.finished.length, 0);
      main.querySelector('[data-backup-summary]').textContent = `This backup contains ${data.saved.length} saved novels, ${Object.keys(data.positions).length} reading positions, and ${finished} Finished chapter labels for this site.`;
      main.querySelector('[data-backup-preview]').hidden = false;
      status('Backup checked. Select Restore this backup to continue.');
    } catch (error) { if (ticket === selection) status(error.message || 'Could not read this backup file.'); }
  });
  window.addEventListener('novelnest:view-ready', mount);
})();
