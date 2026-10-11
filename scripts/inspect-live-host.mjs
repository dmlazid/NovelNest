// Read-only production-host diagnosis. Never prints secrets or modifies deployments.
const home='https://novelhaven.top/';
const urls=[home,'https://novelhaven.top/app.js','https://novelhaven.top/app.js?v=20261008-clean-routes-2','https://novelhaven.top/app.js?v=20261010-original-featured-2','https://novelhaven.top/app.js?test=original-featured-20261010','https://novelhaven.top/styles.css','https://novelnest.pages.dev/','https://novelnest.pages.dev/app.js','https://dmlazid.github.io/NovelNest/'];
const limitedFetch=async (url,headers={})=>{
  try {
    const response=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(18000)});
    const body=await response.text();
    return {url,status:response.status,finalUrl:response.url,server:response.headers.get('server'),
      contentType:response.headers.get('content-type'),via:response.headers.get('via'),
      cfRayPresent:!!response.headers.get('cf-ray'),githubServedBy:response.headers.get('x-served-by'), cacheStatus:response.headers.get('cf-cache-status'), cacheControl:response.headers.get('cache-control'),etag:response.headers.get('etag'),
      title:body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||null,
      appAsset:body.match(/src="(app\.js[^\"]*)"/)?.[1]||null,
      cssAsset:body.match(/href="(styles\.css[^\"]*)"/)?.[1]||null,
      hasFeaturedSelection:body.includes('FEATURED_NOVEL_IDS'),
      homepageRotationVersion:body.includes('app.js?v=20261011-ongoing-random-home-1'),
      recentOngoingCode:body.includes('function latestOngoingReleases(')&&body.includes('function featuredNovels('),
      unwantedSourceBranding:/AkkNovel Spotlight|AkkNovel pick|More From AkkNovel|AkkNovel Collection|Explore all AkkNovel stories/.test(body),
      bytes:body.length,opening:response.url.includes('pages.dev')?body.slice(0,260).replace(/\\s+/g,' '):undefined};
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
// Detect whether the product-photo update has actually reached the public site.
// These probes are read-only, never contact Shopee, and do not touch AdSense.
const affiliatePublication=await (async()=>{
  const output={status:'unverified'};
  try {
    const [homeResponse,offerResponse,imageResponse]=await Promise.all([
      fetch(home,{redirect:'follow',signal:AbortSignal.timeout(16000)}),
      fetch('https://novelhaven.top/affiliate-offers.js',{redirect:'follow',signal:AbortSignal.timeout(16000)}),
      fetch('https://novelhaven.top/assets/affiliate-hero-sprite.webp',{redirect:'follow',signal:AbortSignal.timeout(16000)}),
    ]);
    const homepage=homeResponse.ok?await homeResponse.text():'';
    const offerCode=offerResponse.ok?await offerResponse.text():'';
    const image=imageResponse.ok?new Uint8Array(await imageResponse.arrayBuffer()):new Uint8Array();
    const imageIsWebp=image.length>=12&&String.fromCharCode(...image.slice(0,4))==='RIFF'&&
      String.fromCharCode(...image.slice(8,12))==='WEBP';
    const expectedCodes=['clo37p0','clo37pl','clo37pr','clo37q9','clo37qk'];
    const linksPresent=expectedCodes.every(code=>offerCode.includes('https://invl.me/'+code));
    const modernVersion=homepage.includes('affiliate-offers.js?v=20261011-photo-hero-1');
    const spriteReady=imageResponse.status===200&&imageIsWebp&&image.length>1024;
    const noRedirect=offerCode.includes('link.href = offer.url;')&&
      !/location\.(?:assign|replace)\s*\(|window\.open\s*\(/.test(offerCode);
    output.status=modernVersion&&spriteReady&&linksPresent&&noRedirect?'published':'not_yet_verified';
    output.home_status=homeResponse.status;
    output.offer_script_status=offerResponse.status;
    output.sprite_status=imageResponse.status;
    output.sprite_bytes=image.length;
    output.sprite_is_webp=imageIsWebp;
    output.photo_version_in_home=modernVersion;
    output.original_affiliate_links_present=linksPresent;
    output.click_only=!!noRedirect;
  }catch(error){output.status='check_failed';output.error=String(error?.message||error).slice(0,130)}
  return output;
})();
const result={
  checked_at:new Date().toISOString(),live,affiliatePublication,
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
 const rows=live.map(v=>'- '+v.url+': '+(v.error?'Error: '+v.error:'HTTP '+v.status+' | featured picks source code: '+v.hasFeaturedSelection+' | unwanted source-branding: '+v.unwantedSourceBranding));
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
  '### Production deployment diagnosis','',...rows,'',
  '- Homepage references rotating featured and ongoing-only release code: '+!!live[0]?.homepageRotationVersion,
  '- Live app includes ongoing release filter and randomized featured picks: '+!!live[1]?.recentOngoingCode,
  '- Affiliate photo cards published and fully verified: '+(affiliatePublication.status==='published'),
  '- Five Involve Asia purchase links intact: '+!!affiliatePublication.original_affiliate_links_present,
  '- Product sprite HTTP status: '+(affiliatePublication.sprite_status??'not checked'),
  '- Affiliate product-photo rollout: '+affiliatePublication.status,'',
  '- Cloudflare Pages project found: '+!!pages.success,
  '- Latest Cloudflare Pages deployment: '+(pages.result?.latest_deployment?.url||'unknown'),
  '- Cloudflare Pages build source: '+(pages.result?.source?.type||'unknown'),
  '- Cloudflare Pages production branch: '+(pages.result?.production_branch||'unknown'),'',
  'Only read-only checks were performed. No DNS, AdSense, hosting, or database settings were changed.',''
 ].join('\n'));
}
