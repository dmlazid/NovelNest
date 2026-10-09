// Read-only production-host diagnosis. Never prints secrets or modifies deployments.
const home='https://novelhaven.top/';
const urls=[home,'https://novelhaven.top/akk-novels/','https://novelnest.pages.dev/','https://dmlazid.github.io/NovelNest/'];
const limitedFetch=async (url,headers={})=>{
  try {
    const response=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(18000)});
    const body=await response.text();
    return {url,status:response.status,finalUrl:response.url,server:response.headers.get('server'),
      contentType:response.headers.get('content-type'),via:response.headers.get('via'),
      cfRayPresent:!!response.headers.get('cf-ray'),githubServedBy:response.headers.get('x-served-by'),
      title:body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||null,
      akkSpotlight:body.includes('AkkNovel Spotlight'),
      akkCollectionLink:body.includes('akk-novels'),
      bytes:body.length};
  }catch(error){return {url,error:String(error.message||error).slice(0,180)}}
};
const api=async path=>{
  const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
  if(!token||!account)return {status:'Cloudflare credentials not configured'};
  const url='https://api.cloudflare.com/client/v4/'+path.replace('{account}',encodeURIComponent(account));
  try {
    const r=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(16000)});
    const data=await r.json();
    return {http:r.status,success:data.success,errors:(data.errors||[]).map(e=>({code:e.code,message:e.message})),
      result:data.result};
  }catch(e){return {error:String(e.message||e).slice(0,180)}}
};
const pages=(await api('accounts/{account}/pages/projects/novelnest'));
const deployments=pages.success?await api('accounts/{account}/pages/projects/novelnest/deployments?per_page=5'):{skipped:'Project inaccessible or not found'};
const ghPages=await limitedFetch('https://api.github.com/repos/dmlazid/NovelNest/pages',{'Accept':'application/vnd.github+json','User-Agent':'NovelHaven-Host-Audit'});
const live=await Promise.all(urls.map(url=>limitedFetch(url)));
const newest=(deployments.result||[]).slice(0,5).map(d=>({id:d.id,url:d.url,
    environment:d.environment,created_on:d.created_on,project_name:d.project_name,
    latest_stage:d.latest_stage?{name:d.latest_stage.name,status:d.latest_stage.status}:null,
    deployment_trigger:d.deployment_trigger?{type:d.deployment_trigger.type,metadata:{branch:d.deployment_trigger.metadata?.branch,commit_hash:d.deployment_trigger.metadata?.commit_hash}}:null}));
const result={
  checked_at:new Date().toISOString(),live,
  cloudflare:{project_access:{http:pages.http,success:pages.success,errors:pages.errors},
    project:pages.success?{name:pages.result?.name,subdomain:pages.result?.subdomain,
      production_branch:pages.result?.production_branch,source_type:pages.result?.source?.type,
      git_repository:pages.result?.source?.config?.repo_name,
      build_config:pages.result?.build_config?{build_command:pages.result.build_config.build_command,destination_dir:pages.result.build_config.destination_dir}:null,
      latest_deployment:pages.result?.latest_deployment?{url:pages.result.latest_deployment.url,created_on:pages.result.latest_deployment.created_on,
        status:pages.result.latest_deployment.latest_stage?.status}:null}:null,
    deployments_access:{http:deployments.http,success:deployments.success,errors:deployments.errors},recent_deployments:newest},
  github_pages:{http:ghPages.status,error:ghPages.error,body:ghPages.title}
};
console.log('NovelHaven hosting check:',JSON.stringify(result,null,2));
if(process.env.GITHUB_STEP_SUMMARY){
 const fs=await import('node:fs');
 const rows=live.map(v=>'- '+v.url+': '+(v.error?'Error: '+v.error:'HTTP '+v.status+' | AkkNovel Spotlight: '+v.akkSpotlight+' | collection link: '+v.akkCollectionLink));
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
  '### Production deployment diagnosis','',...rows,'',
  '- Cloudflare Pages project found: '+!!pages.success,
  '- Latest Cloudflare Pages deployment: '+(pages.result?.latest_deployment?.url||'unknown'),
  '- Cloudflare Pages build source: '+(pages.result?.source?.type||'unknown'),
  '- Cloudflare Pages production branch: '+(pages.result?.production_branch||'unknown'),'',
  'Only read-only checks were performed. No DNS, AdSense, hosting, or database settings were changed.',''
 ].join('\n'));
}
