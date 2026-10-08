import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ADDITIONAL_NAMES, CHAPTER_SCHEMA, provisioningPlan,
  prepareD1Shards, writeProvisioningReport,
} from './provision-d1-shards.mjs';
import { DATABASE_ID } from './sync-d1-chapters.mjs';

function fakeD1(existing = []) {
  const dbs = [
    {name:'novelhaven-chapters-01',uuid:DATABASE_ID},
    ...existing,
  ];
  const calls = [];
  const client = {
    base:'https://api.cloudflare.com/client/v4/accounts/a/d1/database',
    token:'not-for-publication',
    list:async()=>dbs.map(x=>({...x})),
    fetchFn:async(url,opts)=>{
      assert.equal(opts.headers.Authorization,'Bearer not-for-publication');
      assert.equal(opts.method,'POST');
      calls.push({url,body:JSON.parse(opts.body)});
      const body=JSON.parse(opts.body);
      if (url === client.base) {
        const n=dbs.length+1;
        const uuid='00000000-0000-0000-0000-'+String(n).padStart(12,'0');
        assert.equal(ADDITIONAL_NAMES.includes(body.name),true);
        assert.equal(dbs.some(db=>db.name===body.name),false);
        const created={name:body.name,uuid};
        dbs.push(created);
        return {ok:true,json:async()=>({success:true,result:created})};
      }
      assert.match(url,/\/query$/);
      assert.equal(body.sql,CHAPTER_SCHEMA);
      assert.equal(body.params.length,0);
      return {ok:true,json:async()=>({success:true,result:[{success:true,results:[]}]})};
    },
  };
  return {dbs,client,calls};
}

test('plans four extra shards without making a single POST request', async()=>{
  const x=fakeD1();
  const report=await prepareD1Shards(x.client,{mode:'plan'});
  assert.equal(report.mode,'plan');
  assert.equal(report.status,'NO_DATABASES_CREATED');
  assert.equal(report.databases_missing,4);
  assert.deepEqual(report.will_create,ADDITIONAL_NAMES);
  assert.equal(x.calls.length,0);
});

test('refuses provisioning without explicit manual authorization', async()=>{
  const x=fakeD1();
  await assert.rejects(()=>prepareD1Shards(x.client,{mode:'provision'}),
    /explicit manual GitHub workflow approval/);
  assert.equal(x.calls.length,0);
});

test('checks existing original database and sufficient Free slots',()=>{
  const extra=Array.from({length:8},(_,i)=>({
    name:'other-'+i,uuid:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0')
  }));
  assert.throws(()=>provisioningPlan([
    {name:'novelhaven-chapters-01',uuid:DATABASE_ID},
    ...extra
  ]), /Insufficient available D1 Free slots/);
  assert.throws(()=>provisioningPlan([
    {name:'novelhaven-chapters-01',uuid:'00000000-0000-0000-0000-000000000123'},
  ]),/Original NovelHaven D1 UUID\/name mismatch/);
});

test('provisioning creates and initializes only four correctly named empty databases', async()=>{
  const x=fakeD1();
  const report=await prepareD1Shards(x.client,{
    mode:'provision',allowProvision:true
  });
  assert.equal(report.status,'PROVISIONED_EMPTY_DATABASES_ONLY');
  assert.equal(report.created.length,4);
  assert.equal(x.dbs.length,5);
  assert.equal(x.calls.filter(x=>x.url.endsWith('/query')).length,4);
  assert.equal(x.calls.filter(x=>!x.url.endsWith('/query')).length,4);
  assert.deepEqual(report.shard_bindings_for_future_review.map(x=>x.name),ADDITIONAL_NAMES);
  assert.equal(x.dbs[0].uuid,DATABASE_ID);
  // Repeating never creates another database or alters existing ones.
  const again=await prepareD1Shards(x.client,{
    mode:'provision',allowProvision:true
  });
  assert.equal(again.created.length,0);
  assert.equal(x.calls.length,8);
});

test('if one shard already exists, creates only the missing ones',async()=>{
  const x=fakeD1([{
    name:'novelhaven-chapters-02',uuid:'00000000-0000-0000-0000-000000000123'
  }]);
  const report=await prepareD1Shards(x.client,{
    mode:'provision',allowProvision:true
  });
  assert.equal(report.created.length,3);
  assert.equal(report.databases_already_present,1);
  assert.equal(x.dbs.length,5);
});

test('writes private-mode metadata summary and does not include token or chapter text',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'novelhaven-shard-plan-'));
  try {
    const report=await prepareD1Shards(fakeD1().client,{mode:'plan'});
    const out=path.join(temp,'report.json');
    const summary=path.join(temp,'summary.md');
    writeProvisioningReport(report,{out,summary});
    assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).mode,'plan');
    const text=fs.readFileSync(summary,'utf8');
    assert.match(text,/No chapter data was moved/);
    assert.doesNotMatch(text,/not-for-publication|paragraphs_json/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
