// Read-only live verification of the Author Studio pilot.
// This checks static public assets only. It cannot prove Firebase rules were
// deployed or that an owner administrator account has been activated.
import assert from 'node:assert/strict';
const origin=(process.env.NOVELHAVEN_AUTHOR_ORIGIN||'https://novelhaven.top').replace(/\/$/,'');
const host=new URL(origin).hostname;
assert(host==='novelhaven.top'||host.endsWith('.pages.dev'),'Only test NovelHaven or a Pages preview');
const pages=['/author-studio.html','/author-admin.html','/original-novels.html',
 '/original-story.html','/author-guidelines.html'];
const assets=['/author-publishing.js','/author-draft-recovery.mjs','/author-publishing.css'];
async function fetchText(path){
 const response=await fetch(origin+path+'?author-check='+Date.now(),{
   headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)
 });
 assert.equal(response.status,200,path+' must be available');
 return response.text();
}
let verified=false,lastError='';
for(let attempt=1;attempt<=8;attempt++){
 try{
  const contents=await Promise.all([...pages,...assets].map(fetchText));
  for(let i=0;i<pages.length;i++){
    const body=contents[i];
    assert.match(body,/name="robots" content="noindex,follow"/,pages[i]+' should remain noindex');
    assert.doesNotMatch(body,/pagead2\.googlesyndication\.com|adsbygoogle/,pages[i]+' must not serve ads');
    assert.match(body,/novelhaven|NovelHaven/i,pages[i]+' missing branding');
    if(pages[i]!=='/author-guidelines.html'){
      assert.match(body,i<2?/author-publishing\.js\?v=4/:/author-publishing\.js\?v=3/,pages[i]+' must load latest writer client');
      assert.match(body,i<2?/author-publishing\.css\?v=4/:/author-publishing\.css\?v=3/,pages[i]+' missing updated styles');
    }
  }
  assert.match(contents[5],/pendingDraftNumbers/);
  assert.match(contents[5],/data-hide-published/);
  assert.match(contents[6],/export function readDraft/);
  assert.match(contents[6],/export function saveDraft/);
  verified=true;break;
 }catch(error){
  lastError=String(error.message||error).slice(0,240);
  console.log('Waiting for original-author pilot assets ('+attempt+'/8): '+lastError);
  if(attempt<8)await new Promise(resolve=>setTimeout(resolve,9000));
 }
}
if(!verified)throw Error('Author pilot live verification failed: '+lastError);
console.log('VERIFIED NovelHaven author pilot live:',JSON.stringify({
 origin,publicAdFreeNoindexPages:pages.length,
 chapterDraftRecoveryAsset:true,editorTakedownClient:true,
 firebaseRulesActivation:'requires_owner_setup',
 advertisingApproval:'not_claimed'
}));
