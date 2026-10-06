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
})();
