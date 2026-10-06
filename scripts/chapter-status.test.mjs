import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function setup(storage = new Map(), { lazy = false, blocked = false } = {}) {
  const callbacks = new Map();
  const on = (event, fn) => callbacks.set(event, [...callbacks.get(event) || [], fn]);
  let control = null;
  const label = { textContent: '', dataset: {} };
  const button = { textContent: '', setAttribute() {} };
  const nav = { insertAdjacentElement(_where, node) { control = node; } };
  const document = {
    addEventListener: on,
    querySelector: selector => selector === '.chapter-nav' ? nav : control,
    createElement: () => ({ querySelector: selector => selector === '[data-chapter-status-label]' ? label : button }),
  };
  const window = { NOVELS: [{ id: 'story', chapters: [{ lazy }, { lazy: false }] }], addEventListener: on };
  const context = vm.createContext({ window, document, location: { hash: '#/read/story/1' },
    localStorage: { getItem: key => { if (blocked) throw Error('Storage unavailable'); return storage.get(key) || null; }, setItem: (key, value) => { if (blocked) throw Error('Storage unavailable'); storage.set(key, value); } },
  });
  vm.runInContext(fs.readFileSync('dist/chapter-status.js', 'utf8'), context);
  const fire = (event, value) => { for (const fn of callbacks.get(event) || []) fn(value); };
  return { api: window.NovelNestReading, window, label, button, storage,
    ready: () => fire('novelnest:reader-ready'),
    click: () => fire('click', { target: { closest: () => true } }),
  };
}

test('a loading chapter remains unread until its real content appears', () => {
  const h = setup(new Map(), { lazy: true });
  h.ready(); assert.equal(h.api.status('story', 1), 'unread');
  assert.equal(h.label.textContent, '');
  h.window.NOVELS[0].chapters[0].lazy = false; h.ready();
  assert.equal(h.api.status('story', 1), 'in-progress');
  assert.equal(h.label.textContent, 'In progress');
  assert.equal(h.api.status('story', 2), 'unread');
});

test('mark finished and undo work without navigating; finished survives reopening and position cleanup', () => {
  const h = setup(); h.ready(); h.click();
  assert.equal(h.label.textContent, 'Finished');
  assert.equal(h.button.textContent, 'Mark as in progress');
  h.storage.delete('novelnest.positions');
  const reopened = setup(h.storage); reopened.ready();
  assert.equal(reopened.api.status('story', 1), 'finished');
  reopened.click();
  assert.equal(reopened.label.textContent, 'In progress');
  assert.equal(reopened.button.textContent, 'Mark chapter finished');
  assert.equal(setup(h.storage).api.status('story', 1), 'in-progress');
});

test('earlier saved positions migrate as in progress, without overwriting finished chapters', () => {
  const storage = new Map([
    ['novelnest.positions', JSON.stringify({ 'story:1': { percent: 100 }, 'story:2': { percent: 30 }, 'story:999': { percent: 100 } })],
    ['novelnest.chapter-status', JSON.stringify({ story: { started: [1], finished: [1] } })],
  ]);
  const h = setup(storage);
  assert.equal(h.api.status('story', 1), 'finished');
  assert.equal(h.api.status('story', 2), 'in-progress');
  assert.equal(h.api.status('story', 999), 'unread');
  h.api.setFinished('story', 999, true);
  assert.deepEqual(JSON.parse(storage.get('novelnest.chapter-status')).story.finished, [1]);
});

test('malformed or blocked storage does not break the controls', () => {
  const malformed = setup(new Map([['novelnest.chapter-status', '{broken']]));
  malformed.ready(); malformed.click(); assert.equal(malformed.label.textContent, 'Finished');
  const blocked = setup(new Map(), { blocked: true });
  blocked.ready(); blocked.click(); assert.equal(blocked.label.textContent, 'Finished');
  blocked.click(); assert.equal(blocked.label.textContent, 'In progress');
});
