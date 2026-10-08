import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin = 'https://' + fs.readFileSync('_site/CNAME', 'utf8').trim();
const info = JSON.parse(fs.readFileSync('_site/build-info.json', 'utf8'));
const nonce = encodeURIComponent(info.generatedAt);
async function read(route) {
  const response = await fetch(origin + route + '?deployment-check=' + nonce, {
    signal: AbortSignal.timeout(20000),
    headers: { 'Cache-Control': 'no-cache' }
  });
  assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
  return response.text();
}

const chapterUrl = fs.readFileSync('_site/sitemaps/chapters-1.xml', 'utf8').match(/<loc>([^<]+)<\/loc>/)[1];
const chapterPath = new URL(chapterUrl).pathname;
const publisher = fs.readFileSync('dist/index.html', 'utf8').match(/<script async src="https:\/\/pagead2[^>]+><\/script>/)[0];
async function verify() {
  const published = JSON.parse(await read('/build-info.json'));
  assert.equal(published.generatedAt, info.generatedAt, 'The CDN is still serving an earlier deployment');
  const [home, chapter, privacy, ads, sitemap] = await Promise.all([
    read('/'), read(chapterPath), read('/privacy.html'), read('/ads.txt'), read('/sitemap.xml')
  ]);
  assert(home.includes(publisher), 'Published homepage is missing publisher verification');
  assert(chapter.includes(publisher), 'Published chapter is missing publisher verification');
  assert.match(chapter, /data-static-chapter=/);
  assert.match(chapter, /data-chapter-number="1"/);
  assert.match(chapter, /<p>[^<]+(?:<p>|<\/div>)/);
  assert.match(chapter, /href="\/privacy.html"/);
  assert.doesNotMatch(chapter, /Loading chapter…/);
  assert.equal(privacy, fs.readFileSync('dist/privacy.html', 'utf8'));
  assert.equal(ads, fs.readFileSync('dist/ads.txt', 'utf8'));
  assert.match(sitemap, /<sitemapindex/);
  const runtime = home.match(/<script defer src="(\/assets\/runtime\.[^"]+)"/)[1];
  assert.match(await read(runtime), /NOVELNEST_STATIC_READERS/);
  console.log(`Live verification passed: ${published.chapters} chapters; homepage, reader, privacy, ads.txt, sitemap and runtime return HTTP 200.`);
}

// Pages can finish deployment before every CDN edge has the new files.
for (let attempt = 1; ; attempt++) {
  try { await verify(); break; }
  catch (error) {
    if (attempt === 6) throw error;
    console.warn(`Live check ${attempt}/6: ${error.message}. Waiting for the CDN.`);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
