// Production read-only check after a guarded direct-upload release.
// Do not equate a queued Git deployment with a successful live publish.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sourceFeedFilename} from './source-feed-fingerprint.mjs';
import {extractLiveSourceNovels,renderLiveHomepage} from './live-home-check.mjs';
const base='https://novelhaven.top';
const expectedAds=fs.readFileSync('dist/ads.txt','utf8').trim();
const expectedSource=fs.readFileSync('dist/source-activity.js','utf8');
const currentFeed=sourceFeedFilename(expectedSource);
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
      get('/'),get('/app.js'),get('/'+currentFeed),
      get('/ads.txt'),get('/novel/supreme-harem-god-system/'),
      get('/removed-duplicates.js'),get('/novel/shadow-slave/chapter-1/')
    ]);
    for(const [name,v] of [['home',home],['app',app],['source',source],['ads',ads],
      ['hidden',hidden],['removed',removed],['chapter',chapter]])
      assert.equal(v.status,200,'Live '+name+' returned HTTP '+v.status);
    assert(home.body.includes('app.js?v=20261014-source-accurate-latest-1'),
      'Old app version is still published');
    assert(home.body.includes('src="'+currentFeed+'"'),
      'Live HTML still points to a previous source-activity snapshot');
    assert(app.body.includes('const latestNovels=releases.filter'),
      'Random imported novels code is still published');
    assert.equal(source.body,expectedSource,
      'Live fingerprinted source asset differs from the tested GitHub snapshot');
    // This exact content URL may be cached for hours. The next source update
    // will generate a different filename, so an old response cannot replace it.
    assert.equal(ads.body.trim(),expectedAds,'AdSense publisher file changed');
    assert(!hidden.body.includes('pagead2.googlesyndication.com'),
      'Restricted detail must not load AdSense');
    assert(/noindex/.test(hidden.body),'Restricted detail lost noindex');
    assert(removed.body.includes('NOVELNEST_REMOVED_DUPLICATES'),
      'Deleted duplicate chapter manifest lost');
    assert(chapter.body.includes('app.js'),'Original chapter reader is missing');
    // Cloudflare serves a lightweight SPA shell for the homepage. Only a real
    // browser executes the catalog, source feed and app code into Latest Novels.
    const rendered=renderLiveHomepage(base+'/?live-browser-verify='+Date.now());
    assert(rendered.includes('src="'+currentFeed+'"'),
      'Browser received a stale HTML source asset reference');
    const {released,latest}=extractLiveSourceNovels(rendered);
    console.log('VERIFIED NovelHaven live source updates:',JSON.stringify({
      latestNovels:latest,sourceReleases:released.length,adsTxtUnchanged:true,
      existingChapterReader:true,removedDuplicatesPreserved:true,sourceFeedAsset:currentFeed
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
