import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadNovelCatalog,selectChapters,readableChapterCount,deletedChapterNumbers} from './export-d1-batch.mjs';
import {createClients,indexExistingRows} from './sync-d1-sharded.mjs';
import {SHARDS} from '../cloudflare/d1/shards.mjs';

// Read-only: compare every title and paragraph, including chapters copied by
// older importers. Counts only decide whether the full comparison can begin.
export async function auditContent({clients,root='dist',log=console.log}={}) {
  const novels=loadNovelCatalog(root),catalog=new Map(novels.map(n=>[n.id,n]));
  assert(catalog.size===novels.length&&novels.length>0,'Invalid source catalog');
  const stats=new Map();
  for(const shard of SHARDS)stats.set(shard.id,(await clients.get(shard.id).query(
    'SELECT novel_id,COUNT(*) AS stored,MIN(chapter_number) AS minimum,MAX(chapter_number) AS maximum FROM chapters GROUP BY novel_id')).results);
  const rows=(await clients.get(SHARDS[0].id).query('SELECT novel_id,database_id FROM novel_shards')).results;
  const routes=new Map(rows.map(r=>[r.novel_id,r.database_id]));
  assert(routes.size===rows.length,'Duplicate novel routes');
  const {existing}=indexExistingRows(stats,routes);
  // Preserve and report older archived imports without allowing them to count
  // as current published chapters. The complete audit still checks every
  // paragraph of every active title and requires its verified reader route.
  const historicalIds=[...new Set([...routes.keys(),...existing.keys()])].filter(id=>!catalog.has(id));
  for(const [id,entry] of existing){
    const novel=catalog.get(id),s=entry.stats;
    if(!novel)continue;
    assert([s.stored,s.minimum,s.maximum].every(n=>Number.isSafeInteger(Number(n))), 'Invalid chapter statistics');
    assert(Number(s.minimum)>=1&&Number(s.maximum)<=novel.chapters.length&&Number(s.stored)<=novel.chapters.length,'Unexpected chapter range: '+id);
  }
  const removedByNovel=new Map(novels.map(n=>[n.id,new Set(deletedChapterNumbers(n))]));
  let retiredStored=0;
  // Older D1 imports might still hold the nine deleted duplicate bodies.
  // Detect only those exact numbered rows. They are not readable content and
  // are deliberately excluded from readiness and paragraph comparisons.
  for(const novel of novels){
    const removed=removedByNovel.get(novel.id),entry=existing.get(novel.id);
    if(!removed.size||!entry)continue;
    const numbers=[...removed];
    const query='SELECT chapter_number FROM chapters WHERE novel_id=? AND chapter_number IN ('+
      numbers.map(()=>'?').join(',')+')';
    const rows=(await clients.get(entry.shardId).query(query,[novel.id,...numbers])).results;
    assert(rows.every(row=>removed.has(Number(row.chapter_number)))&&rows.length<=numbers.length,
      'Unexpected stored tombstone lookup: '+novel.id);
    retiredStored+=rows.length;
  }
  const numberedSlots=novels.reduce((sum,n)=>sum+n.chapters.length,0);
  const deletedSlots=numberedSlots-novels.reduce((sum,n)=>sum+readableChapterCount(n),0);
  const sourceChapters=numberedSlots-deletedSlots;
  const totalStored=[...existing.values()].reduce((sum,e)=>sum+Number(e.stats.stored),0);
  const activeStored=novels.reduce((sum,n)=>sum+Number(existing.get(n.id)?.stats.stored||0),0)-retiredStored;
  assert(activeStored>=0&&activeStored<=sourceChapters,
    'Invalid readable D1 chapter count; refuse cutover');
  const report={source_chapters:sourceChapters,numbered_chapter_slots:numberedSlots,
    deleted_chapter_slots:deletedSlots,retired_d1_rows:retiredStored,
    total_stored:totalStored,active_stored:activeStored,historical_stored:totalStored-activeStored,
    historical_novels:historicalIds.length,remaining_chapters:sourceChapters-activeStored,
    verified_chapters:0,full_audit_passed:false,cutover_ready:false,
    status:'copy_pending',source_commit:process.env.GITHUB_SHA||null};
  if(report.remaining_chapters!==0)return report;
  const digest=createHash('sha256');
  for(const novel of novels){
    const entry=existing.get(novel.id);
    assert(routes.get(novel.id)===entry.shardId,'Missing or incorrect reader route: '+novel.id);
    const client=clients.get(entry.shardId);
    for(let start=1;start<=novel.chapters.length;start+=100){
      const end=Math.min(start+99,novel.chapters.length),expected=[];
      for(let n=start;n<=end;n+=25)expected.push(...selectChapters(root,novel,n,Math.min(25,end-n+1))
        .filter(chapter=>!chapter.removedDuplicate));
      if(!expected.length)continue;
      const raw=(await client.query('SELECT chapter_number,title,paragraphs_json FROM chapters WHERE novel_id=? AND chapter_number>=? AND chapter_number<=? ORDER BY chapter_number',[novel.id,start,end])).results;
      const removed=removedByNovel.get(novel.id);
      const stored=raw.filter(row=>!removed.has(Number(row.chapter_number)));
      assert(stored.length===expected.length,'Missing or duplicate readable chapters: '+novel.id+' #'+start);
      for(let i=0;i<expected.length;i++){
        const c=expected[i],r=stored[i];
        assert(Array.isArray(c.paragraphs)&&c.paragraphs.length&&c.paragraphs.every(p=>typeof p==='string'&&p.trim()),'Invalid source paragraphs');
        assert(Number(r.chapter_number)===c.number&&r.title===c.title&&r.paragraphs_json===JSON.stringify(c.paragraphs),'Content mismatch: '+novel.id+' #'+c.number);
        digest.update(JSON.stringify([novel.id,c.number,c.title,c.paragraphs])+'\n');
        report.verified_chapters++;
      }
    }
    log('Audited '+novel.id+': '+novel.chapters.length+' chapters');
  }
  assert(report.verified_chapters===report.source_chapters,'Incomplete content audit');
  return {...report,full_audit_passed:true,status:'content_verified',content_sha256:digest.digest('hex'),verified_at:new Date().toISOString()};
}
export async function main(){
  const report=await auditContent({clients:createClients({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID})});
  if(process.env.D1_AUDIT_REPORT)fs.writeFileSync(process.env.D1_AUDIT_REPORT,JSON.stringify(report,null,2)+'\n');
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'complete='+report.full_audit_passed+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Complete chapter comparison\n\n```json\n'+JSON.stringify(report,null,2)+'\n```\nContent verification alone does not switch the domain.\n');
  console.log('Full content audit: '+JSON.stringify(report));
  if(process.env.D1_AUDIT_REQUIRE_COMPLETE==='1')assert(report.full_audit_passed,'Copy is incomplete; deployment blocked');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Content audit blocked:',String(e.message).slice(0,200));process.exitCode=1;});
