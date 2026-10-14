import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sourceFeedFilename} from './source-feed-fingerprint.mjs';
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
assert(!sample.includes(publisher),'Unreviewed novel details must not request publisher ads');
for(const p of ['browse/index.html','latest-releases/index.html','latest-novels/index.html',
  'completed/index.html','finder/index.html']){
  const html=read(p);
  assert(!html.includes(publisher),p+': unreviewed catalog directory must be ad-free');
  assert(html.includes('app.js?'),'Directory must keep the existing interactive reader');
  assert(html.includes('name="robots" content="index,follow'),
    p+': do not hide the directory from readers or search');
}
const genreFiles=fs.readdirSync('dist/genre',{withFileTypes:true}).filter(x=>x.isDirectory());
assert(genreFiles.length>0,'Genre directories must exist');
for(const genre of genreFiles){
  const p='genre/'+genre.name+'/index.html';
  assert(!read(p).includes(publisher),p+': generated genre listings must be ad-free');
}
assert(!read('library/index.html').includes(publisher),'Library must stay ad-free');
assert(read('reading-desk/index.html').includes(publisher),
  'Original Reading Desk publisher verification must stay intact');
assert.equal(build.novelAdsReviewed,0,'No title-specific commercial rights review was recorded');
assert.equal(build.novelAdsHeld,build.novels,'All unreviewed novel details must stay ad-free');
assert(sample.includes('app.js?'),'Interactive SPA must remain loaded');
const version=read('index.html').match(/src="(app\.js\?v=[^"]+)"/)?.[1];
assert(version && sample.includes('src="'+version+'"'),
  'Latest Novels must load the updated reader/discovery script');
const sourceAsset=sourceFeedFilename(read('source-activity.js'));
assert(sample.includes('src="'+sourceAsset+'"'),
  'Source snapshot must use a unique content-addressed URL');
assert.equal(read(sourceAsset),read('source-activity.js'),
  'Published fingerprinted source snapshot does not match the latest source report');
assert.equal(build.sourceFeedAsset,sourceAsset,
  'Build metadata must identify the exact source snapshot');
assert(!sample.includes('src="source-activity.js'),
  'Old long-cached source report URL must not remain in the rendered homepage');
assert(sample.includes('removed-duplicates.js'),'Deleted chapter map must load before the reader');
assert.equal(build.removedChapterBodies,9,'All nine chapter bodies should be deleted');
const rich=read('novel/my-rich-wife/index.html');
assert(!rich.includes('href="/novel/my-rich-wife/chapter-752/"'),'Removed chapter must not appear in the public table of contents');
assert(!rich.includes('href="/novel/my-rich-wife/chapter-872/"'),'Second removed chapter must not appear in the public table of contents');
assert(rich.includes('href="/novel/my-rich-wife/chapter-753/"'),'Neighboring chapter numbers must be stable');
assert(sample.includes('<main id="main" class="wrap" tabindex="-1">'),'Detail page contains real HTML');

const legal=['about.html','contact.html','copyright.html','editorial-policy.html',
  'content-licensing.html','advertising-disclosure.html','privacy.html',
  'privacy-choices.html','terms.html'];
for(const page of legal){
  assert(!read(page).includes(publisher),page+': legal/utility pages must remain ad-free');
  assert(read(page).includes('Novel<span>Haven</span>'),page+': correct brand required');
}
assert(read('privacy-choices.html').includes('Approval not confirmed'),
  'Privacy Choices must not falsely imply a live AdSense review');

for(const page of ['contact.html','copyright.html','content-licensing.html','privacy.html']){
  assert(read(page).includes('mailto:novelhaven15@gmail.com'),
    page+': a direct email contact must exist for nonpublic rights inquiries');
}
assert(read('copyright.html').includes('Email a copyright request'),
  'Copyright takedown must not rely only on public GitHub issues');
assert(sample.includes('NovelHaven reader'),
  'Do not label unreviewed individual novel rights as certified licenses');

const restricted=read('novel/supreme-harem-god-system/index.html');
assert.match(restricted,/<meta name="robots" content="noindex,follow"/);
assert(!restricted.includes(publisher),'Restricted detail must not include ads script');
const library=read('library/index.html');
assert(library.includes('Loading your bookmarks'),'Library must not pretend bookmarks are empty before hydration');
assert(!library.includes('A shelf waiting for stories'),'Do not prerender an empty guest bookshelf');
assert.match(library,/name="robots" content="noindex,follow"/);
assert(!library.includes(publisher));
const noads=read('restricted-reader.html');
assert.match(noads,/name="robots" content="noindex,follow"/);
assert.doesNotMatch(noads,/pagead2\.googlesyndication\.com/);
assert(noads.includes('app.js?'),'Restricted chapters must keep the working SPA');
const rewrites=read('_redirects');
assert(rewrites.includes('/novel/:novel/chapter-:number/ /restricted-reader.html 200'),
  'Every chapter must load the ad-free reader shell pending novel monetization review');
assert(!read('novel/shadow-slave/index.html').includes(publisher),
  'A normally discoverable novel must not gain ads before title-level review');
assert(rewrites.split('\n').filter(x=>x.includes('/restricted-reader.html 200')).length===1,
  'Use one safe catchall rather than more than 100 Cloudflare dynamic redirect rules');
assert.match(read('_headers'),/\/novel\/:novel\/chapter-\*\s+X-Robots-Tag: noindex, follow/);
assert.equal(read('ads.txt'),fs.readFileSync('dist/ads.txt','utf8'));
assert(read('index.html').includes(publisher),'Homepage AdSense must be unchanged');
for(const p of ['catalog.js','app.js','accounts.js','data/fwn-martial-god-asura-chapters-01.js']){
  assert(fs.existsSync('dist/'+p),'Compatibility build must not remove old reading asset: '+p);
}
console.log('Verified compatible Pages build; existing reader and AdSense remain preserved');
