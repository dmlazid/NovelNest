import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditContent} from './audit-d1-content.mjs';
import {SHARDS} from '../cloudflare/d1/shards.mjs';

function fixture(t,count=101){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'d1-content-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const chapters=Array.from({length:count},(_,i)=>({number:i+1,title:'Chapter '+(i+1),paragraphs:['Original & <text> '+i,'Second paragraph']}));
  fs.writeFileSync(path.join(root,'index.html'),'<script src="catalog.js"></script>');
  fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS='+JSON.stringify([{id:'book',chapters,lazyChunks:{prefix:'chapters-',global:'CHAPTERS',capacity:25}}])+';');
  for(let i=0;i<count;i+=25)fs.writeFileSync(path.join(root,'chapters-'+String(i/25+1).padStart(2,'0')+'.js'),'window.CHAPTERS='+JSON.stringify(chapters.slice(i,i+25))+';');
  const stored=new Map(SHARDS.map(s=>[s.id,[]]));
  stored.set(SHARDS[0].id,chapters.map(c=>({novel_id:'book',chapter_number:c.number,title:c.title,paragraphs_json:JSON.stringify(c.paragraphs)})));
  const routes=[{novel_id:'book',database_id:SHARDS[0].id}];
  let bodyQueries=0;
  const clients=new Map(SHARDS.map(s=>[s.id,{query:async(sql,params=[])=>{
    assert.match(sql,/^SELECT /,'Audit must never write');
    if(sql.includes('FROM novel_shards'))return {results:routes};
    const all=stored.get(s.id);
    if(sql.includes('GROUP BY novel_id'))return {results:[...new Set(all.map(r=>r.novel_id))].map(novel_id=>{
      const numbers=all.filter(r=>r.novel_id===novel_id).map(r=>r.chapter_number);
      return {novel_id,stored:numbers.length,minimum:Math.min(...numbers),maximum:Math.max(...numbers)};
    })};
    bodyQueries++;
    return {results:all.filter(r=>r.novel_id===params[0]&&r.chapter_number>=params[1]&&r.chapter_number<=params[2]).sort((a,b)=>a.chapter_number-b.chapter_number)};
  }}]));
  return {root,clients,stored,routes,bodyQueries:()=>bodyQueries};
}
test('complete audit compares all pages without writing and does not authorize cutover',async t=>{
  const f=fixture(t),r=await auditContent({...f,log:()=>{}});
  assert.equal(r.full_audit_passed,true);assert.equal(r.verified_chapters,101);
  assert.equal(r.cutover_ready,false);assert.equal(f.bodyQueries(),2);assert.match(r.content_sha256,/^[a-f0-9]{64}$/);
});
test('incomplete copy stays pending without downloading chapter bodies',async t=>{
  const f=fixture(t);f.stored.get(SHARDS[0].id).pop();
  const r=await auditContent(f);assert.equal(r.status,'copy_pending');assert.equal(r.full_audit_passed,false);assert.equal(f.bodyQueries(),0);
});
test('matching counts cannot conceal changed text or titles',async t=>{
  const f=fixture(t,2);f.stored.get(SHARDS[0].id)[1].paragraphs_json='["Changed"]';
  await assert.rejects(()=>auditContent(f),/Content mismatch/);
});
test('missing reader routes block a complete copy',async t=>{
  const f=fixture(t,2);f.routes.length=0;await assert.rejects(()=>auditContent(f),/reader route/);
});
test('out-of-range rows and copies on multiple shards are rejected',async t=>{
  const f=fixture(t,2),row=f.stored.get(SHARDS[0].id)[0];
  f.stored.get(SHARDS[1].id).push({...row});await assert.rejects(()=>auditContent(f),/multiple D1 shards/);
  f.stored.get(SHARDS[1].id).length=0;row.chapter_number=3;
  await assert.rejects(()=>auditContent(f),/Unexpected chapter range/);
});
