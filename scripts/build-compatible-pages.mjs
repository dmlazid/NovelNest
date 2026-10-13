// Safe interim Cloudflare Pages build: prerender discoverable pages while keeping
// the existing JS chapter reader and all data/chapter chunks intact.
// Not a D1 cutover. Does not touch ads.txt, publisher ID, bookmarks or accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const root='dist';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const write=(p,value)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
const source=read('index.html');
const marker='<main id="main" class="wrap" tabindex="-1"></main>';
assert(source.includes(marker),'Original interactive reader shell changed: refuse publishing');
assert(source.includes('google-site-verification'),'Keep existing Google verification');
const scriptPaths=[...source.matchAll(/<script\b[^>]*src="([^"]+)"/g)]
  .map(match=>match[1].split('?')[0]);
const catalogPaths=scriptPaths.filter(p=>p==='catalog.js'||p==='source-activity.js'||/^licensed-(?!ui\.js)/.test(p));
const ctx=vm.createContext({window:{}});
for(const p of ['chapter-labels.js',...catalogPaths,'discovery-curation.js','removed-duplicates.js']){
  assert(fs.existsSync(path.join(root,p)),'Missing original catalog script '+p);
  vm.runInContext(read(p),ctx,{filename:p,timeout:2000});
}
const novels=ctx.window.NOVELS;
assert(Array.isArray(novels)&&novels.length>0,'No published novels');
const chapterTitle=ctx.window.NovelNestChapterLabels.title;
for(const book of novels)for(const chapter of book.chapters)chapter.title=chapterTitle(chapter.title);
const el={innerHTML:'',textContent:'',classList:{toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){},style:{setProperty(){}}};
const renderCtx=vm.createContext({window:{NOVELS:novels,NovelNestChapterLabels:ctx.window.NovelNestChapterLabels},
  document:{querySelector:()=>el,body:el,documentElement:el},
  localStorage:{getItem:()=>null,setItem(){}},URLSearchParams,Date,console});
const app=read('app.js'),prefix=app.indexOf("main.addEventListener('submit'");
assert(prefix>0,'Unexpected app structure; refuse compatibility build');
vm.runInContext(app.slice(0,prefix),renderCtx,{filename:'app.js',timeout:5000});
const render=expression=>vm.runInContext(expression,renderCtx,{timeout:8000});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=o=>JSON.stringify(o).replace(/</g,'\\u003c');
const currentMap=read('sitemap.xml');
assert(/<urlset\b/.test(currentMap),'The original static sitemap has changed; refuse overwriting it');
const known=new Set([...currentMap.matchAll(/<loc>https:\/\/novelhaven\.top([^<]*)<\/loc>/g)].map(m=>m[1]));
const routeLinks=[];
function add(route,title,content,description,robots='index,follow,max-image-preview:large',schema=null){
  assert(/^\/[a-zA-Z0-9\/%.-]*\/$/.test(route),'Unsafe route: '+route);
  let html=source
    .replace(/<title>[\s\S]*?<\/title>/,'<title>'+escape(title)+' — NovelHaven</title>')
    .replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="'+escape(description||title)+'">')
    .replace(/<meta name="robots" content="[^"]*">/,'<meta name="robots" content="'+robots+'">')
    .replace(/<link rel="canonical" href="[^"]*">/,'<link rel="canonical" href="https://novelhaven.top'+escape(route)+'">')
    .replace(/<meta property="og:title" content="[^"]*">/,'<meta property="og:title" content="'+escape(title)+' — NovelHaven">')
    .replace(/<meta property="og:description" content="[^"]*">/,'<meta property="og:description" content="'+escape(description||title)+'">')
    .replace(/<meta property="og:url" content="[^"]*">/,'<meta property="og:url" content="https://novelhaven.top'+escape(route)+'">')
    .replace(marker,'<main id="main" class="wrap" tabindex="-1">'+content.replaceAll('href="./#/','href="/')+'</main>');
  if(schema) html=html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    '<script type="application/ld+json">'+json(schema)+'</script>');
  if(robots.startsWith('noindex'))html=html.replace(/<script async src="https:\/\/pagead2\.googlesyndication\.com[^>]*><\/script>/g,'');
  write(route.slice(1)+'index.html',html);
  if(!robots.startsWith('noindex')&&!known.has(route))routeLinks.push(route);
}
for(const novel of novels){
  const route='/novel/'+encodeURIComponent(novel.id)+'/';
  const description=String(novel.synopsis||novel.title).replace(/\s+/g,' ').slice(0,155);
  const schema={'@context':'https://schema.org','@type':'Book',name:novel.title,
    author:{'@type':'Person',name:novel.author||'Unknown'},url:'https://novelhaven.top'+route};
  add(route,novel.title,render('detail('+JSON.stringify(novel.id)+')'),
    description,novel.discoveryHidden?'noindex,follow':'index,follow,max-image-preview:large',schema);
}
for(const [route,title,expression] of [
  ['/browse/','Browse novels','browse(new URLSearchParams())'],
  ['/latest-releases/','Latest Release Novels',"directoryPage('releases')"],
  ['/latest-novels/','Latest Novels',"directoryPage('novels')"],
  ['/completed/','Completed Novels',"directoryPage('completed')"],
  ['/reading-desk/','Reading Desk','readingDesk()'],
  ['/finder/','Novel Finder','finderPage(new URLSearchParams())']
]) add(route,title,render(expression),title+' on NovelHaven.');
add('/library/','My library',render('library()'),'Your saved NovelHaven bookmarks.','noindex,follow');
for(const genre of new Set(novels.filter(n=>!n.discoveryHidden).flatMap(n=>n.tags||[]))){
  add('/genre/'+encodeURIComponent(genre)+'/',genre+' novels',
    render('genreDirectory('+JSON.stringify(genre)+',new URLSearchParams())'),
    'Find '+genre+' stories in NovelHaven.');
}
const editorials=render('Object.keys(EDITORIALS)');
for(const id of editorials){
  add('/editorial/'+id+'/',render('EDITORIALS['+JSON.stringify(id)+'].title'),
    render('editorial('+JSON.stringify(id)+')'),
    'Original reading guidance on NovelHaven.');
}
// Do not advertise chapter URLs that return the existing SPA rather than real
// server-rendered prose. D1-backed chapter sitemaps are strictly post-audit.
const urls=[...known,...routeLinks].map(url=>'<url><loc>https://novelhaven.top'+escape(url)+'</loc></url>').join('');
write('sitemaps/catalog.xml','<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls+'</urlset>');
write('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://novelhaven.top/sitemaps/catalog.xml</loc></sitemap></sitemapindex>');
write('build-info.json',JSON.stringify({mode:'compatible-spa-with-static-details',novels:novels.length,
  chapters:novels.reduce((s,n)=>s+n.chapters.length,0),serverRenderedChapters:false,
  catalogRoutes:known.size+routeLinks.length,
  generatedAt:new Date().toISOString()},null,2)+'\n');
// While chapter prose is still delivered by the existing interactive SPA,
// block crawlers from treating the generic app shell as an indexed chapter.
// This one pattern applies only to chapter URLs and must be removed once the
// audited D1 HTML reader is fully live.
const currentHeaders=read('_headers');
const temporaryHeader='\n# SPA chapter fallback: prevent indexing until real server-side chapters are available.\n/novel/:novel/chapter-*\n  X-Robots-Tag: noindex, follow\n';
assert(!currentHeaders.includes('/novel/:novel/chapter-*'),'Do not repeat temporary noindex rule');
write('_headers',currentHeaders+temporaryHeader);

// Readers must still be able to open every chapter, but AdSense must not be
// requested from visibly restricted novels or exact duplicate chapters.
// A Cloudflare Pages 200 rewrite keeps the requested URL and the working SPA
// route while serving a publisher-free, noindex copy of the original shell.
const restricted=source
  .replace(/<meta name="robots" content="[^"]*">/,'<meta name="robots" content="noindex,follow">')
  .replace(/<link rel="canonical" href="[^"]*">/,'')
  .replace(/<script async src="https:\/\/pagead2\.googlesyndication\.com[^>]*><\/script>/g,'');
assert(!restricted.includes('pagead2.googlesyndication.com'),'Restricted reader must not load AdSense');
assert(restricted.includes('app.js?'),'Restricted reader must retain the original SPA');
write('restricted-reader.html',restricted);
const noads=new Set();
for(const book of novels.filter(n=>n.discoveryHidden)) {
  noads.add('/novel/'+encodeURIComponent(book.id)+'/chapter-:number/ /restricted-reader.html 200');
}
const reviewed=JSON.parse(fs.readFileSync('scripts/known-chapter-duplicates.json','utf8'));
for(const item of reviewed.known){
  if(novels.some(n=>n.id===item.novel_id&&!n.discoveryHidden)){
    noads.add('/novel/'+encodeURIComponent(item.novel_id)+'/chapter-'+item.repeated_chapter+'/ /restricted-reader.html 200');
  }
}
assert(noads.size>=11,'Missing restricted novels');
write('_redirects','# AdSense-free fallback for the restricted reading routes only.\n'+
  [...noads].join('\n')+'\n');
console.log('Kept '+noads.size+' restricted-reader rewrite rules; all original chapter files remain unchanged.');

// Keep the original index, chapter JavaScript chunks, auth, and licensed imports.
assert.equal(read('index.html'),source,'Original site shell unexpectedly changed');
console.log('Compatible Pages output ready: '+novels.length+' novel details, '+editorials.length+
  ' original editorial pages; reader JavaScript and ads.txt unchanged.');
