import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadNovelCatalog, selectChapters, MAX_ROW_BYTES} from './export-d1-batch.mjs';
import {createClients, planAssignments, indexExistingRows} from './sync-d1-sharded.mjs';
import {estimatePublishedVolumes} from './plan-d1-capacity.mjs';
import {SHARDS, ROUTING_SCHEMA} from '../cloudflare/d1/shards.mjs';
import {SOFT_LIMIT_BYTES} from './sync-d1-chapters.mjs';

export const DAILY_BUDGET=80000; // Leave 20,000 writes for other account activity.
export const PRIOR_USAGE_RESERVE=10000; // Includes earlier importer activity and DDL.
export const LEDGER_SCHEMA='CREATE TABLE IF NOT EXISTS migration_write_budget (day TEXT PRIMARY KEY, reserved INTEGER NOT NULL)';
export function insertBatch(novelId, chapters) {
  assert(chapters.length>0 && chapters.length<=25,'Batch must contain 1–25 chapters');
  const params=[];
  for(const c of chapters){
    assert(Number.isSafeInteger(c.number)&&c.number>0&&typeof c.title==='string'&&c.title.trim(),'Invalid chapter metadata');
    assert(Array.isArray(c.paragraphs)&&c.paragraphs.length&&c.paragraphs.every(p=>typeof p==='string'&&p.trim()),'Invalid paragraphs');
    const body=JSON.stringify(c.paragraphs);
    assert(Buffer.byteLength(body)+Buffer.byteLength(c.title)+Buffer.byteLength(novelId)<MAX_ROW_BYTES,'Chapter exceeds safe row size');
    params.push(novelId,c.number,c.title,body);
  }
  return {sql:'INSERT INTO chapters (novel_id,chapter_number,title,paragraphs_json) VALUES '+chapters.map(()=>'(?,?,?,?)').join(',')+' ON CONFLICT(novel_id,chapter_number) DO NOTHING',params};
}
export function verifyBatch(chapters, rows) {
  const stored=new Map(rows.map(r=>[Number(r.chapter_number),r]));
  for(const c of chapters){const row=stored.get(c.number);assert(row&&row.title===c.title&&row.paragraphs_json===JSON.stringify(c.paragraphs),'Chapter readback mismatch at '+c.number);}
}
export async function reserveWrites(master,cost,day=new Date().toISOString().slice(0,10)) {
  assert(Number.isSafeInteger(cost)&&cost>0&&cost<DAILY_BUDGET,'Invalid write reservation');
  // Reserve BEFORE writing; interrupted jobs never refund uncertain writes.
  await master.query('INSERT INTO migration_write_budget (day,reserved) VALUES (?,?) ON CONFLICT(day) DO NOTHING',[day,PRIOR_USAGE_RESERVE]);
  const r=await master.query('UPDATE migration_write_budget SET reserved=reserved+? WHERE day=? AND reserved+?<=? RETURNING reserved',[cost,day,cost,DAILY_BUDGET]);
  assert(Array.isArray(r.results),'Invalid quota ledger response');
  return r.results.length===1;
}
export async function migrate({clients,root='dist',maxChapters=4000,log=console.log}={}) {
  assert(Number.isSafeInteger(maxChapters)&&maxChapters>0&&maxChapters<=10000,'Invalid run cap');
  const master=clients.get(SHARDS[0].id),sizes=new Map(),stats=new Map(),indexes=new Map();
  await master.query(LEDGER_SCHEMA);
  const today=new Date().toISOString().slice(0,10);
  const budget=(await master.query('SELECT reserved FROM migration_write_budget WHERE day=?',[today])).results;
  const report={verified:0,source_chapters:0,total_stored:0,stop_reason:'run_cap',cutover_ready:false};
  if(budget.length&&Number(budget[0].reserved)>=DAILY_BUDGET-100){report.stop_reason='daily_budget_reached';return report;}
  const novels=loadNovelCatalog(root);
  report.source_chapters=novels.reduce((s,n)=>s+n.chapters.length,0);
  for(const s of SHARDS){
    const client=clients.get(s.id);sizes.set(s.id,await client.size());
    stats.set(s.id,(await client.query('SELECT novel_id,COUNT(*) AS stored,MIN(chapter_number) AS minimum,MAX(chapter_number) AS maximum FROM chapters GROUP BY novel_id')).results);
    const list=(await client.query('PRAGMA index_list(chapters)')).results;
    assert(Array.isArray(list)&&list.length<=4,'Unexpected chapter indexes');
    indexes.set(s.id,1+list.length);
    const triggers=(await client.query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='chapters'")).results;
    assert(triggers.length===0,'Unbudgeted chapter triggers');
  }
  await master.query(ROUTING_SCHEMA);
  const routes=new Map((await master.query('SELECT novel_id,database_id FROM novel_shards')).results.map(r=>[r.novel_id,r.database_id]));
  const {existing,pinned}=indexExistingRows(stats,routes);
  const forecast=planAssignments(estimatePublishedVolumes(root),pinned,sizes);
  report.total_stored=[...stats.values()].flat().reduce((s,r)=>s+Number(r.stored),0);
  outer: for(const novel of novels){
    const shard=forecast.routes.get(novel.id),client=clients.get(shard);
    assert(client,'Unrecognized shard');
    const numbers=new Set((await client.query('SELECT chapter_number FROM chapters WHERE novel_id=? ORDER BY chapter_number',[novel.id])).results.map(r=>Number(r.chapter_number)));
    for(let start=1;start<=novel.chapters.length;){
      if(numbers.has(start)){start++;continue;}
      if(report.verified>=maxChapters)break outer;
      const selected=selectChapters(root,novel,start,Math.min(25,maxChapters-report.verified,novel.chapters.length-start+1));
      const chapters=selected.filter(c=>!numbers.has(c.number));
      const batch=insertBatch(novel.id,chapters);
      const bytes=Buffer.byteLength(JSON.stringify(batch.params));
      const size=await client.size();
      if(size+Math.max(128*1024,bytes*4)>=SOFT_LIMIT_BYTES){report.stop_reason='shard_capacity_guard';break outer;}
      const reservation=chapters.length*indexes.get(shard)+8;
      if(!await reserveWrites(master,reservation)){report.stop_reason='daily_budget_reached';break outer;}
      if(!routes.has(novel.id)){
        await master.query('INSERT INTO novel_shards (novel_id,database_id) VALUES (?,?) ON CONFLICT(novel_id) DO NOTHING',[novel.id,shard]);
        const checked=(await master.query('SELECT database_id FROM novel_shards WHERE novel_id=?',[novel.id])).results;
        assert(checked.length===1&&checked[0].database_id===shard,'Shard route mismatch');routes.set(novel.id,shard);
      }
      const write=await client.query(batch.sql,batch.params);
      assert(Number.isFinite(Number(write.meta?.rows_written))&&Number(write.meta.rows_written)<=reservation,'Unexpected write accounting');
      const end=selected[selected.length-1].number;
      const rows=(await client.query('SELECT chapter_number,title,paragraphs_json FROM chapters WHERE novel_id=? AND chapter_number>=? AND chapter_number<=? ORDER BY chapter_number',[novel.id,start,end])).results;
      verifyBatch(chapters,rows);
      for(const c of chapters)numbers.add(c.number);
      report.verified+=chapters.length;report.total_stored+=chapters.length;start=end+1;
      if(report.verified%250===0)log('Verified migration progress: '+JSON.stringify(report));
    }
  }
  if(report.total_stored===report.source_chapters)report.stop_reason='copy_complete_full_audit_required';
  // Counts alone never authorize a public cutover. A complete content audit is required.
  return report;
}
export async function accessAudit(token,accountId){
  const checks={};
  for(const [name,url] of [
    ['worker_settings','https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/novelhaven-chapters-api/settings'],
    ['domain_zone','https://api.cloudflare.com/client/v4/zones?name=novelhaven.top']]){
    try{const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});checks[name]={http:r.status};if(r.ok){const d=await r.json();checks[name].success=d.success===true;if(name==='domain_zone')checks[name].found=Array.isArray(d.result)&&d.result.length>0;}}
    catch{checks[name]={unavailable:true};}
  }
  console.log('Read-only cutover access check: '+JSON.stringify(checks));
}
export async function main(){
  const token=process.env.CLOUDFLARE_API_TOKEN,accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
  const clients=createClients({token,accountId});
  await accessAudit(token,accountId);
  const result=await migrate({clients,maxChapters:Number(process.env.D1_FAST_LIMIT||4000)});
  console.log('Fast migration result: '+JSON.stringify(result));
  if(process.env.D1_REPORT_PATH)fs.writeFileSync(process.env.D1_REPORT_PATH,JSON.stringify(result,null,2));
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Cloudflare migration\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\nLive site cutover remains blocked until a full content audit passes.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Migration paused safely:',String(e.message).slice(0,200));process.exitCode=1;});
