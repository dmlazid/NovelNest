import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import readerWorker from '../cloudflare/reader/worker.mjs';

const baseNovels=[{id:'martial-god-asura',chapters:[{number:1,title:'First'}]},{id:'shadow-slave',chapters:[{number:1,title:'First'}]}];
test('reversible curation never removes novels or chapter data',()=>{
  const scope={window:{NOVELS:structuredClone(baseNovels)}};
  vm.runInNewContext(fs.readFileSync('dist/discovery-curation.js','utf8'),scope);
  assert.equal(scope.window.NOVELS.length,2);
  assert.equal(scope.window.NOVELS[0].discoveryHidden,true);
  assert.equal(scope.window.NOVELS[1].discoveryHidden,undefined);
  assert.equal(scope.window.NOVELNEST_DISCOVERY_EXCLUDED.length,10);
});

function fakeEnv(hidden){
  const book={title:'Reading history test',total:1,discoveryHidden:hidden};
  return {
    ASSETS:{async fetch(req){
      const path=new URL(req.url).pathname;
      if(path==='/_internal/novels.json')return new Response(JSON.stringify({curated:book}),{status:200});
      if(path==='/_internal/chapter.html')return new Response('<meta name="robots" content="index,follow,max-image-preview:large">CHAPTER_TITLE_TOKEN CHAPTER_URL_TOKEN CHAPTER_ROOT_TOKEN CHAPTER_BODY_TOKEN',{status:200});
      return new Response('not found',{status:404});
    }},
    DB1:{prepare(){return{bind(){return{async first(){return{database_id:'shard-a'}}}}}}},
    SHARD_BINDINGS:{'shard-a':'D1_CHAPTERS'},
    D1_CHAPTERS:{prepare(){return{bind(){return{async first(){return{title:'First',paragraphs_json:'["Readable chapter content"]'}}}}}}}
  };
}
test('curated Cloudflare chapter can still be opened but tells search engines not to index',async()=>{
  const request=new Request('https://novelhaven.top/novel/curated/chapter-1/');
  const result=await readerWorker.fetch(request,fakeEnv(true));
  assert.equal(result.status,200);
  assert.equal(result.headers.get('X-Robots-Tag'),'noindex, follow');
  const html=await result.text();
  assert.match(html,/name="robots" content="noindex,follow"/);
  assert.match(html,/Readable chapter content/);
});
test('uncurated novel chapters remain indexable',async()=>{
  const result=await readerWorker.fetch(new Request('https://novelhaven.top/novel/curated/chapter-1/'),fakeEnv(false));
  assert.equal(result.status,200);
  assert.equal(result.headers.has('X-Robots-Tag'),false);
  assert.match(await result.text(),/name="robots" content="index,follow,max-image-preview:large"/);
});

test('Cloudflare static route headers noindex all curated books but leave Shadow Slave visible',()=>{
  const headers=fs.readFileSync('dist/_headers','utf8');
  const scope={window:{NOVELS:[...baseNovels]}};
  vm.runInNewContext(fs.readFileSync('dist/discovery-curation.js','utf8'),scope);
  for(const id of scope.window.NOVELNEST_DISCOVERY_EXCLUDED){
    assert(headers.includes('/novel/'+id+'/\n  X-Robots-Tag: noindex, follow'));
    assert(headers.includes('/novel/'+id+'/*\n  X-Robots-Tag: noindex, follow'));
  }
  assert(!headers.includes('/novel/shadow-slave/'));
});
