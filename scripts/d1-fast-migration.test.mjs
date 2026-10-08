import test from 'node:test';import assert from 'node:assert/strict';
import {insertBatch,verifyBatch,reserveWrites,DAILY_BUDGET,PRIOR_USAGE_RESERVE} from './d1-fast-migration.mjs';
const chapter={number:1,title:"Chapter 1: It's safe",paragraphs:['A & B < C','"Quoted" text']};
test('batch uses at most 100 bound parameters and never interpolates chapter text',()=>{
 const b=insertBatch("novel's id",Array.from({length:25},(_,i)=>({...chapter,number:i+1})));
 assert.equal(b.params.length,100);assert(!b.sql.includes('Quoted'));assert.match(b.sql,/DO NOTHING$/);
 assert.throws(()=>insertBatch('x',Array(26).fill(chapter)),/1–25/);
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
