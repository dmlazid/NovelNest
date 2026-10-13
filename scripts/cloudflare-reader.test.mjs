import test from 'node:test';import assert from 'node:assert/strict';
import worker,{renderChapter} from '../cloudflare/reader/worker.mjs';
const template='<title>CHAPTER_TITLE_TOKEN</title><link rel="canonical" href="https://novelhaven.topCHAPTER_URL_TOKEN"><base href="CHAPTER_ROOT_TOKEN">CHAPTER_BODY_TOKEN';
test('reader preserves canonical, indexed position, paragraph text and navigation without injection',()=>{
 const html=renderChapter(template,{id:'test',title:'A & B',total:2,number:1,chapter:{title:'Chapter 1',paragraphs:['<script>evil()</script>',"It's safe"]}});
 assert.match(html,/https:\/\/novelhaven.top\/novel\/test\/chapter-1\//);assert.match(html,/data-chapter-number="1"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/chapter-2\//);
});
test('internal template is not public and missing migration returns an ad-free 503',async()=>{
 const blocked=await worker.fetch(new Request('https://novelhaven.top/_internal/chapter.html'),{});assert.equal(blocked.status,404);
 const unavailable=await worker.fetch(new Request('https://novelhaven.top/novel/a/chapter-1/'),{ASSETS:{fetch:async()=>new Response(JSON.stringify({a:{title:'A',total:1}}))},DB1:{prepare:()=>({bind:()=>({first:async()=>null})})},SHARD_BINDINGS:{}});
 assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/adsbygoogle/);
});

test('deleted duplicate chapter redirects to next real chapter without querying D1 or loading advertisements',async()=>{
 const metadata={book:{title:'Book',total:8,removedChapters:[5,6],duplicateChapters:[],discoveryHidden:false}};
 let dbTouched=false;
 const response=await worker.fetch(new Request('https://novelhaven.top/novel/book/chapter-5/'),{
   ASSETS:{fetch:async()=>new Response(JSON.stringify(metadata),{status:200})},
   DB1:{prepare:()=>{dbTouched=true;throw Error('Do not query D1 for removed chapters');}}
 });
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),'/novel/book/chapter-7/');
 assert.match(response.headers.get('x-robots-tag'),/noindex/);
 assert.equal(dbTouched,false);
 assert.equal(await response.text(),'');
});
