// Targeted Cloudflare cache repair after the verified Pages upload.
// A stale zone cache previously served old contact.html despite a successful
// Pages deploy. Never purge the whole zone, change DNS, or touch AdSense.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const DOMAIN='novelhaven.top';
const TAG='pagead2.googlesyndication.com';
const MAIL='mailto:novelhaven15@gmail.com';
export const TARGETS=Object.freeze([
  {path:'/contact.html',contains:MAIL},
  {path:'/copyright.html',contains:MAIL},
  {path:'/content-licensing.html',contains:MAIL},
  {path:'/privacy.html',contains:MAIL},
  {path:'/novel/shadow-slave/',excludes:TAG},
  {path:'/novel/shadow-slave/chapter-1/',excludes:TAG},
  {path:'/novel/supreme-harem-god-system/chapter-1/',excludes:TAG}
]);

export async function targetedPolicyPurge({token,accountId,fetchFn=fetch,origin='https://novelhaven.top'}={}){
  assert(new URL(origin).hostname===DOMAIN&&origin==='https://'+DOMAIN,
    'Only the exact approved NovelHaven production domain may be inspected/purged');
  assert(token&&accountId,'Cloudflare Pages GitHub credentials required');
  const stale=[];
  for(const target of TARGETS){
    const r=await fetchFn(origin+target.path+'?cache-repair='+Date.now(),{
      signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}
    });
    const body=await r.text();
    if(!r.ok||(target.contains&&!body.includes(target.contains))||
      (target.excludes&&body.includes(target.excludes)))stale.push(target.path);
  }
  if(!stale.length)return {checked:TARGETS.length,stale:[],purged:[],status:'fresh'};
  const api='https://api.cloudflare.com/client/v4';
  const headers={Authorization:'Bearer '+token};
  const zones=await fetchFn(api+'/zones?name='+encodeURIComponent(DOMAIN),{
    signal:AbortSignal.timeout(20000),headers
  });
  assert.equal(zones.status,200,'Cloudflare token must have Zone Read permission to identify the correct site');
  const json=await zones.json();
  assert(json.success===true&&Array.isArray(json.result),'Cloudflare zones response invalid');
  const zone=json.result.find(z=>z.name===DOMAIN&&z.account?.id===accountId);
  assert(zone&&/^[a-f0-9]{32}$/.test(zone.id),
    'Cloudflare did not return the exact NovelHaven zone in the expected account; refusing cache purge');
  const files=stale.map(item=>origin+item);
  assert(files.length<=TARGETS.length&&files.every(item=>item.startsWith('https://'+DOMAIN+'/')),
    'Cache purge refused for unexpected files');
  const response=await fetchFn(api+'/zones/'+zone.id+'/purge_cache',{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({files}),signal:AbortSignal.timeout(30000)
  });
  const result=await response.json();
  assert(response.status===200&&result.success===true,
    'Cloudflare could not purge specified URLs; check API token Cache Purge permission');
  return {checked:TARGETS.length,stale,purged:files,status:'purge_requested'};
}

export async function main(){
  const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId}=process.env;
  assert(fs.readFileSync('dist/contact.html','utf8').includes(MAIL),
    'Do not purge production before contact email is committed in build');
  assert(!fs.readFileSync('dist/novel/shadow-slave/index.html','utf8').includes(TAG),
    'Do not purge production until novel ad-safe build is generated');
  const result=await targetedPolicyPurge({token,accountId});
  console.log('NovelHaven targeted cache maintenance:',JSON.stringify({
    checked:result.checked,stalePaths:result.stale,
    purgedUrlCount:result.purged.length,status:result.status
  }));
  if(process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### NovelHaven targeted cache refresh\n\n'+result.status+
      ' — '+result.purged.length+' affected paths; never purged whole zone.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error('Targeted cache refresh unavailable:',String(error.message).slice(0,240));
    process.exitCode=1;
  });
