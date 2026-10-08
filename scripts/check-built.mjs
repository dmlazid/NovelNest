import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = '_site';
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const home = read('index.html');
const source = fs.readFileSync('dist/index.html','utf8');
const publisher = /<script async src="https:\/\/pagead2[^>]+><\/script>/;
assert.equal(home.match(publisher)?.[0], source.match(publisher)?.[0], 'AdSense verification code changed');
assert.equal(read('ads.txt'), fs.readFileSync('dist/ads.txt','utf8'));
assert.deepEqual([...home.matchAll(/<meta name="google-site-verification"[^>]*>/g)].map(m=>m[0]), [...source.matchAll(/<meta name="google-site-verification"[^>]*>/g)].map(m=>m[0]));
const scriptPaths=[...home.matchAll(/<script[^>]+src="(\/[^"]+)"/g)].map(m=>m[1]);
assert.equal(scriptPaths.length,1,'Catalog and application should load in one bundled request');
const packed = read(scriptPaths[0]);
const catalogCode = packed.slice(0,packed.indexOf('\n;'));
const context=vm.createContext({window:{}});vm.runInContext(catalogCode,context);
const novels=context.window.NOVELS;
let expected=0;
for(const n of novels){
 const prefix='novel/'+encodeURIComponent(n.id)+'/';
 const files=fs.readdirSync(path.join(root,prefix)).filter(f=>f.startsWith('chapter-'));
 assert.equal(files.length,n.chapters.length,n.id+' lost chapter pages');expected+=files.length;
 const samples=[1,Math.ceil(n.chapters.length/2),n.chapters.length];
 for(const number of samples){
  const url='/'+prefix+'chapter-'+number+'/';const text=read(url+'index.html');
  assert(text.includes('href="https://novelhaven.top'+url+'"'),'Wrong canonical');
  assert.match(text,/<meta name="robots" content="index,follow/);
  assert(text.includes('data-static-chapter="'+n.id+'"'),'Wrong chapter content');
  assert(text.includes('data-chapter-number="'+number+'"'),'Wrong reading position');
  assert.doesNotMatch(text,/Loading chapter…/);
  assert.equal(text.match(publisher)?.[0],source.match(publisher)?.[0]);
 }
}
for(const url of ['latest-releases','latest-novels','completed','browse','finder','reading-desk','library']) assert(fs.existsSync(path.join(root,url,'index.html')));
for(const name of ['privacy.html','privacy-choices.html','content-licensing.html','copyright.html','privacy-controls.js']) assert.equal(read(name),fs.readFileSync('dist/'+name,'utf8'),'Policy changed unexpectedly');
for(const [,url] of home.matchAll(/(?:src|href)="(\/[^"#?]*)[^\"]*"/g)) {
 const full=path.join(root,decodeURIComponent(url));
 assert(fs.existsSync(full)||fs.existsSync(full+'.html'),'Missing homepage link/asset '+url);
}
assert.match(read('sitemap.xml'),/<sitemapindex/);
assert.match(read('404.html'),/noindex,follow/);
assert.doesNotMatch(read('404.html'),/pagead2\.googlesyndication/);
assert(!fs.existsSync(path.join(root,'data'))),'Duplicated chapter payload';
console.log(`Verified ${novels.length} novels, ${expected} chapter pages, public routes, bundled assets, sitemaps, and unchanged AdSense/trust files.`);
