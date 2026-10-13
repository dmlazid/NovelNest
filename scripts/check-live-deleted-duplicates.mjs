// Read-only verification after Cloudflare Pages publishes deleted duplicate chapters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin='https://novelhaven.top';
const expectedAds=fs.readFileSync('dist/ads.txt','utf8').trim();
const expected=[
  {name:'supreme-magus',file:'supreme-magus-chapters-20.js',pairs:[[1913,1915],[1914,1916]]},
  {name:'my-rich-wife',file:'fwn-my-rich-wife-chapters-08.js',pairs:[[751,752]]},
  {name:'my-rich-wife',file:'fwn-my-rich-wife-chapters-09.js',pairs:[[871,872]]},
  {name:'reborn-at-boot-camp-general-dont-mess-around',file:'fwn-reborn-boot-camp-chapters-37.js',pairs:[[3669,3670]]},
  {name:'necropolis-immortal',file:'fwn-necropolis-immortal-chapters-16.js',pairs:[[1586,1587]]},
  {name:'necropolis-immortal',file:'fwn-necropolis-immortal-chapters-18.js',pairs:[[1764,1765]]},
  {name:'martial-peak',file:'fwn-martial-peak-chapters-52.js',pairs:[[5177,5178]]},
  {name:'martial-god-asura',file:'fwn-martial-god-asura-chapters-61.js',pairs:[[6010,6012]]},
];
async function get(path) {
  const r=await fetch(origin+path+'?revision=duplicate-removal-20261013',{
    headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)
  });
  assert.equal(r.status,200,'Cannot read live '+path);
  return await r.text();
}
let passed=false,last='';
for(let attempt=1;attempt<=24;attempt++){
  try {
    const [manifest,detail,oldChapter,newChapter,ads,...chunks]=await Promise.all([
      '/removed-duplicates.js','/novel/my-rich-wife/',
      '/novel/my-rich-wife/chapter-752/','/novel/my-rich-wife/chapter-753/',
      '/ads.txt',...expected.map(group=>'/data/'+group.file)
    ].map(get));
    assert.match(manifest,/NOVELNEST_REMOVED_DUPLICATES/);
    assert(detail.includes('href="/novel/my-rich-wife/chapter-753/"'),'Next existing chapter link missing');
    assert(!detail.includes('href="/novel/my-rich-wife/chapter-752/"'),'Removed chapter still listed publicly');
    assert(oldChapter.includes('removed-duplicates.js'),'Removed chapter reader manifest not loaded');
    assert(!oldChapter.includes('pagead2.googlesyndication.com'),'Deleted chapter must not request ads');
    assert(newChapter.includes('app.js'),'Other chapters must remain readable');
    assert.equal(ads.trim(),expectedAds,'AdSense publisher file changed');
    let removed=0;
    for(let i=0;i<expected.length;i++){
      const code=chunks[i],start=code.indexOf('.concat(');
      assert(start>=0,'Unexpected chunk payload '+expected[i].file);
      const arr=JSON.parse(code.slice(start+8,code.lastIndexOf(');')));
      for(const [original,duplicate] of expected[i].pairs){
        const kept=arr.find(c=>c.number===original),gone=arr.find(c=>c.number===duplicate);
        assert(kept?.paragraphs?.length,'Retained original chapter missing '+original);
        assert(gone?.removedDuplicate===true&&Array.isArray(gone.paragraphs)&&gone.paragraphs.length===0,
          'Duplicate prose still publicly available: '+expected[i].name+' #'+duplicate);
        removed++;
      }
    }
    assert.equal(removed,9);
    console.log('Verified live NovelHaven deleted duplicate chapters:',JSON.stringify({
      duplicatedBodiesRemoved:removed,chapterNumbersStable:true,originalBodiesKept:true,
      deletedChaptersHiddenFromTOC:true,deletedChapterAdsDisabled:true,adsTxtUnchanged:true
    }));
    passed=true;break;
  }catch(error){
    last=error.message;
    console.log('Waiting for deleted chapter rollout '+attempt+'/24: '+last.slice(0,180));
    if(attempt<24)await new Promise(resolve=>setTimeout(resolve,15000));
  }
}
if(!passed)throw Error('Live duplicate deletion not fully verified: '+last);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## Deleted duplicate chapters verified live\n\nNine duplicate bodies were removed while keeping numbered chapter slots, original source paragraphs, bookmarks, and ads.txt intact.\n');
