// Read-only post-deployment check. Verifies actual public legal pages instead
// of only checking local generated files. Does not touch AdSense settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin=(process.env.POLICY_REVIEW_ORIGIN || 'https://novelhaven.top').replace(/\/$/,'');
const parsed=new URL(origin);
assert(parsed.protocol==='https:' &&
  (parsed.hostname==='novelhaven.top'||parsed.hostname.endsWith('.pages.dev')),
  'Refuse policy audit of an unrecognized deployment origin');
const adScript='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9356195452195758';
const legal=[
  'about.html','contact.html','copyright.html','editorial-policy.html',
  'content-licensing.html','advertising-disclosure.html','privacy.html',
  'privacy-choices.html','terms.html'
];
const publisher=fs.readFileSync('dist/ads.txt','utf8').trim();
async function read(path){
  const response=await fetch(origin+'/'+path+(path.includes('?')?'&':'?')+'policy-check='+Date.now(),{
    signal:AbortSignal.timeout(25000),headers:{'Cache-Control':'no-cache'}
  });
  assert.equal(response.status,200,path+': invalid live HTTP status '+response.status);
  return await response.text();
}
let last='';
for(let attempt=1;attempt<=9;attempt++){
  try{
    const paths=[...legal,'','ads.txt','reading-desk.html'];
    const html=await Promise.all(paths.map(read));
    legal.forEach((path,i)=>{
      assert(!html[i].includes(adScript),path+': legal/utility page still includes AdSense loader');
      assert(html[i].includes('Novel<span>Haven</span>'),path+': old brand or blank page');
      assert(html[i].includes('https://novelhaven.top/'+path),path+': wrong canonical link');
      assert(html[i].includes('<h1>'),path+': policy information missing');
    });
    const choices=html[legal.indexOf('privacy-choices.html')];
    assert(choices.includes('Approval not confirmed'),'Privacy Choices is stale');
    assert(choices.includes('does not erase synced Firebase account data'),'Missing privacy disclaimer');
    const about=html[legal.indexOf('about.html')];
    assert(about.includes('Importing an older chapter into NovelHaven is not presented as a new release'));
    const home=html[legal.length],ads=html[legal.length+1],desk=html[legal.length+2];
    assert(home.includes(adScript),'Homepage publisher verification changed');
    assert(desk.includes(adScript),'Substantive Reading Desk publisher verification changed');
    assert.equal(ads.trim(),publisher,'AdSense ads.txt changed on live site');
    console.log('VERIFIED NovelHaven public policy pages:',JSON.stringify({
      origin,utilityPagesWithoutAdCode:legal.length,
      privacyBrandCorrect:true,localDataDisclosure:true,
      originalPublisherVerificationPreserved:true,adsTxtUnchanged:true
    }));
    if(process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '## NovelHaven site-policy verification\n\nNine public policy/utility pages are ad-free and carry the correct brand. Homepage publisher verification and ads.txt remain unchanged. Rights evidence and AdSense approval have not been verified.\n');
    process.exit(0);
  }catch(error){
    last=String(error.message||error);
    console.log('Policy publication not yet verified '+attempt+'/9: '+last.slice(0,210));
    if(attempt<9)await new Promise(resolve=>setTimeout(resolve,14000));
  }
}
throw Error('Live policy verification failed: '+last);
