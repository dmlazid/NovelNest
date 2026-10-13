import assert from 'node:assert/strict';
import fs from 'node:fs';
const expectedAds=fs.readFileSync('dist/ads.txt','utf8').trim();
const base='https://novelhaven.top';
const urls=['/novel/supreme-harem-god-system/chapter-1/',
  '/novel/my-rich-wife/chapter-752/','/novel/shadow-slave/chapter-1/',
  '/novel/supreme-harem-god-system/','/ads.txt'];
const get=async(route)=>{
  const r=await fetch(base+route+'?audit='+Date.now(),{
    headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(18000)
  });
  return {status:r.status,body:await r.text(),robots:r.headers.get('x-robots-tag')||''};
};
let success=false;
for(let attempt=1;attempt<=24;attempt++){
  try{
    const [restricted,duplicate,normal,detail,ads]=await Promise.all(urls.map(get));
    assert(restricted.status===200&&duplicate.status===200&&normal.status===200);
    assert(restricted.body.includes('app.js'),'Restricted chapter must remain readable');
    assert(duplicate.body.includes('app.js'),'Duplicate body must remain readable');
    assert(!restricted.body.includes('pagead2.googlesyndication.com'),'Explicit chapter must not load AdSense');
    assert(!duplicate.body.includes('pagead2.googlesyndication.com'),'Duplicate chapter must not load AdSense');
    assert(normal.body.includes('app.js'),'Existing normal chapter router must remain functional');
    assert(normal.body.includes('pagead2.googlesyndication.com'),'Regular pages retain existing publisher verification');
    assert(/noindex/i.test(normal.robots),'SPA-only chapter fallback must not be indexed as complete HTML');
    assert(/noindex/i.test(restricted.robots+' '+restricted.body),'Explicit reader must be excluded from indexing');
    assert(detail.status===200&&!detail.body.includes('pagead2.googlesyndication.com'));
    assert(ads.status===200&&ads.body.trim()===expectedAds,'Ads.txt publisher settings changed unexpectedly');
    console.log('Verified live ad-safe restricted chapters; normal reader, source scripts and ads.txt remain intact.');
    success=true;break;
  }catch(e){console.log('Awaiting Cloudflare production restricted-route publication ('+attempt+'/24): '+e.message.slice(0,180));}
  await new Promise(r=>setTimeout(r,15000));
}
if(!success)throw Error('Restricted chapter rewrites have not yet passed production verification');
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '### Live restricted chapter verification\n\nNo AdSense script is present on restricted chapters. '+
  'Normal chapters still load the original reader and ads.txt is unchanged. '+
  'Unrendered SPA chapter routes are temporarily noindex pending D1 verification.\n');
