import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chunkPath, estimatePublishedVolumes, planD1Capacity, projectedBytes,
  simulateShardPlan, writePlan, SOURCE_BUFFER_FACTOR,
} from './plan-d1-capacity.mjs';

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'novelhaven-capacity-'));
  const root = path.join(parent, 'dist');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const novels = [
    {id: 'alpha', title: 'Alpha', chapters: Array.from({ length: 3 }, (_, i) =>
      ({number:i+1, title:'Chapter '+(i+1)})),
    lazyChunks:{prefix:'data/alpha-chapters-', capacity:2, global:'ALPHA_CHAPTERS'}},
    {id: 'beta', title: 'Beta', chapters: [{number:1,title:'Chapter 1'}],
    lazyChunks:{prefix:'data/beta-chapters-', capacity:10, global:'BETA_CHAPTERS'}},
  ];
  fs.writeFileSync(path.join(root,'index.html'),
    '<script src="catalog.js"></script><script src="licensed-test.js"></script>');
  fs.writeFileSync(path.join(root, 'catalog.js'), 'window.NOVELS=[];');
  fs.writeFileSync(path.join(root,'licensed-test.js'),
    'window.NOVELS.push(' + novels.map(n=>JSON.stringify(n)).join(');window.NOVELS.push(') + ');');
  for (const novel of novels) {
    const count = Math.ceil(novel.chapters.length / novel.lazyChunks.capacity);
    for (let i=1;i<=count;i++) fs.writeFileSync(
      path.join(root,novel.lazyChunks.prefix+String(i).padStart(2,'0')+'.js'),
      'window.'+novel.lazyChunks.global+'=[{"paragraphs":["a test chapter"]}];');
  }
  return { root, cleanup:()=>fs.rmSync(parent,{recursive:true,force:true}) };
}

test('projects nonzero chapter footprint with explicit conservative buffer', () => {
  assert.equal(projectedBytes(0,1) > 0, true);
  assert.equal(projectedBytes(10000,5),
    Math.ceil(10000*SOURCE_BUFFER_FACTOR+5*256+1048576));
  assert.throws(()=>projectedBytes(-1,2),/Invalid source/);
  assert.throws(()=>projectedBytes(0,0),/Invalid chapter/);
});

test('restricts source files to published data chunks within dist', () => {
  assert.match(chunkPath('/tmp/site','data/my-chapters-',3),/my-chapters-03\.js$/);
  assert.throws(()=>chunkPath('/tmp/site','../secrets-',1),/Unsafe/);
  assert.throws(()=>chunkPath('/tmp/site','data/../../secrets-',1),/Unsafe/);
  assert.throws(()=>chunkPath('/tmp/site','data/chapters-',0),/Invalid chapter/);
});

test('enumerates published novels and counts exactly referenced chapter chunks', () => {
  const f=fixture();
  try {
    const volumes=estimatePublishedVolumes(f.root);
    assert.equal(volumes.length,2);
    assert.equal(volumes.find(v=>v.id==='alpha').chunk_files,2);
    assert.equal(volumes.find(v=>v.id==='beta').chunk_files,1);
    assert.equal(volumes.reduce((sum,v)=>sum+v.published_chapters,0),4);
    const report=planD1Capacity(f.root);
    assert.equal(report.published_novels,2);
    assert.equal(report.total_published_chapters,4);
    assert.equal(report.source_chunk_files,3);
    assert.equal(report.status,'ESTIMATE_ONLY_NO_DATABASES_CREATED');
    assert.equal(report.illustrative_shards_needed,1);
  } finally {f.cleanup();}
});

test('shard projection flags titles exceeding the target rather than claiming fit', () => {
  const volumes=[
    {id:'a',projected_d1_bytes:65,published_chapters:1},
    {id:'b',projected_d1_bytes:60,published_chapters:1},
    {id:'c',projected_d1_bytes:35,published_chapters:1},
  ];
  const plan=simulateShardPlan(volumes,{targetBytes:100,maxDatabases:2});
  assert.equal(plan.illustrative_shards_needed,2);
  assert.equal(plan.estimated_free_slots_sufficient,true);
  assert.equal(plan.illustrative_shards.reduce((s,b)=>s+b.novels,0),3);
  const large=simulateShardPlan([
    {id:'oversized',projected_d1_bytes:101,published_chapters:1}
  ],{targetBytes:100,maxDatabases:2});
  assert.deepEqual(large.books_over_single_shard_target,['oversized']);
  assert.equal(large.estimated_free_slots_sufficient,false);
});

test('writes a summary and report without any chapter text or Cloudflare action', () => {
  const f=fixture();
  try {
    const report=planD1Capacity(f.root);
    const out=path.join(path.dirname(f.root),'report.json');
    const summary=path.join(path.dirname(f.root),'summary.md');
    writePlan(report,{out,summary});
    assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')).published_novels,2);
    const md=fs.readFileSync(summary,'utf8');
    assert.match(md,/read-only/);
    assert.match(md,/no additional D1 databases were created/i);
    assert.doesNotMatch(md,/a test chapter/);
  } finally {f.cleanup();}
});
