// Check the actual browser-rendered Latest Novels section, not the raw SPA
// shell returned by Cloudflare Pages. No changes to site content or AdSense.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';

export function extractLiveSourceNovels(html) {
  const releaseSection=html.match(/<section class="home-feed-section home-release-section"[\s\S]*?<\/section>/);
  assert(releaseSection,'Latest Release Novels is missing from rendered homepage');
  const released=[...releaseSection[0].matchAll(/class="home-release-row" href="\/novel\/([^/]+)\//g)].map(m=>m[1]);
  const start=html.indexOf('Latest Novels</h2>');
  assert(start>=0,'Latest Novels is missing from rendered homepage');
  const end=html.indexOf('</section>',start);
  assert(end>=0,'Latest Novels section is incomplete');
  const latest=[...html.slice(start,end).matchAll(/class="home-novel-tile" href="\/novel\/([^/]+)\//g)].map(m=>m[1]);
  assert(released.length>0,'No verified source release rows rendered');
  assert.deepEqual(latest,released,
    'Latest Novels must show only the most recent source releases, in order');
  return {latest,released};
}

export function renderLiveHomepage(url) {
  const candidates=['google-chrome','google-chrome-stable','chromium'];
  const executable=candidates.find(name=>{
    const check=spawnSync('which',[name],{encoding:'utf8'});
    return check.status===0;
  });
  assert(executable,'Headless Chrome is required for real rendered-homepage verification');
  return execFileSync(executable,[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    '--disable-background-networking','--disable-extensions','--no-first-run',
    '--virtual-time-budget=35000','--dump-dom',url
  ],{encoding:'utf8',timeout:110000,maxBuffer:24*1024*1024,stdio:['ignore','pipe','pipe']});
}
