#!/usr/bin/env node
/**
 * Optional Free D1 shard setup — explicit manual approval required to create.
 *
 * Safe defaults: mode=plan, and no POST calls at all.
 * Provision mode creates ONLY novelhaven-chapters-02 through -05 after
 * verifying the existing DB UUID and Free-tier slot count.
 * Never changes the original D1 database, the Worker or website/AdSense.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudflareD1Inventory, FREE_DATABASE_SLOTS } from './audit-d1-account.mjs';
import { DATABASE_ID } from './sync-d1-chapters.mjs';

export const ADDITIONAL_NAMES = Object.freeze(
  [2, 3, 4, 5].map(n => 'novelhaven-chapters-' + String(n).padStart(2, '0'))
);

export const CHAPTER_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS chapters (',
  ' novel_id TEXT NOT NULL,',
  ' chapter_number INTEGER NOT NULL,',
  ' title TEXT NOT NULL,',
  ' paragraphs_json TEXT NOT NULL,',
  ' updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  ' PRIMARY KEY(novel_id, chapter_number)',
  ');',
].join('\n');

export function provisioningPlan(databases) {
  assert(Array.isArray(databases), 'Invalid D1 inventory');
  assert(databases.some(db => db.uuid === DATABASE_ID &&
    db.name === 'novelhaven-chapters-01'),
    'Original NovelHaven D1 UUID/name mismatch; refuse provisioning');
  const names = new Map();
  for (const db of databases) {
    assert(typeof db.name === 'string' && typeof db.uuid === 'string',
      'Invalid D1 entry');
    assert(!names.has(db.name), 'Duplicate Cloudflare D1 database names');
    names.set(db.name, db.uuid);
  }
  const missing = ADDITIONAL_NAMES.filter(name => !names.has(name));
  const freeSlots = FREE_DATABASE_SLOTS - databases.length;
  assert(freeSlots >= missing.length,
    'Insufficient available D1 Free slots; no new databases created');
  return {
    existing_count: databases.length,
    free_slots_before: freeSlots,
    existing_requested_shards: ADDITIONAL_NAMES.filter(name => names.has(name)),
    missing_shards: missing,
  };
}

async function post(client, suffix, payload) {
  let response;
  try {
    response = await client.fetchFn(client.base + suffix, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + client.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('Cloudflare D1 request could not complete; retry safely');
  }
  assert(response.ok, 'Cloudflare rejected D1 operation (HTTP ' + response.status + ')');
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Invalid Cloudflare response to D1 operation'); }
  assert(data.success === true && (!Array.isArray(data.errors) || !data.errors.length),
    'Cloudflare rejected D1 operation; inspect Cloudflare dashboard');
  return data.result;
}

export async function prepareD1Shards(client, { mode = 'plan',
  allowProvision = false } = {}) {
  assert(mode === 'plan' || mode === 'provision', 'Use plan or provision');
  assert(mode !== 'provision' || allowProvision === true,
    'Provision requires an explicit manual GitHub workflow approval');
  const databases = await client.list();
  const current = provisioningPlan(databases);
  const report = {
    mode, status: 'NO_DATABASES_CREATED',
    original_database_uuid: DATABASE_ID,
    existing_database_count: current.existing_count,
    free_slots_before: current.free_slots_before,
    extra_databases_requested: ADDITIONAL_NAMES.length,
    databases_already_present: current.existing_requested_shards.length,
    databases_missing: current.missing_shards.length,
    will_create: mode === 'plan' ? current.missing_shards : [],
    created: [],
    note: 'Does not alter original database, Cloudflare Worker, website or AdSense.',
  };
  if (mode === 'plan') return report;
  for (const name of current.missing_shards) {
    const result = await post(client, '', { name });
    assert(result && result.name === name && typeof result.uuid === 'string' &&
      /^[a-f0-9-]{36}$/i.test(result.uuid),
      'Unexpected D1 create response; verify database inventory before retrying');
    const schema = await post(client, '/' + result.uuid + '/query',
      { sql: CHAPTER_SCHEMA, params: [] });
    assert(Array.isArray(schema) && schema.length === 1 &&
      schema[0]?.success === true,
      'A database was created but its chapters schema needs verification');
    report.created.push({ name, uuid: result.uuid });
  }
  const after = await client.list();
  for (const name of ADDITIONAL_NAMES) {
    assert(after.filter(db => db.name === name).length === 1,
      'A NovelHaven shard was not visible after creation: ' + name);
  }
  report.status = 'PROVISIONED_EMPTY_DATABASES_ONLY';
  report.databases_after = after.length;
  report.shard_bindings_for_future_review = after.filter(db =>
    ADDITIONAL_NAMES.includes(db.name)).map(db => ({
      name: db.name, uuid: db.uuid,
    })).sort((a, b) => a.name.localeCompare(b.name));
  return report;
}

export function writeProvisioningReport(report, {
  out = process.env.D1_PROVISION_OUT, summary = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  if (summary) fs.appendFileSync(summary, [
    '### NovelHaven additional D1 database setup',
    '',
    '- Mode: **' + report.mode + '**',
    '- Existing D1 account databases: ' + report.existing_database_count,
    '- Additional NovelHaven databases missing before run: ' + report.databases_missing,
    '- Extra databases created this run: ' + report.created.length,
    '- Status: **' + report.status + '**',
    '',
    'Any new databases are empty except for the same chapters table schema. ' +
      '**No chapter data was moved**; the original D1 database, existing Worker, ' +
      'live website and AdSense files are unchanged.',
    '',
  ].join('\n'));
  console.log('NovelHaven D1 setup:', JSON.stringify(report));
}

export async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 2 && argv[0] === '--mode', 'Expected --mode plan|provision');
  const mode = argv[1];
  const client = new CloudflareD1Inventory({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  const report = await prepareD1Shards(client, {
    mode,
    allowProvision: mode === 'provision' &&
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      process.env.D1_EXPLICIT_PROVISION === 'PROVISION_FOUR_EMPTY_D1_DATABASES',
  });
  writeProvisioningReport(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error('D1 shard setup stopped:', e.message);
    process.exitCode = 1;
  });
}
