import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadNovelCatalog,selectChapters} from './export-d1-batch.mjs';
import {htmlEscape} from '../cloudflare/reader/worker.mjs';

// Run only after a fresh, complete D1 paragraph-by-paragraph audit has passed.
// This probes the separate workers.dev preview, NEVER the live custom domain.
export function previewOrigin(value) {
  assert(typeof value==='string'&&value.trim(),'Missing isolated Cloudflare preview URL');
  const parsed=new URL(value.trim());
  assert(parsed.protocol==='https:','Preview must use HTTPS');
  assert(parsed.hostname.endsWith('.workers.dev')&&parsed.hostname!=='.workers.dev',
    'Refusing to smoke-test a custom/live domain');
  assert(!parsed.username&&!parsed.password&&!parsed.port,'Unexpected preview origin');
  return parsed.origin;
}

const origin=previewOrigin(process.env.CLOUDFLARE_PREVIEW_URL||'');
async function read(route) {
  const response=await fetch(origin+route,{
    signal:AbortSignal.timeout(20000),
    headers:{'Cache-Control':'no-cache'},
    redirect:'follow',
  });
  return {status:response.status,body:await response.text()};
}

const source=loadNovelCatalog('dist');
const novel=source.find(n=>n.chapters.length>=2)||source[0];
assert(novel&&novel.chapters.length,'No source chapter to verify');
const chapter=selectChapters('dist',novel,1,1)[0];
assert(chapter?.paragraphs?.length,'Missing source paragraphs for preview probe');
const root='/novel/'+encodeURIComponent(novel.id)+'/';

async function verify() {
  const [home,first,privateTemplate,unknown,ads,privacy]=await Promise.all([
    read('/'),read(root+'chapter-1/'),read('/_internal/chapter.html'),
    read('/novel/no-such-novel-for-verification/chapter-1/'),
    read('/ads.txt'),read('/privacy.html')
  ]);
  assert.equal(home.status,200,'Preview home failed');
  assert.match(home.body,/NovelHaven/,'Preview home missing branding');
  assert.equal(first.status,200,'Preview chapter failed');
  assert(first.body.includes('data-chapter-number="1"'),'Preview chapter number missing');
  assert(first.body.includes(htmlEscape(chapter.paragraphs[0])),'D1 preview paragraph differs from GitHub source');
  assert(first.body.includes('href="https://novelhaven.top'+root+'chapter-1/"'),'Canonical chapter URL changed');
  assert.equal(privateTemplate.status,404,'Private reader template exposed');
  assert.equal(unknown.status,404,'Unknown novel should not produce a chapter');
  assert.equal(ads.status,200,'Publisher ads.txt unavailable');
  assert.equal(ads.body.trim(),fs.readFileSync('dist/ads.txt','utf8').trim(),'Publisher ads.txt changed');
  assert.equal(privacy.status,200,'Privacy page unavailable');
  assert.match(privacy.body,/Privacy Policy/);
  console.log('Isolated Cloudflare preview verified: homepage, real D1 chapter text, canonical route, privacy, ads.txt and private routes.');
}

for(let attempt=1;attempt<=6;attempt++){
  try{await verify();break;}
  catch(error){
    if(attempt===6)throw error;
    console.warn('Preview propagation '+attempt+'/6: '+error.message+'; retrying in 10 seconds');
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
}
