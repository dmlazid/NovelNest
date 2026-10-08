#!/usr/bin/env node
/**
 * Cloudflare D1 account inventory — READ ONLY.
 * Lists existing database count and sizes with the existing D1-scoped token.
 * Does not create/modify/delete databases or deploy the live Worker.
 * Other account database names and IDs are never printed in workflow logs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DATABASE_ID } from './sync-d1-chapters.mjs';

export const FREE_DATABASE_SLOTS = 10;
export const FREE_ACCOUNT_BYTES = 5 * 1024 ** 3;

export class CloudflareD1Inventory {
  constructor({ accountId, token, fetchFn = fetch }) {
    assert(/^[0-9a-f]{32}$/i.test(accountId || ''), 'Invalid Cloudflare account ID');
    assert(typeof token === 'string' && token.trim(), 'Missing D1 API token');
    this.base = 'https://api.cloudflare.com/client/v4/accounts/' +
      accountId + '/d1/database';
    this.token = token;
    this.fetchFn = fetchFn;
  }

  async read(suffix = '') {
    let result;
    try {
      result = await this.fetchFn(this.base + suffix, {
        headers: { Authorization: 'Bearer ' + this.token },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('Cloudflare D1 account read failed; no changes made');
    }
    assert(result.ok, 'D1 account inventory HTTP ' + result.status + '; no changes made');
    let data;
    try { data = await result.json(); }
    catch { throw new Error('D1 account inventory returned invalid JSON'); }
    assert(data.success === true && (!Array.isArray(data.errors) || !data.errors.length),
      'Cloudflare D1 account inventory rejected; no changes made');
    return data;
  }

  async list() {
    const items = [];
    const seen = new Set();
    // Cloudflare paginates. Never assume the first page is complete.
    for (let page = 1; page <= 20; page++) {
      const data = await this.read('?page=' + page + '&per_page=100');
      assert(Array.isArray(data.result), 'Cloudflare D1 inventory list invalid');
      for (const db of data.result) {
        assert(typeof db.uuid === 'string' && /^[0-9a-f-]{36}$/i.test(db.uuid),
          'Cloudflare D1 database ID invalid');
        assert(!seen.has(db.uuid), 'Repeated database across D1 listing pages');
        seen.add(db.uuid);
        items.push(db);
      }
      const info = data.result_info;
      const count = Number(info?.total_count);
      const totalPages = Number(info?.total_pages);
      const more = (Number.isSafeInteger(totalPages) && totalPages > page) ||
        (Number.isSafeInteger(count) && count > items.length);
      if (!more) {
        if (!info && data.result.length >= 100) {
          // Result might be incomplete. Do not make free-space claims.
          throw new Error('D1 inventory pagination metadata missing; cannot verify all databases');
        }
        return items;
      }
      if (page === 20) throw new Error('D1 inventory pagination cap reached');
    }
    throw new Error('D1 inventory incomplete');
  }

  async audit(projectedShards = null) {
    const databases = await this.list();
    assert(databases.some(db => db.uuid === DATABASE_ID),
      'Expected existing NovelHaven D1 database is missing; aborting inventory');
    let bytes = 0;
    for (const db of databases) {
      const result = (await this.read('/' + db.uuid)).result;
      assert(result?.uuid === db.uuid, 'D1 inventory returned mismatched database details');
      const size = Number(result.file_size);
      assert(Number.isSafeInteger(size) && size >= 0,
        'Cannot verify D1 database sizes; no changes made');
      bytes += size;
    }
    const remaining = Math.max(0, FREE_DATABASE_SLOTS - databases.length);
    const extraNeeded = Number.isSafeInteger(projectedShards) && projectedShards >= 1 ?
      Math.max(0, projectedShards - 1) : null;
    return {
      status: 'READ_ONLY_NO_DATABASES_CREATED',
      existing_d1_databases_in_account: databases.length,
      novelhaven_main_database_exists: true,
      approximate_account_d1_bytes: bytes,
      hypothetical_free_plan_database_slots_remaining: remaining,
      hypothetical_free_plan_storage_bytes_remaining: Math.max(0, FREE_ACCOUNT_BYTES - bytes),
      additional_novelhaven_databases_illustrative: extraNeeded,
      free_slots_sufficient_for_illustrative_plan: extraNeeded === null ? null :
        extraNeeded <= remaining,
      caveat: 'Slot limits shown are for Cloudflare Free; this audit cannot identify your plan. ' +
        'Database size estimates do not represent committed chapter placement. ' +
        'No databases were created and no Worker, website or AdSense files were changed.',
    };
  }
}

export function writeInventory(report, {
  out = process.env.D1_INVENTORY_OUT, summary = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  if (summary) fs.appendFileSync(summary, [
    '### Cloudflare D1 account inventory (read-only)', '',
    '| Measure | Current |', '| --- | ---: |',
    '| D1 databases already in account | ' + report.existing_d1_databases_in_account + ' |',
    '| Hypothetical remaining Free database slots | ' +
      report.hypothetical_free_plan_database_slots_remaining + ' |',
    '| Additional NovelHaven databases in size illustration | ' +
      (report.additional_novelhaven_databases_illustrative ?? 'Not calculated') + ' |',
    '| Database slots sufficient under Free plan | ' +
      (report.free_slots_sufficient_for_illustrative_plan === null ? 'Unknown' :
        report.free_slots_sufficient_for_illustrative_plan ? 'Yes' : 'No') + ' |',
    '| Total D1 physical bytes already in account | ' +
      report.approximate_account_d1_bytes.toLocaleString('en-US') + ' |',
    '',
    'Only inventory information was read; **no new databases were created**. ' +
    'No public website files, Cloudflare Worker or AdSense settings changed.',
    '',
  ].join('\n'));
  console.log('D1 account inventory: ' + JSON.stringify(report));
}

async function main() {
  const planFile = process.env.D1_CAPACITY_OUT;
  let illustrativeCount = null;
  if (planFile && fs.existsSync(planFile)) {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    if (Number.isSafeInteger(plan.illustrative_shards_needed)) {
      illustrativeCount = plan.illustrative_shards_needed;
    }
  }
  const client = new CloudflareD1Inventory({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  });
  const report = await client.audit(illustrativeCount);
  writeInventory(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error('Read-only D1 account inventory failed:', e.message);
    process.exitCode = 1;
  });
}
