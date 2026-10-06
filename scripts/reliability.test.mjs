import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { validateSite } from './check.mjs';

function harness(hash = '#/') {
  const nodes = new Map(), events = new Map(), timers = [], scripts = [], storage = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, focus() {}, setAttribute() {}, removeAttribute() {} });
    return nodes.get(id);
  };
  const document = {
    querySelector: node, querySelectorAll: () => [], body: node('body'), documentElement: node('html'),
    createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: script => scripts.push(script) },
    addEventListener: (name, callback) => events.set(`document:${name}`, callback),
  };
  const window = { addEventListener(name, callback) { const callbacks = events.get(name) || []; callbacks.push(callback); events.set(name, callbacks); }, dispatchEvent(event) { for (const callback of events.get(event.type) || []) callback(event); }, scrollTo() {} };
  const context = vm.createContext({ window, document, location: { hash }, Event, URLSearchParams, console, setTimeout: callback => timers.push(callback), clearTimeout() {}, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const run = text => vm.runInContext(text, context);
  const load = name => run(fs.readFileSync(`dist/${name}`, 'utf8'));
  for (const file of ['catalog.js', 'licensed-gallery.js', 'licensed-astral.js', 'licensed-monarch.js', 'licensed-signin.js', 'licensed-luna.js', 'licensed-sss.js', 'licensed-farming.js', 'app.js', 'lazy-chapters.js']) load(file);
  const flush = () => { let count = 0; while (timers.length) { assert(++count < 100, 'Unexpected render loop'); timers.shift()(); } };
  const go = next => { context.location.hash = next; window.dispatchEvent(new Event('hashchange')); flush(); };
  const complete = script => { const original = Object.entries(window.NOVELNEST_ASSETS || {}).find(([, value]) => value === script.src)?.[0] || script.src; load(original); script.onload(); flush(); };
  flush();
  return { context, window, scripts, run, flush, go, complete, node, storage, events };
}

test('all existing chapters and their catalog entries validate', () => {
  const result = validateSite();
  const h = harness();
  assert.equal(result.novels, h.window.NOVELS.length);
  assert.equal(result.chapters, h.window.NOVELS.reduce((total, novel) => total + novel.chapters.length, 0));
});

test('homepage loads no chapter bodies; direct chapter links work across chunk boundaries', () => {
  const h = harness();
  assert.equal(h.scripts.length, 0);
  for (const novel of h.window.NOVELS) {
    const id = novel.id, count = novel.chapters.length, capacity = novel.lazyChunks.capacity;
    const numbers = [...new Set([1, capacity, capacity + 1, count - count % capacity, count].filter(n => n > 0 && n <= count))];
    for (const number of numbers) {
      h.go(`#/read/${id}/${number}`);
      const n = h.window.NOVELS.find(n => n.id === id);
      if (n.chapters[number - 1].lazy) h.complete(h.scripts.at(-1));
      assert.equal(n.chapters[number - 1].lazy, false);
      assert(!h.node('#main').innerHTML.includes('Loading chapter…'));
      assert.equal(JSON.parse(h.storage.get('novelnest.progress'))[id].chapter, number - 1);
    }
  }
  h.go(`#/read/got-a-gallery-in-the-wild/${h.window.NOVELS[0].chapters.length + 1}`);
  assert.match(h.node('#main').innerHTML, /Page not found/);
});

test('slow loads do not rerender a different page, and same-chunk navigation shares one request', () => {
  const h = harness('#/read/got-a-gallery-in-the-wild/1');
  const first = h.scripts[0];
  h.go('#/read/got-a-gallery-in-the-wild/2');
  assert.equal(h.scripts.length, 1);
  h.complete(first);
  assert.equal(h.window.NOVELS[0].chapters[1].lazy, false);
  h.go('#/read/astral-pet-store/101');
  const slow = h.scripts.at(-1);
  h.go('#/browse');
  const html = h.node('#main').innerHTML;
  h.complete(slow);
  assert.equal(h.node('#main').innerHTML, html);
  const requests = h.scripts.length;
  h.go('#/read/astral-pet-store/102');
  assert.equal(h.scripts.length, requests);
  assert.equal(h.window.NOVELS[1].chapters[101].lazy, false);
});

test('failed chapter loads have a working retry and use the asset manifest', () => {
  const h = harness();
  const config = h.window.NOVELS[0].lazyChunks;
  const chunk = String(Math.floor(169 / config.capacity) + 1).padStart(2, '0');
  const original = `${config.prefix}${chunk}.js`;
  const versioned = `${config.prefix}${chunk}.fingerprint.js`;
  h.window.NOVELNEST_ASSETS = { [original]: versioned };
  h.go('#/read/got-a-gallery-in-the-wild/170');
  assert.equal(h.scripts[0].src, versioned);
  h.scripts[0].onerror();
  assert.match(h.node('.prose').innerHTML, /Try again/);
  h.events.get('document:click')({ target: { closest: () => true } });
  assert.equal(h.scripts.length, 2);
  h.complete(h.scripts[1]);
  assert.equal(h.window.NOVELS[0].chapters[169].lazy, false);
});

test('ongoing stories show caught-up text; completed stories show an ending', () => {
  const h = harness();
  h.go('#/novel/got-a-gallery-in-the-wild');
  assert.match(h.node('#main').innerHTML, /Ongoing · More chapters to come/);
  assert(!h.node('#main').innerHTML.includes('Complete story'));
  h.go(`#/read/got-a-gallery-in-the-wild/${h.window.NOVELS[0].chapters.length}`);
  assert.match(h.node('#main').innerHTML, /You’re caught up/);
  h.go(`#/read/astral-pet-store/${h.window.NOVELS[1].chapters.length}`);
  assert.match(h.node('#main').innerHTML, /The end\. Thank you for reading/);
});

test('validation rejects empty catalogs, missing chunks, and mismatched chapter indexes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novelnest-check-'));
  try {
    fs.cpSync('dist', root, { recursive: true });
    const catalog = path.join(root, 'catalog.js'), original = fs.readFileSync(catalog, 'utf8');
    fs.writeFileSync(catalog, 'window.NOVELS=[];window.NOVELS.push=()=>{};');
    assert.throws(() => validateSite(root), /No novels were checked/);
    fs.writeFileSync(catalog, original);
    const chunk = path.join(root, 'data/gallery-chapters-04.js'), bytes = fs.readFileSync(chunk);
    fs.unlinkSync(chunk);
    assert.throws(() => validateSite(root), /Missing chapter file/);
    fs.writeFileSync(chunk, bytes);
    const metadata = path.join(root, 'licensed-gallery.js');
    fs.writeFileSync(metadata, fs.readFileSync(metadata, 'utf8').replace('"number":1,', '"number":2,'));
    assert.throws(() => validateSite(root), /catalog number mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
