// One-time guarded Cloudflare Pages project build correction.
// Uses only the Cloudflare token already stored as a GitHub Actions secret.
// No DNS, D1, account login, AdSense or user data mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
assert(token&&account,'Existing Cloudflare GitHub Action credentials must be configured');
const project='novelnest';
const buildCommand='node scripts/build-compatible-pages.mjs';
const projectUrl='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/pages/projects/'+project;
const api=async (url,options={})=>{
  const r=await fetch(url,{
    ...options,headers:{Authorization:'Bearer '+token,...options.headers},
    signal:AbortSignal.timeout(30000)
  });
  let payload;
  try{payload=await r.json()}catch{throw Error('Cloudflare API returned an unreadable status '+r.status)}
  if(!r.ok||!payload.success)throw Error('Cloudflare API status '+r.status+
    ': codes '+JSON.stringify((payload.errors||[]).map(e=>e.code)));
  return payload.result;
};
const before=await api(projectUrl);
assert.equal(before.name,project,'Wrong Pages project');
assert.equal(before.source?.type,'github','Pages must keep its original Git integration');
assert.equal(before.source?.config?.repo_name?.toLowerCase(),'novelnest','Unexpected GitHub repository');
assert.equal(before.source?.config?.owner?.toLowerCase(),'dmlazid','Unexpected GitHub owner');
assert.equal(before.production_branch,'main','Unexpected production branch; refuse any change');
assert((before.domains||[]).includes('novelhaven.top'),'Pages project does not contain the expected custom domain');
assert.equal(before.build_config?.destination_dir,'dist','Do not switch the live output directory');
assert(!before.build_config?.root_dir||before.build_config.root_dir==='/'||before.build_config.root_dir==='.',
  'Unexpected Pages project source root');
const old=before.build_config?.build_command||null;
assert(old===null||old===buildCommand,'Refusing to replace a different custom build command');
if(old!==buildCommand){
  const after=await api(projectUrl,{method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({build_config:{build_command:buildCommand,destination_dir:'dist'}})});
  assert.equal(after.build_config?.build_command,buildCommand,'Pages did not store the expected build command');
  assert.equal(after.build_config?.destination_dir,'dist','Output directory unexpectedly changed');
  console.log('Verified Cloudflare Pages project now uses safe build command and the original dist output.');
}else console.log('Cloudflare Pages build configuration was already correct.');
// A separate git-branch deployment is used instead of changing DNS or the
// worker route. Existing production stays active until a build succeeds.
const postUrl=projectUrl+'/deployments';
const form=new FormData();
form.set('branch','main');
form.set('commit_dirty','false');
const deployment=await api(postUrl,{method:'POST',body:form});
console.log('Cloudflare Pages new production build requested:',JSON.stringify({
  id:deployment.id,environment:deployment.environment,
  stage:deployment.latest_stage?.name||null,status:deployment.latest_stage?.status||null
}));
const base='https://novelhaven.top';
const adsExpected=fs.readFileSync('dist/ads.txt','utf8').trim();
let result=null;
for(let attempt=1;attempt<=22;attempt++){
  await new Promise(resolve=>setTimeout(resolve,15000));
  try{
    const suffix='?review='+Date.now();
    const paths=['/build-info.json','/sitemaps/catalog.xml',
      '/novel/shadow-slave/','/novel/supreme-harem-god-system/','/ads.txt',
      '/app.js','/novel/shadow-slave/chapter-1/'];
    const response=await Promise.all(paths.map(async p=>{
      const r=await fetch(base+p+suffix,{headers:{'Cache-Control':'no-cache'},
        signal:AbortSignal.timeout(14000)});
      return {status:r.status,text:await r.text()};
    }));
    const [build,sitemap,novel,hidden,ads,app,chapter]=response;
    const verified=build.status===200 &&
      JSON.parse(build.text).mode==='compatible-spa-with-static-details' &&
      sitemap.status===200&&/<urlset\b/.test(sitemap.text)&&
      novel.status===200&&/<main id="main" class="wrap" tabindex="-1">/.test(novel.text)&&
      /https:\/\/novelhaven\.top\/novel\/shadow-slave\//.test(novel.text)&&
      hidden.status===200&&/name="robots" content="noindex,follow"/.test(hidden.text)&&
      !/pagead2\.googlesyndication\.com/.test(hidden.text)&&
      ads.status===200&&ads.text.trim()===adsExpected&&
      app.status===200&&app.text.includes('latestOngoingReleases')&&
      chapter.status===200&&chapter.text.includes('app.js');
    if(verified){result={verified:true,attempt,build_mode:'compatible-spa-with-static-details',
      chapter_backend:'existing SPA (D1 cutover disabled)',ads_txt_preserved:true};
      break;}
    console.log('Waiting for corrected public deployment (check '+attempt+'/22)');
  }catch(e){console.log('Live deploy still unverified on check '+attempt+'/22: '+String(e.message).slice(0,150));}
}
if(!result)throw Error('Cloudflare Pages project configuration updated, but the live domain has not yet passed all checks; no D1/DNS changes were made.');
console.log('Verified live NovelHaven deployment:',JSON.stringify(result));
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '### NovelHaven Cloudflare Pages release\n\n'+
  'Verified the compatible HTML build on **novelhaven.top** without switching D1. '+
  'Existing account, bookmarked reading, page design and ads.txt remain untouched.\n');
