import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createClients, planAssignments, indexExistingRows,
  syncSharded, parseFlags,
} from './sync-d1-sharded.mjs';
import { SHARDS } from '../cloudflare/d1/shards.mjs';

function sourceFixture() {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'novelhaven-five-d1-'));
  const root=path.join(home,'dist');
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  fs.writeFileSync(path.join(root,'index.html'),
    '<script src="catalog.js"></script><script src="licensed-fixture.js"></script>');
  fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS=[];');
  const books=[
    {id:'alpha',chapters:4},
    {id:'beta',chapters:2},
    {id:'original',chapters:3},
  ];
  const catalogs=[];
  for(const book of books){
    const global=book.id.toUpperCase()+'_CHAPTERS';
    const chapters=Array.from({length:book.chapters},(_,i)=>({
      number:i+1,title:'Chapter '+(i+1),
      paragraphs:['Published text '+book.id+' chapter '+(i+1),'Second original paragraph'],
    }));
    catalogs.push({
      id:book.id,title:book.id,chapters:chapters.map(c=>({
        number:c.number,title:c.title,paragraphs:['Loading chapter…'],lazy:true,
      })),
      lazyChunks:{prefix:'data/'+book.id+'-chapters-',capacity:25,global},
    });
    fs.writeFileSync(path.join(root,'data',book.id+'-chapters-01.js'),
      'window.'+global+'='+JSON.stringify(chapters)+';');
  }
  fs.writeFileSync(path.join(root,'licensed-fixture.js'),
    catalogs.map(n=>'window.NOVELS.push('+JSON.stringify(n)+');').join('\n'));
  return{root,cleanup:()=>fs.rmSync(home,{recursive:true,force:true})};
}

class FakeShard {
  constructor(id,{failReadback=false}={}){
    this.id=id;
    this.sizeBytes=16*1024;
    this.rows=new Map();
    this.routing=new Map();
    this.tableExists=false;
    this.writeCount=0;
    this.failReadback=failReadback;
  }
  async size(){return this.sizeBytes;}
  async query(sql,params=[]){
    if(sql.startsWith('SELECT novel_id, COUNT(*) AS stored,')){
      const grouped=new Map();
      for(const row of this.rows.values()){
        if(!grouped.has(row.novelId))grouped.set(row.novelId,[]);
        grouped.get(row.novelId).push(row.number);
      }
      return{results:[...grouped].map(([novel_id,numbers])=>({
        novel_id,stored:numbers.length,minimum:Math.min(...numbers),
        maximum:Math.max(...numbers),
      }))};
    }
    if(sql.startsWith('SELECT name FROM sqlite_master')){
      return{results:this.tableExists?[{name:'novel_shards'}]:[]};
    }
    if(sql==='SELECT novel_id, database_id FROM novel_shards'){
      assert(this.tableExists);
      return{results:[...this.routing].map(([novel_id,database_id])=>({novel_id,database_id}))};
    }
    if(sql.startsWith('CREATE TABLE IF NOT EXISTS novel_shards')){
      this.tableExists=true;
      return{results:[]};
    }
    if(sql.startsWith('INSERT INTO novel_shards')){
      assert(this.tableExists);
      const [novelId,shardId]=params;
      if(!this.routing.has(novelId))this.routing.set(novelId,shardId);
      return{results:[]};
    }
    if(sql==='SELECT database_id FROM novel_shards WHERE novel_id = ?'){
      return{results:this.routing.has(params[0])?
        [{database_id:this.routing.get(params[0])}]:[]};
    }
    if(sql.startsWith('SELECT chapter_number FROM chapters')){
      const [novelId]=params;
      return{results:[...this.rows.values()]
        .filter(r=>r.novelId===novelId)
        .map(r=>({chapter_number:r.number}))};
    }
    if(sql.startsWith('INSERT INTO chapters')){
      const [novelId,number,title,paragraphsJson]=params;
      const key=novelId+':'+number;
      if(!this.rows.has(key)){
        this.rows.set(key,{novelId,number:Number(number),title,paragraphsJson});
        this.writeCount++;
        this.sizeBytes+=Buffer.byteLength(paragraphsJson)+100;
      }
      return{results:[]};
    }
    if(sql.startsWith('SELECT title, paragraphs_json FROM chapters')){
      if(this.failReadback)return{results:[{title:'mismatch',paragraphs_json:'[]'}]};
      const row=this.rows.get(params[0]+':'+params[1]);
      return{results:row?[{title:row.title,paragraphs_json:row.paragraphsJson}]:[]};
    }
    if(sql.startsWith('SELECT COUNT(*) AS total,')){
      return{results:[{total:this.rows.size,
        novels:new Set([...this.rows.values()].map(r=>r.novelId)).size}]};
    }
    throw Error('Unexpected SQL in test: '+sql.slice(0,100));
  }
}

function clients(){
  const all=new Map(SHARDS.map(s=>[s.id,new FakeShard(s.id)]));
  const first=all.get(SHARDS[0].id);
  for(let i=1;i<=3;i++){
    const number=i;
    first.rows.set('original:'+i,{
      novelId:'original',number,title:'Chapter '+i,
      paragraphsJson:JSON.stringify(['Published text original chapter '+i,
        'Second original paragraph']),
    });
  }
  return all;
}

test('client factory only authorizes the five verified database IDs',()=>{
  const c=createClients({token:'private',accountId:'f'.repeat(32),
    fetchFn:async()=>{throw Error('unexpected fetch')}});
  assert.equal(c.size,5);
  assert.deepEqual([...c.keys()],SHARDS.map(s=>s.id));
});

test('route selection locks already-existing novel to original shard',()=>{
  const existing=indexExistingRows(new Map([
    [SHARDS[0].id,[{novel_id:'original',stored:3,minimum:1,maximum:3}]],
    ...SHARDS.slice(1).map(s=>[s.id,[]]),
  ]));
  assert.equal(existing.pinned.get('original'),SHARDS[0].id);
  const plan=planAssignments([
    {id:'original',projected_d1_bytes:100000},
    {id:'alpha',projected_d1_bytes:200000},
  ],existing.pinned,new Map(SHARDS.map(s=>[s.id,16384])));
  assert.equal(plan.routes.get('original'),SHARDS[0].id);
  assert.ok(SHARDS.some(s=>s.id===plan.routes.get('alpha')));
});

test('preview performs no writes, yet audits actual totals on five databases',async()=>{
  const fixture=sourceFixture();
  try{
    const all=clients();
    const report=await syncSharded({clients:all,root:fixture.root,mode:'plan',maxChapters:5});
    assert.equal(report.mode,'plan');
    assert.equal(report.chapters_inserted,0);
    assert.equal(report.total_chapters,3);
    assert.equal(report.database_totals.length,5);
    assert.equal(all.get(SHARDS[0].id).tableExists,false);
    assert.equal([...all.values()].reduce((sum,s)=>sum+s.writeCount,0),0);
  }finally{fixture.cleanup();}
});

test('import stores, verifies, persists routes, and resumes without duplicates',async()=>{
  const fixture=sourceFixture();
  try{
    const all=clients();
    const first=await syncSharded({clients:all,root:fixture.root,
      mode:'import',maxChapters:5});
    assert.equal(first.chapters_inserted,5);
    assert.equal(first.chapters_verified,5);
    assert.equal(first.total_chapters,8);
    const master=all.get(SHARDS[0].id);
    assert.equal(master.tableExists,true);
    assert.equal(master.routing.get('original'),undefined);
    assert.equal(master.rows.size,3);
    assert.equal(master.routing.size,2);
    assert.ok([...master.routing.values()].every(id=>SHARDS.some(s=>s.id===id)));
    const second=await syncSharded({clients:all,root:fixture.root,
      mode:'import',maxChapters:5});
    assert.equal(second.chapters_inserted,1);
    assert.equal(second.total_chapters,9);
    const again=await syncSharded({clients:all,root:fixture.root,
      mode:'import',maxChapters:5});
    assert.equal(again.chapters_inserted,0);
    assert.equal(again.total_chapters,9);
    assert.equal([...all.values()].reduce((sum,s)=>sum+s.writeCount,0),6);
    const {pinned}=indexExistingRows(new Map([...all].map(([id,s])=>[
      id,[...new Set([...s.rows.values()].map(r=>r.novelId))].map(novel_id=>
        ({novel_id,stored:1,minimum:1,maximum:1})),
    ])),master.routing);
    assert.equal(pinned.get('original'),SHARDS[0].id);
  }finally{fixture.cleanup();}
});

test('readback corruption fails closed without changing the original rows',async()=>{
  const fixture=sourceFixture();
  try{
    const all=clients();
    for(const s of [...all.values()].slice(1))s.failReadback=true;
    await assert.rejects(()=>syncSharded({clients:all,root:fixture.root,
      mode:'import',maxChapters:1}),/readback mismatch/);
    assert.equal(all.get(SHARDS[0].id).rows.size,3);
  }finally{fixture.cleanup();}
});

test('duplicate existing novel spread across databases triggers hard stop',async()=>{
  const fixture=sourceFixture();
  try{
    const all=clients();
    all.get(SHARDS[2].id).rows.set('original:1',{
      novelId:'original',number:1,title:'Chapter 1',paragraphsJson:'[]',
    });
    await assert.rejects(()=>syncSharded({clients:all,root:fixture.root,
      mode:'plan',maxChapters:1}),/multiple D1 shards/);
  }finally{fixture.cleanup();}
});

test('oversize whole-book estimate aborts before writing',()=>{
  assert.throws(()=>planAssignments([{
    id:'oversized',projected_d1_bytes:390*1024*1024,
  }]),/requires reviewed chapter-range routing/);
});

test('command flags require permitted mode and chapter cap',()=>{
  assert.deepEqual(parseFlags([]),{mode:'plan',maxChapters:25});
  assert.deepEqual(parseFlags(['--mode','import','--max-chapters','3']),
    {mode:'import',maxChapters:3});
  assert.throws(()=>parseFlags(['--mode','bad']),/plan or import/);
  assert.throws(()=>parseFlags(['--max-chapters','501']),/between 1 and 500/);
});
