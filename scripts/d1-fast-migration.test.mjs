import test from 'node:test';import assert from 'node:assert/strict';
import {insertBatch,verifyBatch,reserveWrites,DAILY_BUDGET,PRIOR_USAGE_RESERVE,meterClients,MAX_READ_ROWS_PER_RUN} from './d1-fast-migration.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {migrate} from './d1-fast-migration.mjs';
import {SHARDS} from '../cloudflare/d1/shards.mjs';
const chapter={number:1,title:"Chapter 1: It's safe",paragraphs:['A & B < C','"Quoted" text']};
test('batch uses at most 100 bound parameters and never interpolates chapter text',()=>{
 const b=insertBatch("novel's id",Array.from({length:25},(_,i)=>({...chapter,number:i+1})));
 assert.equal(b.params.length,100);assert(!b.sql.includes('Quoted'));assert.match(b.sql,/DO NOTHING$/);
 assert.throws(()=>insertBatch('x',Array(26).fill(chapter)),/1–25/);
});
test('a fully copied legacy novel gets its route without rereading or rewriting chapters',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'d1-complete-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'index.html'),'<script src="catalog.js"></script>');
 fs.mkdirSync(path.join(root,'data'));
 fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS='+JSON.stringify([{id:'book',title:'Book',chapters:[chapter],lazyChunks:{prefix:'data/book-chapters-',global:'CHAPTERS',capacity:25}}])+';');
 fs.writeFileSync(path.join(root,'data/book-chapters-01.js'),'window.CHAPTERS='+JSON.stringify([chapter])+';');
 let routed=false,reserved=0;
 const clients=new Map(SHARDS.map((s,i)=>[s.id,{size:async()=>16384,query:async(sql,p=[])=>{
  if(sql.startsWith('CREATE TABLE'))return {results:[]};
  if(sql.startsWith('SELECT reserved'))return {results:[]};
  if(sql.startsWith('SELECT novel_id,COUNT'))return {results:i===0?[{novel_id:'book',stored:1,minimum:1,maximum:1}]:[]};
  if(sql.startsWith('PRAGMA'))return {results:[{name:'primary_key'}]};
  if(sql.startsWith('SELECT name FROM sqlite_master'))return {results:[]};
  if(sql==='SELECT novel_id,database_id FROM novel_shards')return {results:[]};
  if(sql.startsWith('INSERT INTO migration_write_budget'))return {results:[]};
  if(sql.startsWith('UPDATE migration_write_budget')){reserved+=p[0];return {results:[{reserved}]};}
  if(sql.startsWith('INSERT INTO novel_shards')){assert.equal(p[1],SHARDS[0].id);routed=true;return {results:[]};}
  if(sql.startsWith('SELECT database_id FROM novel_shards'))return {results:routed?[{database_id:SHARDS[0].id}]:[]};
  throw Error('Unexpected scan or write: '+sql);
 }}]));
 const report=await migrate({clients,root});
 assert(routed);assert.equal(reserved,8);assert.equal(report.verified,0);assert.equal(report.total_stored,1);assert.equal(report.stop_reason,'copy_complete_full_audit_required');
});
test('historical D1 rows cannot mask an unfinished active chapter',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'d1-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data'));
 const chapters=[chapter,{...chapter,number:2,title:'Chapter 2'}];
 fs.writeFileSync(path.join(root,'index.html'),'<script src="catalog.js"></script>');
 fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS='+JSON.stringify([{id:'book',title:'Book',chapters,lazyChunks:{prefix:'data/book-chapters-',global:'CHAPTERS',capacity:25}}])+';');
 fs.writeFileSync(path.join(root,'data/book-chapters-01.js'),'window.CHAPTERS='+JSON.stringify(chapters)+';');
 const catalogStats=[{novel_id:'book',stored:1,minimum:1,maximum:1},{novel_id:'archived-only',stored:8,minimum:1,maximum:8}];
 let reserved=0,added=false,verified=false;
 const clients=new Map(SHARDS.map((shard,i)=>[shard.id,{size:async()=>1024,query:async(sql,p=[])=>{
   if(sql.startsWith('CREATE TABLE'))return {results:[]};
   if(sql.startsWith('SELECT reserved'))return {results:[]};
   if(sql.startsWith('SELECT novel_id,COUNT'))return {results:i===0?catalogStats:[]};
   if(sql.startsWith('PRAGMA'))return {results:[{name:'pk'}]};
   if(sql.startsWith('SELECT name FROM sqlite_master'))return {results:[]};
   if(sql==='SELECT novel_id,database_id FROM novel_shards')return {results:[{novel_id:'book',database_id:SHARDS[0].id}]};
   if(sql.startsWith('SELECT chapter_number FROM chapters'))return {results:[{chapter_number:1}]};
   if(sql.startsWith('UPDATE migration_write_budget')){reserved+=p[0];return {results:[{reserved}]};}
   if(sql.startsWith('INSERT INTO migration_write_budget'))return {results:[]};
   if(sql.startsWith('INSERT INTO chapters')){added=true;return {results:[],meta:{rows_written:1}};}
   if(sql.startsWith('SELECT chapter_number,title,paragraphs_json')){verified=true;return {results:[{chapter_number:2,title:'Chapter 2',paragraphs_json:JSON.stringify(chapter.paragraphs)}]};}
   throw Error('Unexpected D1 operation '+sql);
 }}]));
 const r=await migrate({clients,root,maxChapters:1});
 assert.equal(r.source_chapters,2);
 assert.equal(r.total_stored,10,'Historical D1 rows remain counted in global storage');
 assert.equal(r.historical_stored,8);
 assert.equal(r.active_stored,2);
 assert.equal(r.remaining_chapters,0);
 assert.equal(r.stop_reason,'copy_complete_full_audit_required');
 assert(added&&verified&&reserved>0);
 assert.equal(r.cutover_ready,false);
});
test('readback detects missing and corrupted paragraphs',()=>{
 const row={chapter_number:1,title:chapter.title,paragraphs_json:JSON.stringify(chapter.paragraphs)};
 verifyBatch([chapter],[row]);assert.throws(()=>verifyBatch([chapter],[]),/mismatch/);
 assert.throws(()=>verifyBatch([chapter],[{...row,paragraphs_json:'[]'}]),/mismatch/);
});
test('persistent reservations stop at daily budget and resume on UTC date change',async()=>{
 const days=new Map();const master={query:async(sql,p)=>{
  if(sql.startsWith('INSERT')){if(!days.has(p[0]))days.set(p[0],Number(p[1]));return {results:[]};}
  const [cost,day,,limit]=p;if(days.get(day)+cost>limit)return {results:[]};days.set(day,days.get(day)+cost);return {results:[{reserved:days.get(day)}]};
 }};
 assert.equal(await reserveWrites(master,DAILY_BUDGET-PRIOR_USAGE_RESERVE,'2026-10-08'),true);
 assert.equal(await reserveWrites(master,1,'2026-10-08'),false);
 assert.equal(await reserveWrites(master,100,'2026-10-09'),true);
});

test('quota-exhausted runs never rescan chapters or waste rows-read quota',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'d1-quota-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'index.html'),'<script src="catalog.js"></script>');
 fs.mkdirSync(path.join(root,'data'));
 const chapters=[chapter,{...chapter,number:2,title:'Chapter 2'}];
 fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS='+JSON.stringify([{id:'book',title:'Book',chapters,lazyChunks:{prefix:'data/book-chapters-',global:'CHAPTERS',capacity:25}}])+';');
 fs.writeFileSync(path.join(root,'data/book-chapters-01.js'),'window.CHAPTERS='+JSON.stringify(chapters)+';');
 let mutations=0,reads=0;
 const clients=new Map(SHARDS.map((shard,i)=>[shard.id,{
  size:async()=>{throw Error('Physical size probe is unnecessary when quota is exhausted');},
  query:async sql=>{
   if(sql.startsWith('CREATE TABLE'))return {results:[]};
   if(sql.startsWith('SELECT reserved'))return {results:[{reserved:DAILY_BUDGET}]};
   if(sql.startsWith('SELECT novel_id,COUNT')){reads++;return {results:i===0?[{novel_id:'book',stored:1,minimum:1,maximum:1}]:[]};}
   mutations++;throw Error('Quota-exhausted run attempted an unnecessary operation: '+sql);
  }
 }]));
 const report=await migrate({clients,root});
 assert.equal(report.source_chapters,2);
 assert.equal(report.total_stored,null);
 assert.equal(report.remaining_chapters,null);
 assert.equal(report.progress_stale,true);
 assert.equal(report.stop_reason,'daily_budget_reached');
 assert.equal(report.cutover_ready,false);
 assert.equal(reads,0,'Expensive shard scans must be skipped after quota exhausted');
 assert.equal(mutations,0);
});

test('quota-exhausted runs do not claim full audit readiness without verification',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'d1-ready-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'index.html'),'<script src="catalog.js"></script>');
 fs.mkdirSync(path.join(root,'data'));
 fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS='+JSON.stringify([{id:'book',title:'Book',chapters:[chapter],lazyChunks:{prefix:'data/book-chapters-',global:'CHAPTERS',capacity:25}}])+';');
 fs.writeFileSync(path.join(root,'data/book-chapters-01.js'),'window.CHAPTERS='+JSON.stringify([chapter])+';');
 const clients=new Map(SHARDS.map((shard,i)=>[shard.id,{
  size:async()=>{throw Error('Unexpected size probe');},
  query:async sql=>{
   if(sql.startsWith('CREATE TABLE'))return {results:[]};
   if(sql.startsWith('SELECT reserved'))return {results:[{reserved:DAILY_BUDGET}]};
   if(sql.startsWith('SELECT novel_id,COUNT'))return {results:i===0?[{novel_id:'book',stored:1,minimum:1,maximum:1}]:[]};
   throw Error('Read-only path attempted an unexpected database operation: '+sql);
  }
 }]));
 const report=await migrate({clients,root});
 assert.equal(report.total_stored,null);
 assert.equal(report.remaining_chapters,null);
 assert.equal(report.stop_reason,'daily_budget_reached');
 assert.equal(report.cutover_ready,false,'Only a full verified content audit can ever authorize cutover');
});

test('D1 client usage meter records scanned and written rows without changing query results',async()=>{
 const client={size:async()=>1000,query:async sql=>({
   results:[{ok:true}],meta:sql==='first'?{rows_read:111,rows_written:2}:{rows_read:90,rows_written:0}
 })};
 const {clients,usage}=meterClients(new Map([['db',client]]));
 assert.equal(await clients.get('db').size(),1000);
 assert.deepEqual((await clients.get('db').query('first')).results,[{ok:true}]);
 await clients.get('db').query('second');
 assert.deepEqual(usage,{rows_read:201,rows_written:2,metered_queries:2,unmetered_queries:0});
 assert.equal(MAX_READ_ROWS_PER_RUN,350000);
});
test('missing Cloudflare usage metadata remains visible rather than inventing zeros',async()=>{
 const {clients,usage}=meterClients(new Map([['db',{
  size:async()=>42,query:async()=>({results:[]})
 }]]));
 await clients.get('db').query('ignored');
 assert.equal(usage.unmetered_queries,1);
 assert.equal(usage.metered_queries,0);
});
test('rows-read cap stops after inventory before starting any chapter write',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'d1-budget-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data'));
 const chapters=[chapter,{...chapter,number:2,title:'Chapter 2'}];
 fs.writeFileSync(path.join(root,'index.html'),'<script src="catalog.js"></script>');
 fs.writeFileSync(path.join(root,'catalog.js'),'window.NOVELS='+JSON.stringify([{id:'book',title:'Book',chapters,lazyChunks:{prefix:'data/book-chapters-',global:'CHAPTERS',capacity:25}}])+';');
 fs.writeFileSync(path.join(root,'data/book-chapters-01.js'),'window.CHAPTERS='+JSON.stringify(chapters)+';');
 let inserts=0;
 const raw=new Map(SHARDS.map((shard,i)=>[shard.id,{size:async()=>1000,query:async(sql)=>{
   if(sql.startsWith('CREATE TABLE')||sql.startsWith('INSERT INTO migration_write_budget'))return {results:[],meta:{rows_read:0,rows_written:0}};
   if(sql.startsWith('SELECT reserved'))return {results:[],meta:{rows_read:0,rows_written:0}};
   if(sql.startsWith('SELECT novel_id,COUNT'))return {results:[],meta:{rows_read:i===0?400:0,rows_written:0}};
   if(sql.startsWith('PRAGMA'))return {results:[{name:'pk'}],meta:{rows_read:1,rows_written:0}};
   if(sql.startsWith('SELECT name FROM sqlite_master'))return {results:[],meta:{rows_read:0,rows_written:0}};
   if(sql==='SELECT novel_id,database_id FROM novel_shards')return {results:[],meta:{rows_read:0,rows_written:0}};
   if(sql.startsWith('INSERT INTO chapters')){inserts++;throw Error('Unexpected chapter insert');}
   throw Error('Unexpected SQL: '+sql);
 }}]));
 const {clients,usage}=meterClients(raw);
 const r=await migrate({clients,usage,root,maxReadRows:300});
 assert.equal(r.stop_reason,'rows_read_budget_guard');
 assert.equal(r.verified,0);
 assert.equal(r.remaining_chapters,2);
 assert.equal(inserts,0);
 assert(usage.rows_read>=400);
});
