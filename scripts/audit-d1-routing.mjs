#!/usr/bin/env node
/**
 * Read-only routing audit for the five NovelHaven D1 databases.
 * Existing rows are NEVER reassigned. This is a routing preview, not an
 * importer, a live Worker change, or a guarantee of physical SQLite sizes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Client, DATABASE_ID, SOFT_LIMIT_BYTES } from './sync-d1-chapters.mjs';
import { estimatePublishedVolumes, PLANNING_TARGET_BYTES } from './plan-d1-capacity.mjs';
import { CloudflareD1Inventory } from './audit-d1-account.mjs';

export const SHARDS = Object.freeze([
  ['novelhaven-chapters-01', DATABASE_ID],
  ['novelhaven-chapters-02', '8c83e79f-fef8-4ed6-bef4-c705929e31ab'],
  ['novelhaven-chapters-03', 'cdbbdf93-ef34-4721-98eb-b266676f2862'],
  ['novelhaven-chapters-04', '8ef219f7-00af-4b5e-8c65-ec2bb1f22993'],
  ['novelhaven-chapters-05', '6edf1c87-b1a8-45ad-a5f9-bc8e9248ce2b'],
]);

export function buildRoutingPreview(volumes, states) {
  assert(states.length === SHARDS.length, 'All five D1 databases must be verified');
  const seen = new Map();
  for (const s of states) {
    assert(SHARDS.some(([name,id])=>name===s.name&&id===s.uuid),
      'Unexpected D1 database in routing audit');
    assert(Number.isSafeInteger(s.bytes) && s.bytes >= 0, 'Invalid physical D1 size');
    assert(Array.isArray(s.rows), 'Missing chapter inventory');
    for (const r of s.rows) {
      assert(typeof r.novel_id === 'string' && r.novel_id.length, 'Invalid stored novel ID');
      assert(Number.isSafeInteger(Number(r.stored)) && Number(r.stored) >= 1,
        'Invalid stored chapter count');
      const ids=seen.get(r.novel_id)??[];
      ids.push(s.name);
      seen.set(r.novel_id,ids);
    }
  }
  const duplicates=[...seen].filter(([,names])=>names.length>1)
    .map(([novel_id,databases])=>({novel_id,databases}));
  const bins=states.map(s=>({
    name:s.name,uuid:s.uuid,physical_bytes:s.bytes,
    projected_additional_bytes:0,assigned_novels:[],
    existing_novel_count:s.rows.length,
  }));
  const unassigned=[];
  for (const v of [...volumes].sort((a,b)=>b.projected_d1_bytes-a.projected_d1_bytes||
    a.id.localeCompare(b.id))) {
    assert(typeof v.id==='string'&&v.id&&Number.isSafeInteger(v.projected_d1_bytes)&&
      v.projected_d1_bytes>=0,'Invalid published novel volume');
    const existing=seen.get(v.id);
    if (existing?.length) {
      // Preserve all pre-existing chapter locations. Mixed-shard novels need
      // a chapter-level index before assigning any new chapters.
      unassigned.push({novel_id:v.id,reason:'already_has_stored_chapters',
        databases:existing});
      continue;
    }
    const choices=bins.filter(b=>
      b.physical_bytes+b.projected_additional_bytes+v.projected_d1_bytes <=
      Math.min(PLANNING_TARGET_BYTES,SOFT_LIMIT_BYTES))
      .sort((a,b)=>
        (a.physical_bytes+a.projected_additional_bytes)-
        (b.physical_bytes+b.projected_additional_bytes)||
        a.name.localeCompare(b.name));
    if (!choices.length) {
      unassigned.push({novel_id:v.id,reason:'no_planning_capacity'});
      continue;
    }
    const selected=choices[0];
    selected.assigned_novels.push(v.id);
    selected.projected_additional_bytes+=v.projected_d1_bytes;
  }
  return {
    status:'READ_ONLY_ROUTING_PREVIEW_NO_WRITES',
    databases:bins,
    existing_novels_needing_stable_mapping:unassigned.filter(x=>
      x.reason==='already_has_stored_chapters').length,
    cross_database_existing_novels:duplicates,
    unassigned,
    all_novels_assigned:unassigned.length===0,
    note:'This is NOT a write map. Existing chapters remain in their current D1 '+
      'database. No D1 rows, GitHub Pages content, Worker or AdSense changed.',
  };
}

export async function auditRouting({
  token,accountId,fetchFn=fetch,volumes=estimatePublishedVolumes(),
}={}) {
  const inventory=new CloudflareD1Inventory({token,accountId,fetchFn});
  const all=await inventory.list();
  const states=[];
  for (const [name,uuid] of SHARDS) {
    assert(all.filter(db=>db.uuid===uuid&&db.name===name).length===1,
      'Expected provisioned D1 shard missing or mismatched: '+name);
    const client=new D1Client({token,accountId,databaseId:uuid,
      allowedDatabaseIds:SHARDS.map(x=>x[1]),fetchFn});
    const bytes=await client.size();
    const result=await client.query('SELECT novel_id, COUNT(*) AS stored FROM chapters GROUP BY novel_id');
    states.push({name,uuid,bytes,rows:result.results});
  }
  return buildRoutingPreview(volumes,states);
}

function writeReport(report) {
  const output=process.env.D1_ROUTING_PREVIEW_OUT;
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
    '### Five-database routing audit — read-only','',
    '| Database | Existing physical bytes | Proposed new novels |',
    '| --- | ---: | ---: |',
    ...report.databases.map(d=>'| '+d.name+' | '+d.physical_bytes+' | '+d.assigned_novels.length+' |'),
    '',
    '- Novels already stored that need stable mapping: '+
      report.existing_novels_needing_stable_mapping,
    '- Novels not yet safely assignable: '+report.unassigned.length,
    '- Cross-database novels already present: '+report.cross_database_existing_novels.length,
    '',
    '**Preview only. No chapters copied or reader routing changed.**','',
  ].join('\n'));
  console.log('D1 routing audit:',JSON.stringify({
    status:report.status,shards:report.databases.length,
    proposed_new_novels:report.databases.reduce((a,b)=>a+b.assigned_novels.length,0),
    existing_novels_needing_stable_mapping:report.existing_novels_needing_stable_mapping,
    unassigned:report.unassigned.length,
    cross_database_existing_novels:report.cross_database_existing_novels.length,
  }));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  auditRouting({token:process.env.CLOUDFLARE_API_TOKEN,
    accountId:process.env.CLOUDFLARE_ACCOUNT_ID})
    .then(writeReport).catch(e=>{
      console.error('D1 routing audit stopped:',e.message);
      process.exitCode=1;
    });
}
