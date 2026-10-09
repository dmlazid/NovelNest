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
  for (const file of ['chapter-labels.js', 'catalog.js', ...licensed, 'app.js', 'lazy-chapters.js']) load(file);
  const flush = () => { let count = 0; while (timers.length) { assert(++count < 100, 'Unexpected render loop'); timers.shift()(); } };
  const go = next => { context.location.hash = next; window.dispatchEvent(new Event('hashchange')); flush(); };
  const complete = script => { const src = script.src.replace(/^\//, ''); const original = Object.entries(window.NOVELNEST_ASSETS || {}).find(([, value]) => value === src)?.[0] || src; load(original); script.onload(); flush(); };
  flush();
  return { context, window, scripts, run, flush, go, complete, node, storage, events };
}

test('all existing chapters and their catalog entries validate', () => {
  const result = validateSite();
  const h = harness();
  assert.equal(result.novels, h.window.NOVELS.length);
  assert.equal(result.chapters, h.window.NOVELS.reduce((total, novel) => total + novel.chapters.length, 0));
});

test('homepage promotes actual AkkNovel books, with other libraries still accessible', () => {
  const h = harness();
  const html = h.node('#main').innerHTML;
  assert.match(html, /AkkNovel Spotlight/);
  assert.match(html, /href="\.\/#\/akk-novels"/);
  assert.match(html, /More From AkkNovel/);
  assert.match(html, /Latest Release Novels/);
  const featured = [...html.matchAll(/class="home-top-feature" href="\/novel\/([^/]+)\/"/g)]
    .map(match => decodeURIComponent(match[1]));
  assert.equal(featured.length, 4, 'Four featured books remain visible');
  assert.equal(new Set(featured).size, 4, 'Features are unique');
  for (const id of featured) {
    const book = h.window.NOVELS.find(n => n.id === id);
    assert.equal(book?.source, 'AkkNovel', 'Featured book must come from AkkNovel');
    assert(book.chapters.length > 0);
  }
  h.go('#/akk-novels');
  const directory = h.node('#main').innerHTML;
  assert.match(directory, /AkkNovel Collection/);
  const ids = [...directory.matchAll(/class="directory-novel-row" href="\/novel\/([^/]+)\/"/g)]
    .map(match => decodeURIComponent(match[1]));
  assert(ids.length >= 7, 'AkkNovel browse page must contain its series');
  for (const id of ids) assert.equal(h.window.NOVELS.find(n => n.id === id)?.source, 'AkkNovel');
  h.go('#/browse');
  assert.match(h.node('#main').innerHTML, /Astral Pet Store/, 'Other novels stay browseable');
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
  const gallery = h.window.NOVELS.find(n => n.id === 'got-a-gallery-in-the-wild');
  assert(gallery);
  h.go(`#/read/got-a-gallery-in-the-wild/${gallery.chapters.length + 1}`);
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
  assert.equal(h.scripts[0].src, '/' + versioned);
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

test('chapter links use clean path URLs and direct clean links have a GitHub Pages fallback', () => {
  const app = fs.readFileSync('dist/app.js', 'utf8');
  const ui = fs.readFileSync('dist/licensed-ui.js', 'utf8');
  const build = fs.readFileSync('scripts/build.mjs', 'utf8');
  assert.match(app, /chapterUrl=.*chapter-/);
  assert.match(ui, /readerHref.*chapter-/);
  assert.match(build, /chapterFallbackHtml/);
  assert.match(build, /404\.html/);
  const h = harness();
  h.go('#/novel/got-a-gallery-in-the-wild');
  assert.match(h.node('#main').innerHTML, /\/novel\/got-a-gallery-in-the-wild\/chapter-1\//);
});

test('internal anchors use explicit same-site routes for precise mobile new-tab opening', () => {
  for (const file of ['dist/index.html', 'dist/app.js', 'dist/accounts.js', 'dist/licensed-ui.js']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /href=["']#\//, file + ' still contains a fragment-only internal href');
  }
  const index = fs.readFileSync('dist/index.html', 'utf8');
  assert.match(index, /class="compact-header-brand" href="\//);
  assert.match(index, /src="clean-routes\.js(?:\?v=[^"]*)?"/);
  const cleanRoutes = fs.readFileSync('dist/clean-routes.js', 'utf8');
  assert.match(cleanRoutes, /legacyHashToClean/);
  assert.match(cleanRoutes, /renderGenericRoute/);
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
    ['#/about', /About NovelHaven/],
    ['#/privacy', /Privacy Policy/],
    ['#/terms', /Terms of Use/],
    ['#/contact', /Contact NovelHaven/],
    ['#/copyright', /Copyright &amp; Takedown Requests/],
    ['#/reading-desk', /NovelHaven Reading Desk/],
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
  assert.match(html, /NovelHaven tip/);

  h.go('#/');
  html = h.node('#main').innerHTML;
  assert.match(html, /NovelHaven Reading Desk/);
  assert.match(html, /Original NovelHaven guide/);
});

test('footer exposes crawlable trust and policy navigation', () => {
  const index = fs.readFileSync('dist/index.html', 'utf8');
  for (const file of ['reading-desk.html','about.html','privacy.html','privacy-choices.html','terms.html','contact.html','copyright.html','editorial-policy.html','content-licensing.html','advertising-disclosure.html']) {
    assert(index.includes('href="/' + file + '"'));
    assert(fs.existsSync('dist/' + file));
  }
});

test('standalone trust and editorial pages have canonical metadata and appear in sitemap', () => {
  const files = [
    'about.html','privacy.html','privacy-choices.html','terms.html','contact.html','copyright.html',
    'reading-desk.html','editorial-policy.html','content-licensing.html','advertising-disclosure.html',
    'guide-long-web-novel.html','guide-ongoing-vs-completed.html','guide-genres.html',
    'guide-pacing.html','guide-progression-fantasy.html','guide-reading-list.html','guide-returning-to-a-novel.html'
  ];
  const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
  for (const file of files) {
    const html = fs.readFileSync('dist/' + file, 'utf8');
    assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
    assert(html.includes('<link rel="canonical" href="https://novelhaven.top/' + file + '">'));
    assert.match(html, /application\/ld\+json/);
    assert(sitemap.includes('https://novelhaven.top/' + file));
  }
  const index = fs.readFileSync('dist/index.html', 'utf8');
  assert(index.includes('rel="canonical" href="https://novelhaven.top/"'));
  assert.match(index, /application\/ld\+json/);
});

test('expanded Reading Desk links all original guides and trust pages', () => {
  const desk = fs.readFileSync('dist/reading-desk.html', 'utf8');
  for (const file of [
    'guide-long-web-novel.html','guide-ongoing-vs-completed.html','guide-genres.html',
    'guide-pacing.html','guide-progression-fantasy.html','guide-reading-list.html','guide-returning-to-a-novel.html'
  ]) assert(desk.includes('href="' + file + '"'));
  for (const file of ['editorial-policy.html','content-licensing.html','advertising-disclosure.html']) {
    assert(fs.existsSync('dist/' + file));
    const html = fs.readFileSync('dist/' + file, 'utf8');
    assert.match(html, /NovelHaven/);
    assert.match(html, /rel="canonical"/);
  }
});

test('real AdSense verification is installed with matching publisher ID and ads.txt', () => {
  const index = fs.readFileSync('dist/index.html', 'utf8');
  assert.match(index, /pagead2\.googlesyndication\.com/);
  assert.match(index, /ca-pub-9356195452195758/);
  assert(fs.existsSync('dist/ads.txt'));
  const ads = fs.readFileSync('dist/ads.txt', 'utf8');
  assert.equal(ads.trim(), 'google.com, pub-9356195452195758, DIRECT, f08c47fec0942fa0');
});

test('privacy choices page explains current ad status and can clear local reading data', () => {
  const html = fs.readFileSync('dist/privacy-choices.html', 'utf8');
  const js = fs.readFileSync('dist/privacy-controls.js', 'utf8');
  const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
  assert.match(html, /AdSense publisher code is installed/);
  assert.match(html, /Google-certified consent management solution/);
  assert.match(html, /data-clear-novelnest/);
  assert.match(js, /startsWith\('novelnest\.'\)/);
  assert(sitemap.includes('privacy-choices.html'));
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
  assert.match(html, /How to request review or removal/);
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
