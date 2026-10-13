import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadNovelCatalog, selectChapters, MAX_ROW_BYTES, readableChapterCount, deletedChapterNumbers} from './export-d1-batch.mjs';
import {createClients, planAssignments, indexExistingRows} from './sync-d1-sharded.mjs';
import {estimatePublishedVolumes} from './plan-d1-capacity.mjs';
import {SHARDS, ROUTING_SCHEMA} from '../cloudflare/d1/shards.mjs';
import {SOFT_LIMIT_BYTES,D1ApiError} from './sync-d1-chapters.mjs';

export const DAILY_BUDGET=80000; // Leave 20,000 writes for other account activity.
export const PRIOR_USAGE_RESERVE=10000; // Includes earlier importer activity and DDL.
export const MAX_READ_ROWS_PER_RUN=350000; // Guard the shared 5m/day free account allowance.
export const LEDGER_SCHEMA='CREATE TABLE IF NOT EXISTS migration_write_budget (day TEXT PRIMARY KEY, reserved INTEGER NOT NULL)';

// D1 bills by rows scanned (meta.rows_read), not only query results. Meter the
// existing client responses without logging SQL, source chapters, or tokens.
export function meterClients(clients) {
  const usage={rows_read:0,rows_written:0,metered_queries:0,unmetered_queries:0};
  const metered=new Map([...clients].map(([id,client])=>[id,{
    size:()=>client.size(),
    query:async (...args)=>{
      const reply=await client.query(...args);
      const read=reply?.meta?.rows_read,written=reply?.meta?.rows_written;
      if(Number.isSafeInteger(read)&&read>=0&&Number.isSafeInteger(written)&&written>=0){
        usage.rows_read+=read;usage.rows_written+=written;usage.metered_queries++;
        assert(Number.isSafeInteger(usage.rows_read)&&Number.isSafeInteger(usage.rows_written),
          'D1 usage counter overflow');
      } else usage.unmetered_queries++;
      return reply;
    }
  }]));
  return {clients:metered,usage};
}
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
export async function migrate({clients,root='dist',maxChapters=4000,log=console.log,
  usage=null,maxReadRows=MAX_READ_ROWS_PER_RUN}={}) {
  assert(Number.isSafeInteger(maxReadRows)&&maxReadRows>0,'Invalid per-run rows-read cap');
  assert(Number.isSafeInteger(maxChapters)&&maxChapters>0&&maxChapters<=10000,'Invalid run cap');
  const master=clients.get(SHARDS[0].id),sizes=new Map(),stats=new Map(),indexes=new Map();
  await master.query(LEDGER_SCHEMA);
  const today=new Date().toISOString().slice(0,10);
  const budget=(await master.query('SELECT reserved FROM migration_write_budget WHERE day=?',[today])).results;
  const novels=loadNovelCatalog(root);
  const deletedByNovel=new Map(novels.map(n=>[n.id,new Set(deletedChapterNumbers(n))]));
  const numberedSlots=novels.reduce((sum,n)=>sum+n.chapters.length,0);
  const readableTotal=novels.reduce((sum,n)=>sum+readableChapterCount(n),0);
  const report={verified:0,source_chapters:readableTotal,
    numbered_chapter_slots:numberedSlots,deleted_chapter_slots:numberedSlots-readableTotal,
    retired_d1_rows:null,total_stored:null,active_stored:null,historical_stored:null,
    remaining_chapters:null,stop_reason:'run_cap',cutover_ready:false};
  // Critical Free-tier guard: DO NOT repeatedly GROUP BY every imported chapter
  // every 20 minutes once the daily write budget is already used. Those scans
  // themselves consume the daily D1 rows-read quota and previously caused 400s.
  // Progress is deliberately unknown until the next safe full count, not invented.
  if(budget.length&&Number(budget[0].reserved)>=DAILY_BUDGET-100){
    report.stop_reason='daily_budget_reached';
    report.progress_stale=true;
    return report;
  }
  // Only scan shards when there is budget to do useful verified copying.
  // Reject cross-shard duplicates before reporting totals.
  for(const s of SHARDS){
    const client=clients.get(s.id);
    stats.set(s.id,(await client.query('SELECT novel_id,COUNT(*) AS stored,MIN(chapter_number) AS minimum,MAX(chapter_number) AS maximum FROM chapters GROUP BY novel_id')).results);
  }
  indexExistingRows(stats);
  report.total_stored=[...stats.values()].flat().reduce((sum,row)=>sum+Number(row.stored),0);
  assert(Number.isSafeInteger(report.total_stored)&&report.total_stored>=0,'Invalid D1 chapter counts');
  // Raw D1 totals include novels archived from the public catalog. Those rows
  // remain intact but cannot be counted as copies of an active chapter.
  for(const s of SHARDS){
    const client=clients.get(s.id);sizes.set(s.id,await client.size());
    const list=(await client.query('PRAGMA index_list(chapters)')).results;
    assert(Array.isArray(list)&&list.length<=4,'Unexpected chapter indexes');
    indexes.set(s.id,1+list.length);
    const triggers=(await client.query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='chapters'")).results;
    assert(triggers.length===0,'Unbudgeted chapter triggers');
  }
  await master.query(ROUTING_SCHEMA);
  const routes=new Map((await master.query('SELECT novel_id,database_id FROM novel_shards')).results.map(r=>[r.novel_id,r.database_id]));
  const {existing,pinned}=indexExistingRows(stats,routes);
  const retiredPresent=new Map();
  report.active_stored=0;report.retired_d1_rows=0;
  for(const novel of novels){
    const entry=existing.get(novel.id),existingStats=entry?.stats;
    if(!existingStats)continue;
    const count=Number(existingStats.stored);
    assert(Number.isSafeInteger(count)&&count>=0&&count<=novel.chapters.length,
      'Unexpected active chapter count: '+novel.id);
    assert(Number(existingStats.minimum)>=1&&Number(existingStats.maximum)<=novel.chapters.length,
      'Unexpected active chapter range: '+novel.id);
    // Already-stored deleted duplicates may remain in historical D1 rows. A
    // numbered tombstone must not masquerade as a readable chapter.
    const removed=deletedByNovel.get(novel.id),numbers=[...removed];
    let retired=0;
    if(numbers.length){
      const query='SELECT chapter_number FROM chapters WHERE novel_id=? AND chapter_number IN ('+
        numbers.map(()=>'?').join(',')+')';
      const rows=(await clients.get(entry.shardId).query(query,[novel.id,...numbers])).results;
      assert(rows.length<=numbers.length&&rows.every(row=>removed.has(Number(row.chapter_number))),
        'Invalid retired D1 chapter scan: '+novel.id);
      retired=rows.length;
    }
    retiredPresent.set(novel.id,retired);
    report.retired_d1_rows+=retired;
    report.active_stored+=count-retired;
  }
  assert(report.active_stored<=report.source_chapters,
    'More D1 chapters than readable source text; migration paused');
  report.historical_stored=report.total_stored-report.active_stored;
  assert(report.historical_stored>=0,'Inconsistent D1 inventory');
  report.remaining_chapters=report.source_chapters-report.active_stored;
  const forecast=planAssignments(estimatePublishedVolumes(root),pinned,sizes);
  outer: for(const novel of novels){
    // Pause between verified batches, never halfway through write+readback.
    if(usage && usage.rows_read>=maxReadRows){report.stop_reason='rows_read_budget_guard';break;}
    const shard=forecast.routes.get(novel.id),client=clients.get(shard);
    assert(client,'Unrecognized shard');
    const previous=existing.get(novel.id)?.stats;
    // Older pilots may have copied a complete novel before durable routes
    // existed. Repair only the route to its verified existing shard.
    if(previous&&!routes.has(novel.id)){
      if(!await reserveWrites(master,8)){report.stop_reason='daily_budget_reached';break;}
      await master.query('INSERT INTO novel_shards (novel_id,database_id) VALUES (?,?) ON CONFLICT(novel_id) DO NOTHING',[novel.id,shard]);
      const checked=(await master.query('SELECT database_id FROM novel_shards WHERE novel_id=?',[novel.id])).results;
      assert(checked.length===1&&checked[0].database_id===shard,'Shard route mismatch');routes.set(novel.id,shard);
    }
    const expectedReadable=readableChapterCount(novel),deleted=deletedByNovel.get(novel.id);
    const alreadyReadable=previous?Number(previous.stored)-(retiredPresent.get(novel.id)||0):0;
    if(previous&&alreadyReadable===expectedReadable)continue;
    const numbers=new Set((await client.query('SELECT chapter_number FROM chapters WHERE novel_id=? ORDER BY chapter_number',[novel.id])).results.map(r=>Number(r.chapter_number)));
    for(let start=1;start<=novel.chapters.length;){
      if(deleted.has(start)||numbers.has(start)){start++;continue;}
      if(report.verified>=maxChapters)break outer;
      if(usage && usage.rows_read>=maxReadRows){report.stop_reason='rows_read_budget_guard';break outer;}
      const selected=selectChapters(root,novel,start,Math.min(25,maxChapters-report.verified,novel.chapters.length-start+1));
      const end=selected[selected.length-1].number;
      const chapters=selected.filter(c=>!c.removedDuplicate&&!numbers.has(c.number));
      if(chapters.length===0){start=end+1;continue;}
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
      const rows=(await client.query('SELECT chapter_number,title,paragraphs_json FROM chapters WHERE novel_id=? AND chapter_number>=? AND chapter_number<=? ORDER BY chapter_number',[novel.id,start,end])).results;
      verifyBatch(chapters,rows);
      for(const c of chapters)numbers.add(c.number);
      report.verified+=chapters.length;report.total_stored+=chapters.length;
      report.active_stored+=chapters.length;
      report.remaining_chapters=report.source_chapters-report.active_stored;start=end+1;
      if(report.verified%250===0)log('Verified migration progress: '+JSON.stringify(report));
    }
  }
  if(report.active_stored===report.source_chapters)report.stop_reason='copy_complete_full_audit_required';
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
  const meter=meterClients(createClients({token,accountId}));
  await accessAudit(token,accountId);
  let result;
  try { result=await migrate({clients:meter.clients,usage:meter.usage,
    maxChapters:Number(process.env.D1_FAST_LIMIT||4000),
    maxReadRows:Number(process.env.D1_ROWS_READ_LIMIT||MAX_READ_ROWS_PER_RUN)}); }
  catch(error){
    if(!(error instanceof D1ApiError) || error.kind!=='quota')throw error;
    // Cloudflare has exhausted its own daily quota. Stop without more database
    // queries and without claiming the reader is ready. Resume on a later run.
    result={verified:0,source_chapters:null,total_stored:null,remaining_chapters:null,
      stop_reason:'cloudflare_d1_quota_reached',cutover_ready:false,
      diagnostic:{status:error.status,code:error.code,kind:error.kind,
        shard:error.shard,operation:error.operation}};
    console.log('Cloudflare D1 Free quota reached; waiting for reset: '+JSON.stringify(result.diagnostic));
  }
  result.usage=meter.usage;
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT, 'copy_complete='+(result.stop_reason==='copy_complete_full_audit_required')+'\n'+'quota_hit='+(result.stop_reason==='cloudflare_d1_quota_reached'||result.stop_reason==='daily_budget_reached')+'\n');
  console.log('Fast migration result: '+JSON.stringify(result));
  if(process.env.D1_REPORT_PATH)fs.writeFileSync(process.env.D1_REPORT_PATH,JSON.stringify(result,null,2));
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Cloudflare migration\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\nLive site cutover remains blocked until a full content audit passes.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Migration paused safely:',String(e.message).slice(0,200));process.exitCode=1;});
