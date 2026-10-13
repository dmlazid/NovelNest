// Production read-only check after a guarded direct-upload release.
// Do not equate a queued Git deployment with a successful live publish.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='https://novelhaven.top';
const expectedAds=fs.readFileSync('dist/ads.txt','utf8').trim();
const get=async path=>{
  const r=await fetch(base+path+(path.includes('?')?'&':'?')+'live-verify='+Date.now(),{
    signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}
  });
  return {status:r.status,body:await r.text(),headers:r.headers};
};
let verified=false,reason='';
for(let attempt=1;attempt<=20;attempt++){
  try{
    const [home,app,source,ads,hidden,removed,chapter]=await Promise.all([
      get('/'),get('/app.js'),get('/source-activity.js?v=20261014-fresh-source-feed-1'),
      get('/ads.txt'),get('/novel/supreme-harem-god-system/'),
      get('/removed-duplicates.js'),get('/novel/shadow-slave/chapter-1/')
    ]);
    for(const [name,v] of [['home',home],['app',app],['source',source],['ads',ads],
      ['hidden',hidden],['removed',removed],['chapter',chapter]])
      assert.equal(v.status,200,'Live '+name+' returned HTTP '+v.status);
    assert(home.body.includes('app.js?v=20261014-source-accurate-latest-1'),
      'Old app version is still published');
    assert(home.body.includes('source-activity.js?v=20261014-fresh-source-feed-1'),
      'Old source activity URL is still published');
    assert(app.body.includes('const latestNovels=releases.filter'),
      'Random imported novels code is still published');
    assert(source.body.includes('sourceActivityVerified'));
    assert.match(source.headers.get('cache-control')||'',/max-age=60/,
      'Source release asset is still long-cached');
    assert.equal(ads.body.trim(),expectedAds,'AdSense publisher file changed');
    assert(!hidden.body.includes('pagead2.googlesyndication.com'),
      'Restricted detail must not load AdSense');
    assert(/noindex/.test(hidden.body),'Restricted detail lost noindex');
    assert(removed.body.includes('NOVELNEST_REMOVED_DUPLICATES'),
      'Deleted duplicate chapter manifest lost');
    assert(chapter.body.includes('app.js'),'Original chapter reader is missing');
    const releaseSection=home.body.match(/<section class="home-feed-section home-release-section"[\s\S]*?<\/section>/);
    assert(releaseSection,'Latest Release Novels is missing');
    const released=[...releaseSection[0].matchAll(/class="home-release-row" href="\/novel\/([^/]+)\//g)].map(m=>m[1]);
    const pos=home.body.indexOf('Latest Novels</h2>');
    assert(pos>=0,'Latest Novels missing from homepage');
    const next=home.body.indexOf('</section>',pos);
    const latest=[...home.body.slice(pos,next<0?undefined:next).matchAll(/class="home-novel-tile" href="\/novel\/([^/]+)\//g)].map(m=>m[1]);
    assert(released.length>0,'No verified source release rows');
    const expected=released.slice(0,6);
    assert.deepEqual(latest,expected,
      'Latest Novels must display only the most recent source releases in order');
    console.log('VERIFIED NovelHaven live source updates:',JSON.stringify({
      latestNovels:latest,sourceReleases:released.length,adsTxtUnchanged:true,
      existingChapterReader:true,removedDuplicatesPreserved:true,sourceCacheSeconds:60
    }));
    verified=true;break;
  }catch(error){
    reason=String(error.message||error).slice(0,240);
    console.log('Production Latest Novels not yet verified ('+attempt+'/20): '+reason);
    if(attempt<20)await new Promise(resolve=>setTimeout(resolve,15000));
  }
}
if(!verified)throw new Error('Live release did not pass verification: '+reason);
if(process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## NovelHaven live Latest Novels verified\n\nOnly genuine source chapter releases shown, in order. '+
    'Chapter reader, removed duplicates and AdSense publisher file preserved. No D1 cutover.\n');
