import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { validateSite } from './check.mjs';

validateSite('dist');
const output = '_site';
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const sourceHtml = fs.readFileSync('dist/index.html', 'utf8');
const scriptNames = [...sourceHtml.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
const catalogNames = scriptNames.filter(n => n === 'catalog.js' || /^licensed-(?!ui\.js)/.test(n));
const context = vm.createContext({ window: {} });
for (const name of ['chapter-labels.js', ...catalogNames]) vm.runInContext(fs.readFileSync('dist/' + name, 'utf8'), context);
const novels = context.window.NOVELS;
const label = context.window.NovelNestChapterLabels.title;
for (const n of novels) for (const c of n.chapters) c.title = label(c.title);

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const write = (name, content) => { const full = path.join(output, name); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); };
function asset(name, content) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const filename = name.replace(/(\.[^.]+)$/, '.' + hash + '$1');
  write('assets/' + filename, content);
  return '/assets/' + filename;
}
// Source chunks stay in git for the updaters. Publish their content once, as
// real HTML pages, instead of duplicating every body in JS and HTML.
fs.cpSync('dist/assets', output + '/assets', { recursive: true });
for (const name of fs.readdirSync('dist')) {
  if (name.endsWith('.html') && name !== 'index.html' || ['CNAME', 'ads.txt', 'robots.txt', 'privacy-controls.js'].includes(name)) fs.copyFileSync('dist/' + name, output + '/' + name);
}
const compactCatalog = novels.map(({ chapters, ...n }) => ({ ...n, titles: chapters.map(c => c.title) }));
const catalogCode = 'window.NOVELS=' + json(compactCatalog) + '.map(({titles,...n})=>({...n,chapters:titles.map((title,i)=>({number:i+1,title,paragraphs:["Loading chapter…"],lazy:true}))}));';
const sourceHeader = sourceHtml.match(/<header\b[\s\S]*?<\/header>/)?.[0];
if (!sourceHeader) throw new Error('Missing shared site header');
const hydrateStatic = `
window.NOVELNEST_STATIC_READERS=true;
(() => {
  // Restore the shared controls before application scripts bind their events.
  // The lightweight HTML header still provides navigation without JavaScript.
  const header=document.querySelector('[data-static-header]');
  if(header)header.outerHTML=${json(sourceHeader)};
  const prose=document.querySelector('[data-static-chapter]');
  if(!prose)return;
  const novel=window.NOVELS.find(n=>n.id===prose.dataset.staticChapter);
  const number=Number(prose.dataset.chapterNumber);
  if(!novel?.chapters[number-1])return;
  const paragraphs=[...prose.querySelectorAll('p')].map(p=>p.textContent);
  if(paragraphs.length)Object.assign(novel.chapters[number-1],{paragraphs,lazy:false});
})();
`;
const runtimeNames = scriptNames.filter(n => !catalogNames.includes(n) && !/^https?:/.test(n));
const runtimeCode = catalogCode + '\n;' + hydrateStatic + '\n;' + runtimeNames.map(n => fs.readFileSync('dist/' + n, 'utf8')).join('\n;\n');
new vm.Script(runtimeCode);
const runtime = asset('runtime.js', runtimeCode);
const cssNames = [...sourceHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1].split('?')[0]);
const css = asset('site.css', cssNames.map(n => fs.readFileSync('dist/' + n, 'utf8')).join('\n'));
// Standalone policy pages still refer to these styles.
for (const name of fs.readdirSync('dist').filter(n => n.endsWith('.css'))) fs.copyFileSync('dist/' + name, output + '/' + name);

let shell = sourceHtml.replace(/<script\b[^>]*src="(?!https?:)[^"]+"[^>]*><\/script>/g, '').replace(/<link[^>]+rel="stylesheet"[^>]*>/g, '');
shell = shell.replace('</head>', `<link rel="stylesheet" href="${css}"><script defer src="${runtime}"></script></head>`);
let iconNumber = 0;
const symbols = [];
shell = shell.replace(/<svg([^>]*)>([\s\S]*?)<\/svg>/g, (_, attributes, shapes) => {
  const id = 'icon-' + (++iconNumber);
  symbols.push('<symbol id="' + id + '" viewBox="' + (attributes.match(/viewBox="([^"]+)"/)?.[1] || '0 0 28 28') + '">' + shapes + '</symbol>');
  return '<svg' + attributes + '><use href="/assets/site-icons.svg#' + id + '"></use></svg>';
});
write('assets/site-icons.svg', '<svg xmlns="http://www.w3.org/2000/svg">' + symbols.join('') + '</svg>');
const head = shell.slice(0, shell.indexOf('</head>') + 7);
const body = shell.slice(shell.indexOf('<body>'));
const mainMarker = '<main id="main" class="wrap" tabindex="-1"></main>';
if (!body.includes(mainMarker)) throw new Error('Missing main template');
const [beforeMain, afterMain] = body.split(mainMarker);
const favicon = sourceHtml.match(/<link rel="icon"[^>]+href="data:image\/svg\+xml,([^"]+)"/);
if (!favicon) throw new Error('Missing site favicon');
const faviconPath = asset('favicon.svg', decodeURIComponent(favicon[1]));
const publisher = sourceHtml.match(/<script async src="https:\/\/pagead2[^>]+><\/script>/)?.[0];
const verification = sourceHtml.match(/<meta name="google-site-verification"[^>]*>/)?.[0];
if (!publisher || !verification) throw new Error('Missing publisher verification');
// Chapters retain real, crawlable text, metadata, navigation and policy links.
// Share the interactive header once in the runtime instead of repeating it in
// every file. A compact static reading layout remains usable if JS is disabled.
const compactChapterFooter = afterMain.replace(/>\s+</g, '><').replace(/<\/a><a\b/g, '</a> <a').trim();
function chapterPage(title, url, markup) {
  return '<!doctype html><html lang=en><head><base href="/"><meta charset=UTF-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=theme-color content=#164f4a><title>' + escape(title) + ' — NovelNest</title><meta name=description content="Read ' + escape(title) + ' on NovelNest."><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="https://novelhaven.top' + escape(url) + '">' + verification + '<link rel=icon type=image/svg+xml href="' + faviconPath + '"><link rel=stylesheet href="' + css + '">' + publisher + '<script defer src="' + runtime + '"></script></head><body><a class=skip href="#main">Skip to content</a><header class=site-header data-static-header><nav class="topbar wrap"><a class="brand small" href="/">Novel<span>Nest</span>.</a><a href="/browse/">Browse novels</a></nav></header><main id=main class=wrap tabindex=-1>' + markup + '</main>' + compactChapterFooter;
}
function page(title, url, markup, description, robots = 'index,follow,max-image-preview:large', schema) {
  let h = head.replace(/<title>[\s\S]*?<\/title>/, '<title>' + escape(title) + ' — NovelNest</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escape(description || title) + '">')
    .replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="' + robots + '">')
    .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="https://novelhaven.top' + escape(url) + '">')
    .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + escape(title) + '">')
    .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + escape(description || title) + '">')
    .replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="https://novelhaven.top' + escape(url) + '">')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, schema ? '<script type="application/ld+json">' + json(schema) + '</script>' : '');
  return h + beforeMain + '<main id="main" class="wrap" tabindex="-1">' + markup.replaceAll('href="./#/', 'href="/') + '</main>' + afterMain;
}
// Render discovery/editorial routes with the same templates readers see.
const node = { textContent: '', innerHTML: '', classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, style: { setProperty() {} } };
const renderContext = vm.createContext({ window: { NOVELS: novels, NovelNestChapterLabels: context.window.NovelNestChapterLabels }, document: { querySelector: () => node, body: node, documentElement: node }, localStorage: { getItem: () => null, setItem() {} }, URLSearchParams, Date, console });
const app = fs.readFileSync('dist/app.js', 'utf8');
vm.runInContext(app.slice(0, app.indexOf("main.addEventListener('submit'")), renderContext);
const render = expression => vm.runInContext(expression, renderContext);
const links = [];
function addRoute(route, title, expression, robots) {
  const markup = render(expression);
  write(route === '/' ? 'index.html' : route.replace(/^\//, '') + '/index.html', page(title, route, markup, title + ' on NovelNest.', robots));
  if (!robots?.startsWith('noindex')) links.push(route);
}
addRoute('/', 'Find your next chapter', 'home()');
for (const [route, title, expression] of [
  ['/browse', 'Browse novels', 'browse(new URLSearchParams())'],
  ['/finder', 'Novel Finder', 'finderPage(new URLSearchParams())'],
  ['/latest-releases', 'Latest Release Novels', "directoryPage('releases')"],
  ['/latest-novels', 'Latest Novels', "directoryPage('novels')"],
  ['/completed', 'Completed Novels', "directoryPage('completed')"],
  ['/latest', 'Latest chapters', "'<h1>Latest chapters</h1>'+latestRows()"],
  ['/reading-desk', 'Reading Desk', 'readingDesk()']
]) addRoute(route, title, expression);
addRoute('/library', 'My library', 'library()', 'noindex,follow');
for (const genre of [...new Set(novels.flatMap(n => n.tags))]) addRoute('/genre/' + encodeURIComponent(genre), genre + ' novels', `genreDirectory(${json(genre)},new URLSearchParams())`);
const editorials = render('Object.keys(EDITORIALS)');
for (const id of editorials) addRoute('/editorial/' + id, render(`EDITORIALS[${json(id)}].title`), `editorial(${json(id)})`);
// Clean policy URLs serve the same current disclosure as their .html versions.
for (const id of ['about','privacy','privacy-choices','terms','contact','copyright','editorial-policy','content-licensing','advertising-disclosure']) {
  const text = fs.readFileSync('dist/' + id + '.html', 'utf8').replace('<head>', '<head><base href="/">');
  write(id + '/index.html', text);
}

const chapterMaps = [];
let chapterUrls = [], chapterCount = 0;
function flushChapterMap() {
  if (!chapterUrls.length) return;
  const name = 'sitemaps/chapters-' + (chapterMaps.length + 1) + '.xml';
  write(name, '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + chapterUrls.join('') + '</urlset>');
  chapterMaps.push('/' + name); chapterUrls = [];
}
for (const n of novels) {
  const root = '/novel/' + encodeURIComponent(n.id) + '/';
  const description = String(n.synopsis || n.title).replace(/\s+/g, ' ').slice(0, 158);
  const schema = { '@context': 'https://schema.org', '@type': 'Book', name: n.title, author: { '@type': 'Person', name: n.author }, url: 'https://novelhaven.top' + root };
  write(root.slice(1) + 'index.html', page(n.title, root, render(`detail(${json(n.id)})`), description, undefined, schema));
  links.push(root);
  const config = n.lazyChunks;
  for (let part = 1; part <= Math.ceil(n.chapters.length / config.capacity); part++) {
    const chunk = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync('dist/' + config.prefix + String(part).padStart(2, '0') + '.js', 'utf8'), chunk);
    for (let offset = 0; offset < chunk.window[config.global].length; offset++) {
      const raw = chunk.window[config.global][offset];
      const number = (part - 1) * config.capacity + offset + 1;
      const c = n.chapters[number - 1], url = root + 'chapter-' + number + '/';
      const nav = '<nav class="chapter-nav" aria-label="Chapter navigation">' + (number > 1 ? '<a class="button outline" href="' + root + 'chapter-' + (number - 1) + '/">Previous chapter</a>' : '') + '<a class="button outline" href="' + root + '">Chapters</a>' + (number < n.chapters.length ? '<a class="button" href="' + root + 'chapter-' + (number + 1) + '/">Next chapter</a>' : '') + '</nav>';
      const markup = '<article class="reader-wrap"><div class="reader-heading"><a href="' + root + '">' + escape(n.title) + '</a><h1>' + escape(c.title) + '</h1></div><div class="prose" data-static-chapter="' + escape(n.id) + '" data-chapter-number="' + number + '">' + raw.paragraphs.map(p => '<p>' + escape(p) + '</p>').join('') + '</div>' + nav + '</article>';
      write(url.slice(1) + 'index.html', chapterPage(n.title + ' — ' + c.title, url, markup));
      chapterUrls.push('<url><loc>https://novelhaven.top' + escape(url) + '</loc></url>');
      chapterCount++;
      if (chapterUrls.length === 40000) flushChapterMap();
    }
  }
}
flushChapterMap();
function chapterFallbackHtml() {
  // Unknown URLs remain real 404/noindex pages; no ad code on error pages.
  return page('Page not found', '/', render('missing()'), 'This page is not in the NovelNest catalog.', 'noindex,follow').replace(/<script[^>]+src="https:\/\/pagead2\.googlesyndication\.com[^>]*><\/script>/g, '').replace(/<link rel="canonical"[^>]*>/, '');
}
write('404.html', chapterFallbackHtml());
let catalogMap = fs.readFileSync('dist/sitemap.xml', 'utf8');
const existingUrls = new Set([...catalogMap.matchAll(/<loc>https:\/\/novelhaven\.top([^<]*)<\/loc>/g)].map(m => m[1]));
catalogMap = catalogMap.replace('</urlset>', links.filter(url => !existingUrls.has(url)).map(url => '<url><loc>https://novelhaven.top' + escape(url) + '</loc></url>').join('') + '</urlset>');
write('sitemaps/catalog.xml', catalogMap);
write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['/sitemaps/catalog.xml', ...chapterMaps].map(url => '<sitemap><loc>https://novelhaven.top' + url + '</loc></sitemap>').join('') + '</sitemapindex>');
write('.nojekyll', '');
let bytes = 0;
function measure(dir) { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, f.name); if (f.isDirectory()) measure(full); else bytes += fs.statSync(full).size; } }
measure(output);
const sizeBudget = 1000 * 1024 * 1024;
if (bytes > sizeBudget) throw new Error(`Built site is ${bytes} bytes, exceeding the ${sizeBudget}-byte GitHub Pages size budget. Move to hosting with more capacity before publishing more content.`);
if (bytes > sizeBudget * 0.9) console.warn('::warning::Published site is above 90% of its size budget. Plan additional hosting capacity as chapter imports grow.');
write('build-info.json', json({ novels: novels.length, chapters: chapterCount, catalogBytes: Buffer.byteLength(catalogCode), runtimeBytes: Buffer.byteLength(runtimeCode), siteBytes: bytes, generatedAt: new Date().toISOString() }));
console.log(`Built ${novels.length} novels, ${chapterCount} real chapter pages; catalog ${Buffer.byteLength(catalogCode)} bytes; site ${bytes} bytes.`);
