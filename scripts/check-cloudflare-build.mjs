import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root='_cloudflare',read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=fs.readFileSync('dist/index.html','utf8'),publisher=source.match(/<script async src="https:\/\/pagead2[^>]+><\/script>/)[0];
const template=read('_internal/chapter.html');assert(template.includes(publisher));assert(read('index.html').includes(publisher));
for(const name of ['ads.txt','privacy.html','privacy-choices.html','terms.html','copyright.html','content-licensing.html','advertising-disclosure.html'])assert.equal(read(name),fs.readFileSync('dist/'+name,'utf8'));
assert(template.includes('CHAPTER_BODY_TOKEN'));assert(template.includes('CHAPTER_URL_TOKEN'));
const meta=JSON.parse(read('_internal/novels.json')),info=JSON.parse(read('build-info.json'));
assert.equal(Object.keys(meta).length,info.novels);assert.equal(Object.values(meta).reduce((s,n)=>s+n.total,0),info.chapters);
let urls=0;for(const f of fs.readdirSync(root+'/sitemaps').filter(x=>x.startsWith('chapters-')))urls+=(read('sitemaps/'+f).match(/<url>/g)||[]).length;
const indexable=Object.values(meta).filter(n=>!n.discoveryHidden).reduce((s,n)=>s+n.total-(n.duplicateChapters?.length||0),0);
assert.equal(urls,indexable,'Only reviewed chapter URLs should be in chapter sitemaps');
assert(Object.values(meta).some(n=>(n.duplicateChapters||[]).length),'Actual repeated chapter text must be flagged for review');
const hidden=Object.entries(meta).filter(([id,n])=>n.discoveryHidden);
assert.equal(hidden.length,11,'Reader-safe curation excludes the ten long imports and the explicit-content review title');
const catalogSitemap=read('sitemaps/catalog.xml');
for(const [id] of hidden){
  assert(!catalogSitemap.includes('/novel/'+id+'/'),'Curated book must be absent from discovery sitemap');
  assert.match(read('novel/'+id+'/index.html'),/meta name="robots" content="noindex,follow"/);
  assert(!read('novel/'+id+'/index.html').includes(publisher),'Hidden detail must not load the AdSense publisher script');
  assert(read('novel/'+id+'/index.html').includes('href="/novel/'+id+'/chapter-1/"'), 'Curated novel must remain readable');
}
let count=0;function walk(p){for(const x of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,x.name);if(x.isDirectory())walk(f);else{count++;assert(fs.statSync(f).size<=25*1024*1024,'Asset too large');}}}walk(root);assert(count<=20000,'Free static asset count exceeded');
assert.doesNotMatch(read('404.html'),/pagead2/);
assert(!read('library/index.html').includes(publisher),'Private library must not load AdSense');console.log('Verified Cloudflare assets:',JSON.stringify({files:count,novels:info.novels,chapters:info.chapters,bytes:info.siteBytes,publisher:'unchanged',cutover:'not enabled'}));
