// Spot-check live NovelHaven routes/assets for EVERY locally indexed title.
// The offline script/check.mjs performs full content/sequence validation.
import fs from 'node:fs';
const report=JSON.parse(fs.readFileSync('all-novels-chapter-audit.json','utf8'));
const origin='https://novelhaven.top';
const issues=[];
let verified=0;
async function get(relative){
 let lastError;
 for(let attempt=1;attempt<=2;attempt++){
  try{
   const response=await fetch(origin+'/'+relative.replace(/^\/+/,'')+(relative.includes('?')?'&':'?')+'audit='+Date.now(),{
     signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache','Accept':'*/*'}});
   if(response.status!==200)throw Error('HTTP '+response.status);
   return await response.text();
  }catch(error){lastError=error;if(attempt<2)await new Promise(r=>setTimeout(r,1000));}
 }
 throw lastError;
}
async function check(n){
 try{
  const detail=await get('novel/'+encodeURIComponent(n.id)+'/');
  if(!detail.toLowerCase().includes('<html'))throw Error('Novel detail was not HTML');
  if(!n.catalogScript)throw Error('No registered catalog file');
  const js=await get(n.catalogScript);
  if(!js.includes('"id":"'+n.id+'"')||
     !js.includes('"number":'+n.catalogChapters))throw Error('Live catalog metadata is out of date');
  if(!n.lastChunk)throw Error('No chapter data asset');
  const chunk=await get(n.lastChunk);
  if(!chunk.includes('"number":'+n.lastReadable)||
     !chunk.includes('"paragraphs":['))throw Error('Last available chapter missing from live asset');
  const chapter=await get('novel/'+encodeURIComponent(n.id)+'/chapter-'+n.lastReadable+'/');
  if(chapter.length<300||!/<html/i.test(chapter))throw Error('Last chapter reader route is invalid');
  verified++;
 }catch(e){issues.push({id:n.id,title:n.title,reason:String(e?.message||e).slice(0,180)});}
}
const queue=[...report.novels];
const threads=Array.from({length:5},async()=>{
 while(queue.length){const n=queue.shift();if(n)await check(n);}
});
await Promise.all(threads);
const findings={checked:report.count,liveVerified:verified,liveIssues:issues.length,issues,at:new Date().toISOString()};
fs.writeFileSync('all-novels-live-audit.json',JSON.stringify(findings,null,2)+'\n');
console.log('Live novel audit:',JSON.stringify({checked:findings.checked,verified,issues:issues.length}));
for(const bad of issues.slice(0,35))console.log('LIVE_ISSUE',bad.id,bad.reason);
if(process.env.GITHUB_STEP_SUMMARY)
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '\n### Live novel spot checks\n'+verified+'/'+report.count+
  ' novels had reachable detail pages, catalog metadata, last chapter text assets and last reader routes.\n'+
  (issues.length?'See all-novels-live-audit.json for '+issues.length+' issues.\n':'No live routing issues detected in these checks.\n'));
if(issues.length)process.exitCode=1;
