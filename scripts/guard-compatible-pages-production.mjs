// Read-only guard for a direct Cloudflare Pages upload to the EXISTING live project.
// Never reconfigure DNS, Pages build settings, Workers, D1, or AdSense.
import assert from 'node:assert/strict';
const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
assert(token&&account,'Existing GitHub Actions Cloudflare secrets are required');
const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/pages/projects/novelnest';
const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200,'Could not read approved Cloudflare Pages project');
const payload=await response.json();
assert(payload.success&&payload.result,'Cloudflare Pages project unavailable');
const p=payload.result;
assert.equal(p.name,'novelnest','Unexpected Pages project');
assert.equal(p.production_branch,'main','Unexpected Pages production branch');
assert.equal(p.source?.type,'github','Unexpected Pages source type');
assert.equal(p.source?.config?.owner?.toLowerCase(),'dmlazid');
assert.equal(p.source?.config?.repo_name?.toLowerCase(),'novelnest');
assert((p.domains||[]).includes('novelhaven.top'),'Unknown or missing live domain');
assert.equal(p.build_config?.destination_dir,'dist','Unexpected Pages output folder');
assert.equal(p.build_config?.build_command,'node scripts/build-compatible-pages.mjs',
  'Unexpected Pages build command; refuse upload');
console.log('Approved existing Pages project, live domain, Git main and dist output; direct upload may proceed.');
