import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { validateSite } from './check.mjs';

validateSite('dist');
const output = '_site';
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync('dist', output, { recursive: true });
const assets = {};
function fingerprint(directory = '') {
  for (const entry of fs.readdirSync(path.join('dist', directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) { fingerprint(name); continue; }
    if (!/\.(?:js|css)$/.test(name)) continue;
    const bytes = fs.readFileSync(path.join('dist', name));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const versioned = name.replace(/(\.[^.]+)$/, `.${hash}$1`);
    fs.writeFileSync(path.join(output, versioned), bytes);
    assets[name] = versioned;
  }
}
fingerprint();
let html = fs.readFileSync('dist/index.html', 'utf8');
html = html.replace(/\b(src|href)="([^"]+)"/g, (match, attr, value) => {
  const versioned = assets[value.split('?')[0]];
  return versioned ? `${attr}="${versioned}"` : match;
});
const manifest = `<script>window.NOVELNEST_ASSETS=${JSON.stringify(assets)};</script>`;
html = html.replace(/<script\b/, `${manifest}<script`);
fs.writeFileSync(path.join(output, 'index.html'), html);

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}
function loadNovelCatalog() {
  const sourceHtml = fs.readFileSync(path.join('dist', 'index.html'), 'utf8');
  const scripts = [...sourceHtml.matchAll(/<script\b[^>]*src="([^"]+)"/g)]
    .map(match => match[1].split('?')[0])
    .filter(name => name === 'catalog.js' || /^licensed-(?!ui\.js)/.test(name));
  const context = vm.createContext({ window: {} });
  for (const name of scripts) {
    vm.runInContext(fs.readFileSync(path.join('dist', name), 'utf8'), context, { filename: name, timeout: 1000 });
  }
  return Array.isArray(context.window.NOVELS) ? context.window.NOVELS : [];
}
function staticNovelMarkup(novel) {
  const id = encodeURIComponent(novel.id);
  const tags = (novel.tags || []).map(htmlEscape).join(' / ');
  const synopsis = htmlEscape(novel.synopsis || '');
  const cover = '/' + String(novel.cover || '').replace(/^\/+/, '');
  const chapters = Array.isArray(novel.chapters) ? novel.chapters : [];
  let preview = chapters;
  if (chapters.length > 200) preview = [...chapters.slice(0, 100), ...chapters.slice(-100)];
  const omitted = chapters.length - preview.length;
  const chapterLinks = preview.map(chapter => {
    const number = Number(chapter.number) || 1;
    return '<a href="/novel/' + id + '/chapter-' + number + '/"><span>' +
      String(number).padStart(2, '0') + '</span>' + htmlEscape(chapter.title || ('Chapter ' + number)) + '</a>';
  }).join('');
  const action = novel.externalUrl
    ? '<a class="button" href="' + htmlEscape(novel.externalUrl) + '" target="_blank" rel="noopener noreferrer">Read on ' + htmlEscape(novel.externalSource || 'source') + '</a>'
    : '<a class="button" href="/novel/' + id + '/chapter-1/">Start reading</a>';
  return '<nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">' +
    htmlEscape(novel.title) + '</span></nav>' +
    '<article class="detail"><img class="cover" src="' + cover + '" alt="' + htmlEscape(novel.title) + ' cover" width="200" height="300">' +
    '<div class="book-info"><span class="eyebrow">' + tags + '</span><h1>' + htmlEscape(novel.title) + '</h1>' +
    '<p class="muted">by ' + htmlEscape(novel.author || 'Unknown') + '</p><span class="status-pill">' + htmlEscape(novel.status || 'Ongoing') + '</span>' +
    '<p class="meta">' + chapters.length + ' chapters · English</p></div>' +
    '<div class="description" style="grid-column:1/-1"><h2>About the story</h2><p>' + synopsis + '</p></div>' +
    '<div class="actions" style="grid-column:1/-1">' + action + '</div></article>' +
    (novel.externalUrl ? '' :
      '<section><div class="section-head"><h2>Chapters <span class="muted">(' + chapters.length + ')</span></h2>' +
      '<span class="meta">' + (novel.status === 'Completed' ? 'Complete story' : 'Ongoing · More chapters to come') + '</span></div>' +
      (omitted > 0 ? '<p class="meta">Showing the first 100 and latest 100 chapters. Open the reader for the complete chapter list.</p>' : '') +
      '<div class="toc">' + chapterLinks + '</div></section>');
}
function novelPageHtml(baseHtml, novel) {
  const id = encodeURIComponent(novel.id);
  const canonical = 'https://novelhaven.top/novel/' + id + '/';
  const descriptionRaw = String(novel.synopsis || (novel.title + ' on NovelNest')).replace(/\s+/g, ' ').trim();
  const description = descriptionRaw.length > 158 ? descriptionRaw.slice(0, 155).replace(/\s+\S*$/, '') + '…' : descriptionRaw;
  const title = novel.title + ' — NovelNest';
  const imageUrl = 'https://novelhaven.top/' + String(novel.cover || '').replace(/^\/+/, '');
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: novel.title,
    url: canonical,
    description: descriptionRaw,
    image: imageUrl,
    inLanguage: 'en',
    author: { '@type': 'Person', name: novel.author || 'Unknown' },
    genre: novel.tags || [novel.genre].filter(Boolean),
    mainEntityOfPage: canonical
  };
  let page = baseHtml;
  page = page.replace('<head>', '<head><base href="/">');
  page = page.replace(/<title>[\s\S]*?<\/title>/, '<title>' + htmlEscape(title) + '</title>');
  page = page.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + htmlEscape(description) + '">');
  page = page.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + canonical + '">');
  page = page.replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="book">');
  page = page.replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + htmlEscape(novel.title) + '">');
  page = page.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + htmlEscape(description) + '">');
  page = page.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + canonical + '">');
  if (!page.includes('<meta property="og:image"')) {
    page = page.replace('</head>', '<meta property="og:image" content="' + imageUrl + '"></head>');
  }
  const jsonLd = JSON.stringify(schema).replace(/</g, '\\u003c');
  page = page.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<script type="application/ld+json">' + jsonLd + '</script>');
  page = page.replace(/<main id="main" class="wrap" tabindex="-1"><\/main>/, '<main id="main" class="wrap" tabindex="-1">' + staticNovelMarkup(novel) + '</main>');
  return page;
}
function chapterPageHtml(baseHtml, novel, chapter) {
  const id = encodeURIComponent(novel.id);
  const number = Number(chapter.number) || 1;
  const canonical = 'https://novelhaven.top/novel/' + id + '/chapter-' + number + '/';
  const chapterTitle = String(chapter.title || ('Chapter ' + number)).trim();
  const title = novel.title + ' — ' + chapterTitle + ' — NovelNest';
  const description = ('Read ' + chapterTitle + ' of ' + novel.title + ' on NovelNest.').slice(0, 158);
  const imageUrl = 'https://novelhaven.top/' + String(novel.cover || '').replace(/^\/+/, '');
  let page = baseHtml;
  page = page.replace('<head>', '<head><base href="/">');
  page = page.replace(/<title>[\s\S]*?<\/title>/, '<title>' + htmlEscape(title) + '</title>');
  page = page.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + htmlEscape(description) + '">');
  page = page.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="index,follow">');
  page = page.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + canonical + '">');
  page = page.replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="article">');
  page = page.replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + htmlEscape(title) + '">');
  page = page.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + htmlEscape(description) + '">');
  page = page.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + canonical + '">');
  if (!page.includes('<meta property="og:image"')) page = page.replace('</head>', '<meta property="og:image" content="' + imageUrl + '"></head>');
  return page;
}
function chapterFallbackHtml(baseHtml) {
  let page = baseHtml;
  page = page.replace('<head>', '<head><base href="/">');
  page = page.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex,follow">');
  page = page.replace(/<link rel="canonical" href="[^"]*">/, '');
  return page;
}
const seoNovels = loadNovelCatalog();
for (const novel of seoNovels) {
  if (!novel?.id || !novel?.title) continue;
  const directory = path.join(output, 'novel', encodeURIComponent(novel.id));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), novelPageHtml(html, novel));
  if (!novel.externalUrl && Array.isArray(novel.chapters)) {
    for (const chapter of novel.chapters) {
      const number = Number(chapter.number) || 1;
      const chapterDirectory = path.join(directory, 'chapter-' + number);
      fs.mkdirSync(chapterDirectory, { recursive: true });
      fs.writeFileSync(path.join(chapterDirectory, 'index.html'), chapterPageHtml(html, novel, chapter));
    }
  }
}
fs.writeFileSync(path.join(output, '404.html'), chapterFallbackHtml(html));
let sitemap = fs.readFileSync(path.join('dist', 'sitemap.xml'), 'utf8');
const novelUrls = seoNovels
  .filter(novel => novel?.id)
  .map(novel => '  <url>\n    <loc>https://novelhaven.top/novel/' + xmlEscape(encodeURIComponent(novel.id)) + '/</loc>\n    <lastmod>' + xmlEscape(novel.updated || new Date().toISOString().slice(0, 10)) + '</lastmod>\n  </url>')
  .join('\n');
const chapterUrls = seoNovels
  .filter(novel => novel?.id && !novel.externalUrl && Array.isArray(novel.chapters))
  .flatMap(novel => novel.chapters.map(chapter => {
    const number = Number(chapter.number) || 1;
    return '  <url>\n    <loc>https://novelhaven.top/novel/' + xmlEscape(encodeURIComponent(novel.id)) + '/chapter-' + number + '/</loc>\n    <lastmod>' + xmlEscape(novel.updated || new Date().toISOString().slice(0, 10)) + '</lastmod>\n  </url>';
  }))
  .join('\n');
sitemap = sitemap.replace(/\s*<\/urlset>\s*$/, '\n' + novelUrls + '\n' + chapterUrls + '\n</urlset>\n');
fs.writeFileSync(path.join(output, 'sitemap.xml'), sitemap);
console.log('Generated ' + seoNovels.length + ' crawlable novel pages, clean chapter pages, and sitemap entries.');

fs.writeFileSync(path.join(output, '.nojekyll'), '');
for (const file of Object.values(assets)) {
  if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing versioned asset: ${file}`);
}
console.log(`Built ${output}/ with ${Object.keys(assets).length} versioned assets.`);
