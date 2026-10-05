import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function reader({ saved = {}, prefs = {}, mode = 'scroll', blocked = false, lazy = false } = {}) {
  const events = new Map(), frames = new Map(), timers = new Map();
  const storage = new Map([['novelnest.positions', JSON.stringify(saved)], ['novelnest.preferences', JSON.stringify(prefs)]]);
  let id = 0, height = 100, proseTop = 200, chapter = 1;
  const emit = name => { for (const callback of events.get(name) || []) callback(); };
  const on = (name, fn) => events.set(name, [...events.get(name) || [], fn]);
  const window = { scrollY: 0, innerHeight: 400, NOVELS: [{ id: 'story', chapters: [{ lazy }, { lazy: false }] }], addEventListener: on, scrollTo({ top }) { this.scrollY = top; emit('scroll'); } };
  const location = { hash: '#/read/story/1' };
  const label = { textContent: '' }, meter = { value: 0 };
  const bars = [];
  const rect = (top, left, width, h) => ({ top, bottom: top + h, left, right: left + width, width, height: h });
  let prose, wrap;
  const layout = () => {
    prose = {
      scrollLeft: 0, clientWidth: 300, scrollWidth: 1500,
      getBoundingClientRect: () => rect(proseTop - window.scrollY, 20, 300, height * 10),
      querySelectorAll: () => Array.from({ length: 10 }, (_, i) => ({ getBoundingClientRect: () => wrap.dataset.readMode === 'page' ? rect(proseTop - window.scrollY + (i % 2) * 100, 20 + Math.floor(i / 2) * 300 - prose.scrollLeft, 300, 100) : rect(proseTop + i * height - window.scrollY, 20, 300, height) })),
      addEventListener: (name, fn) => on('prose:' + name, fn),
    };
    wrap = { dataset: { readMode: mode }, querySelector: () => prose, appendChild: bar => bars.push(bar) };
  };
  layout();
  const document = {
    hidden: false, addEventListener: on, querySelector: () => wrap,
    createElement: () => ({ setAttribute() {}, querySelector: selector => selector === 'progress' ? meter : label }),
  };
  const context = vm.createContext({ window, location, document, Date, console,
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key),
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
    localStorage: { getItem: key => { if (blocked) throw Error('Storage denied'); return storage.get(key); }, setItem: (key, value) => { if (blocked) throw Error('Storage denied'); storage.set(key, value); } },
  });
  vm.runInContext(fs.readFileSync('dist/reading-position.js', 'utf8'), context);
  function flush() { let n = 0; while (frames.size) { assert(++n < 20); const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); } }
  function ready() { emit('novelnest:reader-ready'); flush(); }
  function scroll(y) { window.scrollY = y; emit('scroll'); flush(); }
  function leave(next = 2) {
    emit('novelnest:before-route');
    chapter = next; location.hash = `#/read/story/${chapter}`;
    window.scrollY = 0; layout();
  }
  function positions() { emit('pagehide'); return JSON.parse(storage.get('novelnest.positions')); }
  return { window, document, ready, scroll, leave, emit, flush, positions, label, meter, bars, get prose() { return prose; }, changeHeight(value) { height = value; emit('resize'); flush(); }, top() { for (const callback of events.get('click') || []) callback({ target: { closest: () => true } }); flush(); } };
}

test('restores paragraph and its offset after reopening, even when text height changes', () => {
  const h = reader(); h.ready(); h.scroll(534);
  let saved = h.positions()['story:1'];
  assert.equal(saved.paragraph, 3);
  assert.equal(saved.fraction, 0.5);
  assert.equal(saved.percent, 55);
  assert.equal(h.label.textContent, '55% read');
  h.leave(); h.ready(); assert.equal(h.window.scrollY, 0);
  h.leave(1); h.ready(); assert.equal(h.window.scrollY, 534);
  h.changeHeight(200); assert.equal(h.window.scrollY, 884);
  saved = h.positions()['story:1'];
  assert.equal(saved.paragraph, 3); assert.equal(saved.fraction, 0.5);
});

test('loading placeholder does not overwrite a saved position; content restores once ready', () => {
  const h = reader({ lazy: true, saved: { 'story:1': { paragraph: 5, fraction: 0.25, percent: 70, start: false } } });
  h.ready(); assert.equal(h.bars.length, 0);
  assert.equal(h.positions()['story:1'].paragraph, 5);
  h.window.NOVELS[0].chapters[0].lazy = false;
  h.ready(); assert.equal(h.window.scrollY, 709);
  h.ready(); assert.equal(h.bars.length, 1);
});

test('page mode saves and restores the horizontal reading page', () => {
  const h = reader({ mode: 'page' }); h.ready();
  h.prose.scrollLeft = 600; h.emit('prose:scroll'); h.flush();
  assert.equal(h.positions()['story:1'].paragraph, 4);
  assert.equal(h.label.textContent, '50% read');
  h.leave(); h.ready(); h.leave(1); h.ready();
  assert.equal(h.prose.scrollLeft, 600);
  h.top(); assert.equal(h.prose.scrollLeft, 0); assert.equal(h.window.scrollY, 0);
  assert.equal(h.label.textContent, '0% read');
});

test('Back to top resets the stored position and reopening starts at the top', () => {
  const h = reader(); h.ready(); h.scroll(734); h.top();
  assert.equal(h.window.scrollY, 0);
  assert.equal(h.positions()['story:1'].start, true);
  assert.equal(h.label.textContent, '0% read');
  h.leave(); h.ready(); h.leave(1); h.ready(); assert.equal(h.window.scrollY, 0);
});

test('auto-resume setting is respected and blocked storage does not break reading', () => {
  const h = reader({ prefs: { autoResume: 'no' }, saved: { 'story:1': { paragraph: 7, fraction: 0.5 } } });
  h.ready(); assert.equal(h.window.scrollY, 0);
  const unavailable = reader({ blocked: true }); unavailable.ready(); unavailable.scroll(534);
  assert.equal(unavailable.label.textContent, '55% read'); unavailable.top();
});

test('position is flushed when a mobile browser hides the page', () => {
  const h = reader(); h.ready(); h.scroll(534);
  h.document.hidden = true; h.emit('visibilitychange');
  assert.equal(h.positions()['story:1'].paragraph, 3);
});
