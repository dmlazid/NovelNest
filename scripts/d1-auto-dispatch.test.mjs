import test from 'node:test';
import assert from 'node:assert/strict';
import {selectD1Strategy,dispatchD1Sync} from './d1-auto-dispatch.mjs';

function main({exists=false,count=0,bad=false}={}){
  return {
    size:async()=>1024,
    query:async(sql)=>{
      if(sql.includes('sqlite_master'))return {
        results:bad?'unexpected':exists?[{name:'novel_shards'}]:[],
      };
      if(sql.startsWith('SELECT COUNT(*) AS total FROM novel_shards'))
        return{results:[{total:count}]};
      throw Error('Unexpected SQL '+sql);
    },
  };
}

test('uses legacy importer only before first durable route exists',async()=>{
  assert.equal(await selectD1Strategy(main()),'single');
  assert.equal(await selectD1Strategy(main({exists:true,count:0})),'single');
  assert.equal(await selectD1Strategy(main({exists:true,count:1})),'sharded');
});

test('fails closed if routing table cannot be verified',async()=>{
  await assert.rejects(()=>selectD1Strategy(main({bad:true})),
    /Cannot verify D1 routing table/);
});

test('single-DB import remains available before the five-shard pilot',async()=>{
  let single=0,multi=0;
  const result=await dispatchD1Sync({
    mainClient:main(),mode:'import',maxChapters:10,
    buildShardClients:()=>{throw Error('should not build five-shard clients')},
    singleSync:async({mode,maxChapters})=>{
      single++;assert.equal(mode,'import');assert.equal(maxChapters,10);
      return{inserted_chapters:10,total_chapters_in_d1:20,stop_reason:'limit'};
    },
    shardedSync:async()=>{multi++;throw Error('Unexpected sharded sync');},
  });
  assert.equal(single,1);assert.equal(multi,0);
  assert.equal(result.strategy,'single');
});

test('once a durable route exists, legacy writer can NEVER run',async()=>{
  let single=0,multi=0;
  const result=await dispatchD1Sync({
    mainClient:main({exists:true,count:1}),
    buildShardClients:()=>new Map([['key','shard']]),
    mode:'import',maxChapters:5,
    singleSync:async()=>{single++;throw Error('Legacy import must not be invoked');},
    shardedSync:async({clients,mode,maxChapters})=>{
      multi++;assert.equal(clients.get('key'),'shard');
      assert.equal(mode,'import');assert.equal(maxChapters,5);
      return{chapters_inserted:5,total_chapters:15,stop_reason:'limit'};
    },
  });
  assert.equal(single,0);assert.equal(multi,1);
  assert.equal(result.strategy,'sharded');
});

test('dry-run after activation stays read-only',async()=>{
  const result=await dispatchD1Sync({
    mainClient:main({exists:true,count:2}),
    mode:'plan',maxChapters:5,
    buildShardClients:()=>new Map(),
    singleSync:async()=>{throw Error('Legacy writer must not be called');},
    shardedSync:async({mode})=>{
      assert.equal(mode,'plan');
      return{chapters_inserted:0,total_chapters:9,stop_reason:'plan'};
    },
  });
  assert.equal(result.strategy,'sharded');
  assert.equal(result.mode,'plan');
});

test('invalid run modes and oversized batches are rejected',async()=>{
  await assert.rejects(()=>dispatchD1Sync({
    mainClient:main(),mode:'delete',buildShardClients:()=>new Map(),
  }),/plan or import/);
  await assert.rejects(()=>dispatchD1Sync({
    mainClient:main(),maxChapters:501,buildShardClients:()=>new Map(),
  }),/between 1 and 500/);
});
