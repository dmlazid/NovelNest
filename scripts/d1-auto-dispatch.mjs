#!/usr/bin/env node
/**
 * NovelHaven automatic D1 migration switch.
 *
 * Before a user-approved multi-shard pilot establishes durable novel_shards
 * routes, continue the original single-DB scheduled import.
 * Once routes exist, ALWAYS use the five-shard importer. Never run the legacy
 * writer after multi-shard activation; doing so could duplicate novel data.
 *
 * No public Worker, DNS, Github Pages, source chapters or AdSense changes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  D1Client, DATABASE_ID, validateOptions, syncPublishedChapters,
} from './sync-d1-chapters.mjs';
import { createClients, syncSharded } from './sync-d1-sharded.mjs';

const ROUTE_TABLE_QUERY =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'novel_shards'";
const ROUTE_COUNT_QUERY = 'SELECT COUNT(*) AS total FROM novel_shards';

export async function selectD1Strategy(main) {
  assert(main?.query && main?.size, 'Missing existing main D1 client');
  const tables = (await main.query(ROUTE_TABLE_QUERY)).results;
  assert(Array.isArray(tables), 'Cannot verify D1 routing table status');
  if (!tables.length) return 'single';
  assert(tables.length === 1 && tables[0].name === 'novel_shards',
    'Unexpected D1 routing index; stopping import');
  const rows = (await main.query(ROUTE_COUNT_QUERY)).results;
  assert(Array.isArray(rows) && rows.length === 1,
    'Cannot verify durable D1 routes; stopping import');
  const count = Number(rows[0].total);
  assert(Number.isSafeInteger(count) && count >= 0,
    'Invalid D1 route count; stopping import');
  // During a failed/manual first pilot the table may exist but be empty.
  // Continue single-DB sync only if no novel was ever mapped to a new shard.
  return count > 0 ? 'sharded' : 'single';
}

export async function dispatchD1Sync({
  mainClient,
  buildShardClients,
  singleSync = syncPublishedChapters,
  shardedSync = syncSharded,
  mode = 'plan',
  maxChapters = 200,
  root = 'dist',
}={}) {
  ({mode,maxChapters}=validateOptions({mode,maxChapters}));
  const strategy=await selectD1Strategy(mainClient);
  const report=strategy==='sharded'
    ? await shardedSync({
      clients:buildShardClients(),root,mode,maxChapters,
    })
    : await singleSync({
      client:mainClient,root,mode,maxChapters,
    });
  assert(report && typeof report==='object', 'D1 sync returned no report');
  return {
    strategy,
    mode,
    status:'FINISHED_WITH_VERIFIED_D1_REPORT',
    report,
    note:'No public reader or AdSense files were modified.',
  };
}

function flagsFromArgs(argv) {
  assert(argv.length % 2 === 0, 'Expected --mode and --max-chapters');
  const flags={};
  for(let i=0;i<argv.length;i+=2){
    assert(/^--(?:mode|max-chapters)$/.test(argv[i]) && argv[i+1],
      'Unknown or missing D1 sync flag');
    flags[argv[i].slice(2)]=argv[i+1];
  }
  return validateOptions({
    mode:flags.mode,
    maxChapters:flags['max-chapters'],
  });
}

function appendSummary(output) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const r=output.report;
  const totals=output.strategy==='sharded'
    ? (r.database_totals ?? []).map(db=>
      '| '+db.database+' | '+db.chapters+' | '+db.bytes+' |')
    : [['novelhaven-chapters-01',r.total_chapters_in_d1,r.database_bytes_after]
      ].map(db=>'| '+db[0]+' | '+db[1]+' | '+db[2]+' |');
  const chapters=output.strategy==='sharded'?r.chapters_inserted:r.inserted_chapters;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
    '### NovelHaven automatic D1 chapter migration',
    '',
    '- Strategy: **'+output.strategy+'**',
    '- Mode: **'+output.mode+'**',
    '- Chapters copied during this run: **'+chapters+'**',
    '- Stop reason: '+r.stop_reason,
    '',
    '| Database | Stored chapters | Physical bytes |',
    '| --- | ---: | ---: |',
    ...totals,
    '',
    'Multi-shard mode activates only after an approved pilot saves a durable route. '+
    'The legacy importer will not run after multi-shard activation.',
    '',
    '**No website, Worker, domain, source chapter or AdSense change.**',
    '',
  ].join('\n'));
}

export async function main(argv=process.argv.slice(2)) {
  const options=flagsFromArgs(argv);
  const token=process.env.CLOUDFLARE_API_TOKEN;
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
  const mainClient=new D1Client({
    token,accountId,databaseId:DATABASE_ID,
  });
  const output=await dispatchD1Sync({
    mainClient,
    buildShardClients:()=>createClients({token,accountId}),
    ...options,
  });
  appendSummary(output);
  if(process.env.D1_REPORT_PATH){
    fs.writeFileSync(process.env.D1_REPORT_PATH,JSON.stringify(output,null,2)+'\n');
  }
  console.log('Automatic D1 migration:',JSON.stringify({
    strategy:output.strategy,mode:output.mode,
    imported:output.strategy==='sharded'?output.report.chapters_inserted:
      output.report.inserted_chapters,
    stored_total:output.strategy==='sharded'?output.report.total_chapters:
      output.report.total_chapters_in_d1,
    stop_reason:output.report.stop_reason,
  }));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{
    // Never log tokens, source chapter bodies or remote query responses.
    console.error('Automatic D1 migration safely paused:',
      String(e?.message??'Unknown verification error').slice(0,200));
    process.exitCode=1;
  });
}
