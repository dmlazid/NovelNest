import test from 'node:test';
import assert from 'node:assert/strict';
import {SHARDS,buildRoutingPreview} from './audit-d1-routing.mjs';
const states=()=>SHARDS.map(([name,uuid])=>({name,uuid,bytes:16384,rows:[]}));
const book=(id,size)=>({id,projected_d1_bytes:size});
test('five-shard routing is read-only and assigns newly published novels',()=>{
  const r=buildRoutingPreview([book('a',2000),book('b',3000)],states());
  assert.equal(r.status,'READ_ONLY_ROUTING_PREVIEW_NO_WRITES');
  assert.equal(r.databases.length,5);
  assert.equal(r.databases.reduce((a,s)=>a+s.assigned_novels.length,0),2);
  assert.equal(r.unassigned.length,0);
});
test('existing novel is never reassigned or silently copied',()=>{
  const s=states();s[0].rows=[{novel_id:'a',stored:9}];
  const r=buildRoutingPreview([book('a',2000),book('b',3000)],s);
  assert.deepEqual(r.unassigned[0],{
    novel_id:'a',reason:'already_has_stored_chapters',databases:['novelhaven-chapters-01']
  });
  assert.equal(r.databases.reduce((a,s)=>a+s.assigned_novels.includes('a'),0),0);
});
test('detects cross-shard novels needing chapter-level routing',()=>{
  const s=states();s[0].rows=[{novel_id:'a',stored:1}];
  s[2].rows=[{novel_id:'a',stored:3}];
  const r=buildRoutingPreview([book('a',2000)],s);
  assert.equal(r.cross_database_existing_novels.length,1);
  assert.deepEqual(r.cross_database_existing_novels[0].databases,
    ['novelhaven-chapters-01','novelhaven-chapters-03']);
});
test('fails closed on unknown database and invalid inventory',()=>{
  const s=states();s[2].uuid='00000000-0000-0000-0000-000000000000';
  assert.throws(()=>buildRoutingPreview([],s),/Unexpected D1 database/);
  assert.throws(()=>buildRoutingPreview([],states().slice(1)),/All five/);
});
test('does not exceed conservative per-shard planning budget',()=>{
  const r=buildRoutingPreview([book('giant',500*1024*1024)],states());
  assert.equal(r.unassigned[0].reason,'no_planning_capacity');
  assert.equal(r.databases.reduce((a,s)=>a+s.assigned_novels.length,0),0);
});
