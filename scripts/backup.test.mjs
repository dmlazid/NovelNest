import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const empty = () => ({ saved: [], progress: {}, positions: {}, chapterStatus: {} });
const position = at => ({ paragraph: 4, fraction: 0.3, percent: 45, start: false, at });
const fixture = () => ({ saved: ['book'], progress: { book: { chapter: 1, at: 100 } }, positions: { 'book:2': position(100) }, chapterStatus: { book: { started: [1, 2], finished: [1] } } });
const backup = data => JSON.stringify({ format: 'novelnest-backup', version: 1, data });
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const storage = new Map(), listeners = new Map(), nodes = new Map();
  let section = null, reloads = 0, failure = null;
  const node = name => {
    if (!nodes.has(name)) nodes.set(name, { textContent: '', hidden: true, click() {}, remove() {} });
    return nodes.get(name);
  };
  const main = { addEventListener: (name, fn) => listeners.set(name, fn), querySelector: name => name === '#library-backup' ? section : node(name), appendChild: value => { section = value; } };
  const window = { NOVELS: [{ id: 'book', chapters: [{}, {}, {}] }], addEventListener: (name, fn) => listeners.set(name, fn) };
  const context = vm.createContext({ window, document: { querySelector: () => main, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }, location: { hash: '#/library', reload() { reloads++; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (key === failure) { failure = null; throw Error('Quota exceeded'); } storage.set(key, value); }, removeItem: key => storage.delete(key) },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, Blob, URL: { createObjectURL() { return 'blob:backup'; }, revokeObjectURL() {} }, setTimeout() {}, Date,
  });
  vm.runInContext(fs.readFileSync('dist/backup.js', 'utf8'), context);
  return { api: window.NovelNestBackup, storage, node, listeners, fail: key => { failure = key; }, get reloads() { return reloads; },
    mount: () => listeners.get('novelnest:view-ready')(),
    click: selector => listeners.get('click')({ target: { closest: value => value === selector } }),
    choose: text => listeners.get('change')({ target: { matches: () => true, files: [{ size: text.length, text: async () => text }], value: 'backup.json' } }),
  };
}

test('backup round trip preserves bookmarks, chapter progress, paragraph positions, and labels', () => {
  const h = harness(); h.api.write(fixture());
  assert.deepEqual(plain(h.api.parse(backup(h.api.readCurrent()))), fixture());
});

test('restore merges saved novels and Finished labels while retaining newer positions', () => {
  const h = harness(), current = fixture(), incoming = fixture();
  incoming.progress.book = { chapter: 2, at: 200 };
  incoming.positions['book:2'] = position(50);
  incoming.chapterStatus.book.finished = [2];
  const merged = plain(h.api.combine(current, incoming));
  assert.equal(merged.progress.book.chapter, 2);
  assert.equal(merged.positions['book:2'].at, 100);
  assert.deepEqual(merged.saved, ['book']);
  assert.deepEqual(merged.chapterStatus.book.finished, [1, 2]);
});

test('invalid, oversized, and unsupported backups are rejected before any storage changes', () => {
  const h = harness(); h.api.write(fixture()); const before = [...h.storage];
  for (const text of ['not json', '{}', '{"format":"novelnest-backup","version":2}', 'x'.repeat(1000001)]) assert.throws(() => h.api.parse(text));
  const bad = fixture(); bad.positions['book:2'].fraction = -1;
  assert.throws(() => h.api.parse(backup(bad)), /invalid reading data/);
  bad.positions['book:2'] = position(100); bad.chapterStatus.book.finished = [99];
  assert.throws(() => h.api.parse(backup(bad)), /invalid reading data/);
  assert.deepEqual([...h.storage], before);
});

test('unknown novels and unexpected properties are omitted, without restoring scripts or appearance settings', () => {
  const h = harness(), data = fixture();
  data.saved.push('not-in-catalog'); data.progress.other = { chapter: 1, at: 100 };
  data.positions['other:2'] = position(100); data.chapterStatus.other = { started: [1], finished: [1] };
  data.preferences = { theme: '<script>alert(1)</script>' };
  assert.deepEqual(plain(h.api.parse(backup(data))), fixture());
});

test('a failed write rolls back previously written keys and leaves other browser settings alone', () => {
  const h = harness(); h.api.write(fixture()); h.storage.set('novelnest.preferences', '{"theme":"night"}');
  const before = [...h.storage]; h.fail('novelnest.positions');
  assert.throws(() => h.api.write(empty()), /existing data was kept/);
  assert.deepEqual([...h.storage], before);
});

