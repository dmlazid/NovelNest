import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync('dist/'+p,'utf8');
const publisher=read('index.html').match(/<script async src="https:\/\/pagead2[^>]+><\/script>/)?.[0];
assert(publisher,'Existing AdSense verification must remain on the main site');
const build=JSON.parse(read('build-info.json'));
assert.equal(build.mode,'compatible-spa-with-static-details');
assert.equal(build.serverRenderedChapters,false,'Never misrepresent SPA fallback chapters as prerendered');
assert(build.novels>70&&build.chapters>100000);
const catalog=read('sitemaps/catalog.xml');
const sitemap=read('sitemap.xml');
assert.match(catalog,/<urlset\b/);
assert.match(sitemap,/<sitemapindex\b/);
assert(!catalog.includes('/chapter-'),'SPA fallback chapter URLs must not be submitted for indexing');
const sample=read('novel/shadow-slave/index.html');
assert.match(sample,/<meta name="description"/);
assert.match(sample,/https:\/\/novelhaven\.top\/novel\/shadow-slave\//);
assert(sample.includes(publisher),'Noncurated pages retain publisher setup');
assert(sample.includes('app.js?'),'Interactive SPA must remain loaded');
assert(sample.includes('app.js?v=20261014-source-accurate-latest-1'),
  'Latest Novels must load the updated reader/discovery script');
assert(sample.includes('source-activity.js?v=20261014-fresh-source-feed-1'),
  'Source activity must bypass the previously cached static URL');
assert.match(read('_headers'),/\/source-activity\.js\s+Cache-Control: public, max-age=60, must-revalidate/,
  'Source activity reports must not remain cached for four hours');
assert(sample.includes('removed-duplicates.js'),'Deleted chapter map must load before the reader');
assert.equal(build.removedChapterBodies,9,'All nine chapter bodies should be deleted');
const rich=read('novel/my-rich-wife/index.html');
assert(!rich.includes('href="/novel/my-rich-wife/chapter-752/"'),'Removed chapter must not appear in the public table of contents');
assert(!rich.includes('href="/novel/my-rich-wife/chapter-872/"'),'Second removed chapter must not appear in the public table of contents');
assert(rich.includes('href="/novel/my-rich-wife/chapter-753/"'),'Neighboring chapter numbers must be stable');
assert(sample.includes('<main id="main" class="wrap" tabindex="-1">'),'Detail page contains real HTML');
const restricted=read('novel/supreme-harem-god-system/index.html');
assert.match(restricted,/<meta name="robots" content="noindex,follow"/);
assert(!restricted.includes(publisher),'Restricted detail must not include ads script');
const library=read('library/index.html');
assert.match(library,/name="robots" content="noindex,follow"/);
assert(!library.includes(publisher));
const noads=read('restricted-reader.html');
assert.match(noads,/name="robots" content="noindex,follow"/);
assert.doesNotMatch(noads,/pagead2\.googlesyndication\.com/);
assert(noads.includes('app.js?'),'Restricted chapters must keep the working SPA');
const rewrites=read('_redirects');
assert(rewrites.includes('/novel/supreme-harem-god-system/chapter-:number/ /restricted-reader.html 200'));
assert(rewrites.includes('/novel/my-rich-wife/chapter-752/ /restricted-reader.html 200'));
assert(!rewrites.includes('/novel/shadow-slave/chapter-:number/'),'Do not redirect normal readers');
assert.match(read('_headers'),/\/novel\/:novel\/chapter-\*\s+X-Robots-Tag: noindex, follow/);
assert.equal(read('ads.txt'),fs.readFileSync('dist/ads.txt','utf8'));
assert(read('index.html').includes(publisher),'Homepage AdSense must be unchanged');
for(const p of ['catalog.js','app.js','accounts.js','data/fwn-martial-god-asura-chapters-01.js']){
  assert(fs.existsSync('dist/'+p),'Compatibility build must not remove old reading asset: '+p);
}
console.log('Verified compatible Pages build; existing reader and AdSense remain preserved');
