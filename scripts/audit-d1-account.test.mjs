import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CloudflareD1Inventory, writeInventory,
} from './audit-d1-account.mjs';
import { DATABASE_ID } from './sync-d1-chapters.mjs';

const OTHER_ID = '01234567-89ab-cdef-0123-456789abcdef';
function mockedCloudflare({ includeMain = true, failDetails = false, pages = false } = {}) {
  const calls = [];
  const rows = [
    ...(includeMain ? [{uuid:DATABASE_ID, name:'novelhaven-chapters-01'}] : []),
    {uuid:OTHER_ID, name:'Other user-managed database (private)'},
  ];
  const fetchFn = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    calls.push(url);
    let result;
    let result_info;
    if (url.includes('?page=')) {
      const page = Number(new URL(url).searchParams.get('page'));
      result = pages ? rows.slice(page - 1, page) : rows;
      result_info = pages ? {total_count:rows.length,total_pages:rows.length} :
        {total_count:rows.length,total_pages:1};
    } else {
      const id = url.split('/').at(-1);
      result = failDetails ? {uuid:id,file_size:-1} :
        {uuid:id, file_size:id===DATABASE_ID?163840:5120};
    }
    return {ok:true, status:200, json:async()=>({success:true, result, result_info})};
  };
  return {fetchFn,calls};
}

test('validates Cloudflare credentials before opening the inventory', () => {
  assert.throws(()=>new CloudflareD1Inventory({
    accountId:'invalid',token:'x',fetchFn:()=>{}
  }), /Invalid Cloudflare account/);
  assert.throws(()=>new CloudflareD1Inventory({
    accountId:'a'.repeat(32),token:'',fetchFn:()=>{}
  }), /Missing D1 API token/);
});

test('audits database slots and physical sizes without disclosing unrelated database names', async () => {
  const fake=mockedCloudflare();
  const api=new CloudflareD1Inventory({
    accountId:'a'.repeat(32),token:'test-token',fetchFn:fake.fetchFn,
  });
  const report=await api.audit(5);
  assert.equal(report.status,'READ_ONLY_NO_DATABASES_CREATED');
  assert.equal(report.existing_d1_databases_in_account,2);
  assert.equal(report.approximate_account_d1_bytes,163840+5120);
  assert.equal(report.hypothetical_free_plan_database_slots_remaining,8);
  assert.equal(report.additional_novelhaven_databases_illustrative,4);
  assert.equal(report.free_slots_sufficient_for_illustrative_plan,true);
  assert.doesNotMatch(JSON.stringify(report),/Other user-managed database/);
  assert.equal(fake.calls.length,3);
  assert.ok(fake.calls.every(url=>url.startsWith('https://api.cloudflare.com/')));
});

test('checks every account inventory page', async () => {
  const fake=mockedCloudflare({pages:true});
  const api=new CloudflareD1Inventory({
    accountId:'a'.repeat(32),token:'test-token',fetchFn:fake.fetchFn,
  });
  const result=await api.audit(2);
  assert.equal(result.existing_d1_databases_in_account,2);
  assert.equal(fake.calls.filter(url=>url.includes('?page=')).length,2);
});

test('stops if initial main NovelHaven database is not present', async () => {
  const fake=mockedCloudflare({includeMain:false});
  const api=new CloudflareD1Inventory({
    accountId:'a'.repeat(32),token:'test-token',fetchFn:fake.fetchFn,
  });
  await assert.rejects(()=>api.audit(5),/expected existing NovelHaven D1/i);
});

test('stops if database sizes cannot be checked', async () => {
  const fake=mockedCloudflare({failDetails:true});
  const api=new CloudflareD1Inventory({
    accountId:'a'.repeat(32),token:'test-token',fetchFn:fake.fetchFn,
  });
  await assert.rejects(()=>api.audit(5),/Cannot verify D1 database sizes/);
});

test('reports inventory summary privately without token or other database names', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'novelhaven-account-'));
  try {
    const api=new CloudflareD1Inventory({
      accountId:'a'.repeat(32),token:'test-token',fetchFn:mockedCloudflare().fetchFn,
    });
    const report=await api.audit(5);
    const out=path.join(dir,'inventory.json');
    const summary=path.join(dir,'summary.md');
    writeInventory(report,{out,summary});
    assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).existing_d1_databases_in_account,2);
    const text=fs.readFileSync(summary,'utf8');
    assert.match(text,/no new databases were created/i);
    assert.doesNotMatch(text,/test-token|Other user-managed database/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
