// Read-only public verification for NovelHaven's copy-review advertising hold.
// Never changes AdSense account, publisher ID, DNS, D1, or novel contents.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=(process.env.NOVEL_AD_HOLD_ORIGIN||'https://novelhaven.top').replace(/\/$/,'');
const hostname=new URL(origin).hostname;
assert(origin.startsWith('https://')&&(hostname==='novelhaven.top'||hostname.endsWith('.pages.dev')),
  'Unexpected target for public novel policy verification');
const expectedAds=fs.readFileSync('dist/ads.txt','utf8').trim();
const publisher='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9356195452195758';
async function get(path){
  const response=await fetch(origin+path+(path.includes('?')?'&':'?')+'review='+Date.now(),{
    signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}
  });
  return {status:response.status,body:await response.text(),
    robots:response.headers.get('x-robots-tag')||''};
}
let verified=false,reason='';
for(let attempt=1;attempt<=12;attempt++){
  try {
    const routes=['/','/reading-desk.html','/ads.txt','/build-info.json',
      '/novel/shadow-slave/','/novel/shadow-slave/chapter-1/',
      '/novel/supreme-harem-god-system/','/novel/supreme-harem-god-system/chapter-1/'];
    const responses=await Promise.all(routes.map(get));
    for(let i=0;i<routes.length;i++)assert.equal(responses[i].status,200,
      routes[i]+': failed HTTP status');
    const [home,desk,ads,info,normal,chapter,restricted,restrictedChapter]=responses;
    const build=JSON.parse(info.body);
    assert(build.novelAdsHeld>0,'No novel advertising hold in deployed build');
    assert.equal(build.novelAdsHeld+build.novelAdsReviewed,build.novels,
      'Incorrect title-level monetization coverage');
    assert(home.body.includes(publisher),'Homepage publisher verification changed');
    assert(desk.body.includes(publisher),'Original editorial publisher verification changed');
    assert.equal(ads.body.trim(),expectedAds,'AdSense ads.txt changed');
    for(const [path,result] of [
      ['/novel/shadow-slave/',normal],
      ['/novel/shadow-slave/chapter-1/',chapter],
      ['/novel/supreme-harem-god-system/',restricted],
      ['/novel/supreme-harem-god-system/chapter-1/',restrictedChapter]
    ]) {
      assert(!result.body.includes(publisher),path+': publisher tag still on novel pages');
      assert(result.body.includes('app.js'),path+': chapter/book reader missing');
    }
    assert(/noindex/i.test(chapter.robots+' '+chapter.body),
      'Unrendered SPA chapter must remain noindex');
    assert(/noindex/i.test(restricted.robots+' '+restricted.body),
      'Explicit-content title must remain noindex');
    // Cloudflare may apply noindex to all temporary *.pages.dev preview
    // domains. Check the production header only on the real custom domain.
    if(hostname==='novelhaven.top')
      assert(!/noindex/i.test(normal.robots),
        'Ordinary novel detail remains eligible for discovery');
    console.log('VERIFIED live NovelHaven novel monetization hold:',JSON.stringify({
      origin,novelsOnAdHold:build.novelAdsHeld,novelsReviewed:build.novelAdsReviewed,
      sampleDiscoverableNovelAdFree:true,normalAndRestrictedChaptersAdFree:true,
      chapterNoindexPreserved:true,readerPreserved:true,
      homepagePublisherPreserved:true,adsTxtUnchanged:true
    }));
    verified=true;break;
  }catch(error){
    reason=String(error.message||error).slice(0,240);
    console.log('Awaiting novel ad hold ('+attempt+'/12): '+reason);
    if(attempt<12)await new Promise(done=>setTimeout(done,12000));
  }
}
if(!verified)throw Error('Novel ad hold not yet verified: '+reason);
if(process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '### Novel advertising hold live check\n\nAll unreviewed novel reading routes tested without publisher ads. Homepage/Reading Desk publisher ID and ads.txt preserved. This is not AdSense approval or title rights certification.\n');
