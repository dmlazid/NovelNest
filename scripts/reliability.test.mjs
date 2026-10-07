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
  const licensed = fs.readdirSync('dist').filter(name => /^licensed-(?!ui\.js$).+\.js$/.test(name)).sort();
  for (const file of ['catalog.js', ...licensed, 'app.js', 'lazy-chapters.js']) load(file);
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
  const gallery = h.window.NOVELS.find(n => n.id === 'got-a-gallery-in-the-wild');
  const astral = h.window.NOVELS.find(n => n.id === 'astral-pet-store');
  assert(gallery && astral);
  assert.equal(gallery.chapters[1].lazy, false);
  h.go('#/read/astral-pet-store/101');
  const slow = h.scripts.at(-1);
  h.go('#/browse');
  const html = h.node('#main').innerHTML;
  h.complete(slow);
  assert.equal(h.node('#main').innerHTML, html);
  const requests = h.scripts.length;
  h.go('#/read/astral-pet-store/102');
  assert.equal(h.scripts.length, requests);
  assert.equal(astral.chapters[101].lazy, false);
});

test('failed chapter loads have a working retry and use the asset manifest', () => {
  const h = harness();
  const gallery = h.window.NOVELS.find(n => n.id === 'got-a-gallery-in-the-wild');
  assert(gallery);
  const config = gallery.lazyChunks;
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
  assert.equal(gallery.chapters[169].lazy, false);
});

test('ongoing stories show caught-up text; completed stories show an ending', () => {
  const h = harness();
  h.go('#/novel/got-a-gallery-in-the-wild');
  assert.match(h.node('#main').innerHTML, /Ongoing · More chapters to come/);
  assert(!h.node('#main').innerHTML.includes('Complete story'));
  const gallery = h.window.NOVELS.find(n => n.id === 'got-a-gallery-in-the-wild');
  const astral = h.window.NOVELS.find(n => n.id === 'astral-pet-store');
  assert(gallery && astral);
  h.go(`#/read/got-a-gallery-in-the-wild/${gallery.chapters.length}`);
  assert.match(h.node('#main').innerHTML, /You’re caught up/);
  h.go(`#/read/astral-pet-store/${astral.chapters.length}`);
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

test('home See more routes open novel directories instead of chapter feeds', () => {
  const h = harness();
  const home = h.node('#main').innerHTML;
  assert.match(home, /href="\.\/#\/latest-releases"/);
  assert.match(home, /href="\.\/#\/latest-novels"/);
  assert.match(home, /href="\.\/#\/completed"/);

  h.go('#/latest-releases');
  assert.match(h.node('#main').innerHTML, /Latest Release Novels/);
  assert.match(h.node('#main').innerHTML, /directory-novel-row/);
  assert.doesNotMatch(h.node('#main').innerHTML, /Every available chapter/);

  h.go('#/latest-novels');
  assert.match(h.node('#main').innerHTML, /Latest Novels/);
  assert.match(h.node('#main').innerHTML, /directory-novel-row/);

  h.go('#/completed');
  assert.match(h.node('#main').innerHTML, /Completed Novels/);
  const completed = h.window.NOVELS.filter(n => n.status === 'Completed');
  assert.equal((h.node('#main').innerHTML.match(/directory-novel-row/g) || []).length, completed.length);
});

test('internal anchors use explicit same-site routes for precise mobile new-tab opening', () => {
  for (const file of ['dist/index.html', 'dist/app.js', 'dist/accounts.js', 'dist/licensed-ui.js']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /href=["']#\//, file + ' still contains a fragment-only internal href');
  }
  const index = fs.readFileSync('dist/index.html', 'utf8');
  assert.match(index, /class="compact-header-brand" href="\.\/#\//);
});

test('novel update lists do not show upload or update dates', () => {
  const h = harness();
  const home = h.node('#main').innerHTML;
  assert.doesNotMatch(home, /<time\b/);
  h.go('#/latest');
  assert.doesNotMatch(h.node('#main').innerHTML, /<time\b/);
});

test('See More directories keep the approved clean novel-list layout', () => {
  const h = harness();

  h.go('#/latest-releases');
  let html = h.node('#main').innerHTML;
  assert.match(html, /Latest Release Novels/);
  assert.match(html, /directory-novel-row/);
  assert.match(html, /All novels/);
  assert.match(html, /Completed/);
  assert.doesNotMatch(html, /directory-search/);
  assert.doesNotMatch(html, /data-directory-filter/);

  h.go('#/latest-novels');
  html = h.node('#main').innerHTML;
  assert.match(html, /Latest Novels/);
  assert.match(html, /directory-novel-row/);
  assert.doesNotMatch(html, /directory-search/);

  h.go('#/completed');
  html = h.node('#main').innerHTML;
  assert.match(html, /Completed Novels/);
  assert.match(html, /directory-novel-row/);
  assert.doesNotMatch(html, /directory-search/);
});

test('AdSense preparation pages and original Reading Desk are reachable', () => {
  const h = harness();
  const routes = [
    ['#/about', /About NovelNest/],
    ['#/privacy', /Privacy Policy/],
    ['#/terms', /Terms of Use/],
    ['#/contact', /Contact NovelNest/],
    ['#/copyright', /Copyright &amp; Takedown Requests/],
    ['#/reading-desk', /NovelNest Reading Desk/],
  ];
  for (const [route, pattern] of routes) {
    h.go(route);
    assert.match(h.node('#main').innerHTML, pattern);
    assert.doesNotMatch(h.node('#main').innerHTML, /Page not found/);
  }

  h.go('#/editorial/choosing-a-long-web-novel');
  let html = h.node('#main').innerHTML;
  assert.match(html, /How to choose a long web novel without burning out/);
  assert.match(html, /Start with the reading rhythm/);
  assert.match(html, /NovelNest tip/);

  h.go('#/');
  html = h.node('#main').innerHTML;
  assert.match(html, /NovelNest Reading Desk/);
  assert.match(html, /Original NovelNest guide/);
});

test('footer exposes trust and policy navigation', () => {
  const index = fs.readFileSync('dist/index.html', 'utf8');
  for (const route of ['reading-desk','about','privacy','terms','contact','copyright']) {
    assert.match(index, new RegExp('href="\\.\\/#\\/' + route + '"'));
  }
});

test('privacy and copyright pages disclose service and rights handling clearly', () => {
  const h = harness();
  h.go('#/privacy');
  let html = h.node('#main').innerHTML;
  assert.match(html, /Firebase Authentication/);
  assert.match(html, /Google AdSense/);
  assert.match(html, /cookies/);

  h.go('#/copyright');
  html = h.node('#main').innerHTML;
  assert.match(html, /rights holder/);
  assert.match(html, /requesting review or removal/);
  assert.match(html, /github\.com\/dmlazid\/NovelNest\/issues\/new/);
});

test('licensed edition and collapsible summaries appear in novel details', () => {
  const h = harness();
  const novel = h.window.NOVELS.find(n => String(n.synopsis || '').length > 340);
  assert(novel, 'At least one novel should have a long synopsis for this test');
  h.go(`#/novel/${novel.id}`);
  const detail = h.node('#main').innerHTML;
  assert.match(detail, /Licensed edition/);
  assert.match(detail, /data-synopsis-preview/);
  assert.match(detail, /data-synopsis-full hidden/);
  assert.match(detail, /data-synopsis-toggle[^>]+aria-controls/);
  assert.match(detail, /See more/);
  assert.doesNotMatch(detail, /EPUB edition|Sample story/);
  h.go(`#/read/${novel.id}/1`);
  assert.match(h.node('#main').innerHTML, /Licensed edition/);
  assert.doesNotMatch(h.node('#main').innerHTML, /EPUB edition|Sample story/);
});


test('navigation drawer includes Novel list and Genres catalog tabs', () => {
  const accounts = fs.readFileSync('dist/accounts.js', 'utf8');
  assert.match(accounts, /data-catalog-tab="novels"/);
  assert.match(accounts, /data-catalog-tab="genres"/);
  assert.match(accounts, /Latest Novels/);
  assert.match(accounts, /Latest Release/);
  assert.match(accounts, /Completed Novels/);
  assert.match(accounts, /Novel Finder/);
  assert.match(accounts, /#\/genre\//);
  assert.match(accounts, /#\/finder/);
});

test('genre links open dedicated genre directory pages and finder has real filters', () => {
  const h = harness();
  const genre = h.window.NOVELS.flatMap(n => n.tags || []).find(Boolean);
  assert(genre);
  h.go('#/genre/' + encodeURIComponent(genre));
  let html = h.node('#main').innerHTML;
  assert.match(html, /genre-directory-page/);
  assert(html.includes(genre.toUpperCase() + ' NOVELS'));
  assert.match(html, /COMPLETED/);
  assert.match(html, /directory-novel-row/);

  h.go('#/finder');
  html = h.node('#main').innerHTML;
  assert.match(html, /NOVEL FINDER/);
  assert.match(html, /finder-check-grid/);
  assert.match(html, /name="genre"/);
  assert.match(html, /name="chapters"/);
  assert.match(html, /name="status"/);
  assert.match(html, /Apply Filters/);
});

test('top header exposes notifications beside menu and novel breadcrumbs use home and genre', () => {
  const index = fs.readFileSync('dist/index.html', 'utf8');
  assert.match(index, /class="compact-notification-button"[^>]+data-updates/);
  assert.match(index, /class="compact-menu-button"[^>]+data-menu/);
  const h = harness();
  const novel = h.window.NOVELS.find(n => n.id === 'astral-pet-store');
  assert(novel);
  h.go(`#/novel/${novel.id}`);
  const detail = h.node('#main').innerHTML;
  assert.match(detail, />Home</);
  assert.match(detail, />Action Novels</);
  assert.match(detail, /Astral Pet Store/);
  h.go(`#/read/${novel.id}/1`);
  const reader = h.node('#main').innerHTML;
  assert.match(reader, />Home</);
  assert.match(reader, />Action Novels</);
  assert.match(reader, /Chapter 1/);
});
