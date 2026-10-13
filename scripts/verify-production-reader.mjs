import assert from 'node:assert/strict';
import fs from 'node:fs';

// Read-only diagnosis. It never changes Cloudflare, DNS, D1, or the AdSense account.
export function classifyLiveResponses(items) {
  const build = items['/build-info.json'];
  const catalog = items['/sitemaps/catalog.xml'];
  const chapter = items['/novel/shadow-slave/chapter-1/'];
  const hidden = items['/novel/supreme-harem-god-system/'];
  const ads = items['/ads.txt'];
  const expectedAds = items.expectedAds;
  const isBuildInfo = build?.status === 200 &&
    /^\s*\{/.test(build.body) && /"chapters"\s*:/.test(build.body);
  const isXmlSitemap = catalog?.status === 200 &&
    /<urlset\b/.test(catalog.body) && catalog.body.includes('novelhaven.top');
  const realChapter = chapter?.status === 200 &&
    /data-static-chapter=/.test(chapter.body) && /<p[^>]*>[^<]+/.test(chapter.body);
  const hiddenNoindex = hidden?.status === 200 &&
    /\bnoindex\b/i.test(hidden.headers?.['x-robots-tag']||'') ||
    hidden?.status === 200 && /<meta[^>]*name="robots"[^>]*noindex/i.test(hidden.body);
  const hiddenPublisherScript = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/.test(hidden?.body||'');
  const adsUntouched = ads?.status === 200 && ads.body.trim() === expectedAds.trim();
  const output = {
    generated_build_info_is_json:!!isBuildInfo,
    generated_catalog_is_xml:!!isXmlSitemap,
    chapter_is_server_rendered:!!realChapter,
    restricted_novel_is_noindex:!!hiddenNoindex,
    restricted_novel_includes_adsense_script:!!hiddenPublisherScript,
    ads_txt_preserved:!!adsUntouched,
  };
  output.production_ready = output.generated_build_info_is_json &&
    output.generated_catalog_is_xml && output.chapter_is_server_rendered &&
    output.restricted_novel_is_noindex && !output.restricted_novel_includes_adsense_script &&
    output.ads_txt_preserved;
  return output;
}

async function get(origin, route) {
  try {
    const r = await fetch(origin+route,{
      signal:AbortSignal.timeout(16000),redirect:'follow',headers:{'Cache-Control':'no-cache'}
    });
    const body = await r.text();
    return {status:r.status,body,headers:{'x-robots-tag':r.headers.get('x-robots-tag')||''}};
  } catch(e) {return {status:0,body:'',headers:{},error:String(e.message).slice(0,140)};}
}
async function pagesSettings(token,accountId) {
  if(!token||!accountId) return {status:'credentials_missing'};
  try {
    const u='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(accountId)+'/pages/projects/novelnest';
    const r=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(16000)});
    const json=await r.json();
    if(!r.ok||!json.success) return {status:'access_denied_or_project_not_found',http:r.status,
      codes:(json.errors||[]).map(e=>e.code).slice(0,4)};
    return {status:'ok',project:json.result?.name,
      build_command:json.result?.build_config?.build_command||null,
      output_directory:json.result?.build_config?.destination_dir||null,
      git_source:json.result?.source?.type||null};
  } catch(e){return {status:'unavailable',message:String(e.message).slice(0,120)};}
}
export async function diagnose({
  origin='https://novelhaven.top',
  publisherFile='dist/ads.txt',
  token=process.env.CLOUDFLARE_API_TOKEN,
  accountId=process.env.CLOUDFLARE_ACCOUNT_ID
}={}) {
  assert(new URL(origin).hostname==='novelhaven.top','Only the approved live domain may be audited');
  const routes=['/','/build-info.json','/sitemaps/catalog.xml',
    '/novel/shadow-slave/chapter-1/','/novel/supreme-harem-god-system/','/ads.txt'];
  const responses=await Promise.all(routes.map(route=>get(origin,route)));
  const items=Object.fromEntries(routes.map((route,i)=>[route,responses[i]]));
  items.expectedAds=fs.readFileSync(publisherFile,'utf8');
  const quality=classifyLiveResponses(items);
  const pages=await pagesSettings(token,accountId);
  const summary={checked_at:new Date().toISOString(),origin,quality,pages,
    http:Object.fromEntries(routes.map((route,i)=>[route,responses[i].status])),
    safe_to_switch_reader:false,
    blockers:[]};
  if(!quality.production_ready)summary.blockers.push('Cloudflare production is not serving fully verified crawlable reader/build files and policy-safe routes.');
  if(pages.status!=='ok')summary.blockers.push('Cloudflare Pages project settings cannot be checked or edited with the current GitHub secret. Verify Pages Read/Edit permissions for this Cloudflare account.');
  if(pages.status==='ok' && (pages.build_command!=='NOVELNEST_CLOUDFLARE=1 node scripts/build.mjs' ||
    !String(pages.output_directory||'').replace(/^\.\//,'').replace(/\/$/,'').endsWith('_cloudflare')))
    summary.blockers.push('Pages project build command or output differs from the generated package. Do not switch to the generated package until the D1 chapter audit and isolated preview pass.');
  return summary;
}

if(process.argv[1] && new URL('file://'+process.argv[1]).href===import.meta.url){
  diagnose().then(result=>{
    console.log('NovelHaven production readiness (read-only):',JSON.stringify(result,null,2));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### NovelHaven production verification\n\n\x60\x60\x60json\n'+JSON.stringify(result,null,2)+'\n\x60\x60\x60\n\nNo DNS, Pages, D1 or AdSense settings were changed.\n');
    if(!result.quality.production_ready || result.pages.status!=='ok')process.exitCode=1;
  }).catch(e=>{console.error('Read-only production verification unavailable:',String(e.message));process.exitCode=1;});
}
