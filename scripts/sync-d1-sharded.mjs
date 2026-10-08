#!/usr/bin/env node
/**
 * Safely prepare and, only when explicitly requested, sync already-published
 * NovelHaven chapters across five EXISTING Cloudflare D1 databases.
 *
 * No Worker, DNS, GitHub Pages, reader, novel source, or AdSense edits.
 * Novel routing is durable in database 01's novel_shards table. Existing
 * chapter rows stay on their current database. Plan mode makes ZERO writes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNovelCatalog, selectChapters, MAX_ROW_BYTES } from './export-d1-batch.mjs';
import { estimatePublishedVolumes } from './plan-d1-capacity.mjs';
import { D1Client, SOFT_LIMIT_BYTES, firstMissingNumber, validateOptions,
  PER_NOVEL_LIMIT } from './sync-d1-chapters.mjs';
import { SHARDS, ROUTING_SCHEMA } from '../cloudflare/d1/shards.mjs';

export const SQL_INSERT = 'INSERT INTO chapters (novel_id, chapter_number, title, paragraphs_json) ' +
  'VALUES (?, ?, ?, ?) ON CONFLICT(novel_id, chapter_number) DO NOTHING';
export const SQL_ROUTE = 'INSERT INTO novel_shards (novel_id, database_id) ' +
  'VALUES (?, ?) ON CONFLICT(novel_id) DO NOTHING';
const SQL_STATS = 'SELECT novel_id, COUNT(*) AS stored, MIN(chapter_number) AS minimum, ' +
  'MAX(chapter_number) AS maximum FROM chapters GROUP BY novel_id';
const SQL_TOTALS = 'SELECT COUNT(*) AS total, COUNT(DISTINCT novel_id) AS novels FROM chapters';
const SQL_VERIFY = 'SELECT title, paragraphs_json FROM chapters ' +
  'WHERE novel_id = ? AND chapter_number = ?';

export function createClients({ token, accountId, fetchFn = fetch }) {
  const allow = SHARDS.map(s => s.id);
  assert(new Set(allow).size === 5 && SHARDS[0].number === 1,
    'Five distinct verified D1 databases are required');
  return new Map(SHARDS.map(shard => [shard.id, new D1Client({
    token, accountId, databaseId: shard.id, allowedDatabaseIds: allow, fetchFn,
  })]));
}

export function planAssignments(volumes, pinned = new Map(), sizes = new Map()) {
  const estimated = new Map(SHARDS.map(s => [s.id, Math.max(0, sizes.get(s.id) ?? 0)]));
  const planned = new Map();
  const sorted = [...volumes].sort((a, b) =>
    b.projected_d1_bytes - a.projected_d1_bytes || a.id.localeCompare(b.id));
  for (const book of sorted) {
    assert(typeof book.id === 'string' && book.id && Number.isSafeInteger(book.projected_d1_bytes)
      && book.projected_d1_bytes > 0, 'Invalid published novel storage forecast');
    assert(!planned.has(book.id), 'Duplicate novel in published catalog: ' + book.id);
    assert(book.projected_d1_bytes < SOFT_LIMIT_BYTES,
      'Novel cannot fit one safe D1 shard; requires reviewed chapter-range routing: ' + book.id);
    let target = pinned.get(book.id);
    if (target !== undefined) {
      assert(estimated.has(target), 'Unknown persisted D1 routing target: ' + book.id);
    } else {
      target = [...estimated].sort((a, b) =>
        a[1] - b[1] || a[0].localeCompare(b[0]))[0][0];
    }
    planned.set(book.id, target);
    estimated.set(target, estimated.get(target) + book.projected_d1_bytes);
  }
  return { routes: planned, projectedLoad: estimated };
}

export function indexExistingRows(statsByShard, persistedRoutes = new Map()) {
  const existing = new Map();
  for (const [shardId, stats] of statsByShard) {
    for (const record of stats) {
      assert(typeof record.novel_id === 'string' && record.novel_id,
        'Invalid D1 novel ID in shard statistics');
      assert(!existing.has(record.novel_id) ||
        existing.get(record.novel_id).shardId === shardId,
        'One novel exists on multiple D1 shards; pause and reconcile before importing: ' +
          record.novel_id);
      existing.set(record.novel_id, { shardId, stats: record });
    }
  }
  for (const [novelId, shardId] of persistedRoutes) {
    assert(SHARDS.some(x => x.id === shardId),
      'Persisted route points to an unknown D1 database: ' + novelId);
    const actual = existing.get(novelId);
    assert(!actual || actual.shardId === shardId,
      'Persisted shard route conflicts with already imported chapters: ' + novelId);
  }
  const pinned = new Map(persistedRoutes);
  for (const [id, record] of existing) pinned.set(id, record.shardId);
  return { existing, pinned };
}

export function choosePending(novels, existing, limit) {
  assert(Number.isSafeInteger(limit) && limit > 0, 'Invalid chapter import cap');
  return novels.filter(book => book.chapters?.length)
    .filter(book => {
      const entry = existing.get(book.id);
      return !entry || firstMissingNumber(book.chapters.length, entry.stats) !== null;
    })
    .sort((a, b) => {
      const xa = Number(existing.get(a.id)?.stats.stored ?? 0) / a.chapters.length;
      const xb = Number(existing.get(b.id)?.stats.stored ?? 0) / b.chapters.length;
      return xa - xb || a.id.localeCompare(b.id);
    });
}

async function queryRoutes(client) {
  const check = (await client.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'novel_shards'"
  )).results;
  assert(Array.isArray(check), 'Cannot verify route index table');
  if (!check.length) return { tableExists: false, routes: new Map() };
  const rows = (await client.query('SELECT novel_id, database_id FROM novel_shards')).results;
  assert(Array.isArray(rows), 'Cannot read durable route index');
  const result = new Map();
  for (const row of rows) {
    assert(typeof row.novel_id === 'string' && typeof row.database_id === 'string' &&
      !result.has(row.novel_id), 'Invalid durable route index');
    result.set(row.novel_id, row.database_id);
  }
  return { tableExists: true, routes: result };
}

async function saveRoute(client, novelId, shardId) {
  await client.query(SQL_ROUTE, [novelId, shardId]);
  const rows = (await client.query(
    'SELECT database_id FROM novel_shards WHERE novel_id = ?', [novelId]
  )).results;
  assert(rows.length === 1 && rows[0].database_id === shardId,
    'Database route changed unexpectedly; refusing chapter write: ' + novelId);
}

function assertContent(chapter, novelId) {
  assert(Array.isArray(chapter.paragraphs) && chapter.paragraphs.length &&
    chapter.paragraphs.every(p => typeof p === 'string' && p.trim()),
    'Invalid source paragraphs: ' + novelId + ' chapter ' + chapter.number);
  const json = JSON.stringify(chapter.paragraphs);
  const bytes = Buffer.byteLength(json, 'utf8') +
    Buffer.byteLength(chapter.title, 'utf8') + Buffer.byteLength(novelId, 'utf8');
  return { json, bytes };
}

async function readAndVerify(client, novelId, chapter, paragraphsJson) {
  const rows = (await client.query(SQL_VERIFY, [novelId, chapter.number])).results;
  assert(rows.length === 1 && rows[0].title === chapter.title &&
    rows[0].paragraphs_json === paragraphsJson,
    'D1 chapter readback mismatch; import paused: ' + novelId + ' #' + chapter.number);
}

export async function syncSharded({
  clients, root = 'dist', mode = 'plan', maxChapters = 25,
  log = () => {},
} = {}) {
  ({ mode, maxChapters } = validateOptions({ mode, maxChapters }));
  assert(clients instanceof Map && clients.size === SHARDS.length &&
    SHARDS.every(s => clients.get(s.id)?.query && clients.get(s.id)?.size),
  'Missing or unverified D1 shard clients');
  const novels = loadNovelCatalog(root);
  const volumes = estimatePublishedVolumes(root);
  const master = clients.get(SHARDS[0].id);
  // Verify all five actual D1 DB UUIDs and their expected chapter schemas.
  const statsByShard = new Map(), sizes = new Map();
  for (const shard of SHARDS) {
    const client = clients.get(shard.id);
    sizes.set(shard.id, await client.size());
    const stats = (await client.query(SQL_STATS)).results;
    assert(Array.isArray(stats), 'Missing chapter schema on D1 shard ' + shard.number);
    statsByShard.set(shard.id, stats);
  }
  const routeState = await queryRoutes(master);
  const { existing, pinned } = indexExistingRows(statsByShard, routeState.routes);
  const forecast = planAssignments(volumes, pinned, sizes);
  const candidates = choosePending(novels, existing, maxChapters);
  const report = {
    mode, shards_connected: SHARDS.length,
    published_novels: novels.length,
    novels_with_pending_chapters: candidates.length,
    chapters_considered: 0, chapters_inserted: 0, chapters_verified: 0,
    overlarge_chapters: [], full_shards: [],
    route_index_exists_before: routeState.tableExists,
    stop_reason: 'nothing_pending', database_totals: [],
    planned_routes_by_shard: Object.fromEntries(SHARDS.map(s =>
      [s.name, [...forecast.routes.values()].filter(id => id === s.id).length])),
  };
  if (mode === 'import' && candidates.length) {
    // Non-destructive addition; no existing data is modified or deleted.
    await master.query(ROUTING_SCHEMA);
  }
  // Keep missing chapters from already-imported novels on their original DB.
  const routed = new Set(routeState.routes.keys());
  for (const novel of candidates) {
    if (report.chapters_considered >= maxChapters) break;
    const shardId = forecast.routes.get(novel.id);
    assert(clients.has(shardId), 'No shard assignment for novel ' + novel.id);
    const client = clients.get(shardId);
    const current = existing.get(novel.id);
    let start = firstMissingNumber(novel.chapters.length, current?.stats);
    if (start === undefined) {
      const rows = (await client.query(
        'SELECT chapter_number FROM chapters WHERE novel_id = ? ORDER BY chapter_number',
        [novel.id]
      )).results;
      start = firstMissingNumber(novel.chapters.length, current?.stats, rows);
    }
    if (start === null) continue;
    const limit = Math.min(PER_NOVEL_LIMIT,
      maxChapters - report.chapters_considered, novel.chapters.length - start + 1);
    const chapters = selectChapters(root, novel, start, limit);
    const shardName = SHARDS.find(s => s.id === shardId).name;
    for (const chapter of chapters) {
      report.chapters_considered++;
      const { json, bytes } = assertContent(chapter, novel.id);
      if (bytes >= MAX_ROW_BYTES) {
        report.overlarge_chapters.push({ novel_id: novel.id, chapter: chapter.number });
        continue;
      }
      if (mode === 'plan') continue;
      // Protect both physical D1 storage limits and account-wide quotas.
      const size = await client.size();
      if (size + Math.max(128 * 1024, bytes * 4) >= SOFT_LIMIT_BYTES) {
        if (!report.full_shards.includes(shardName)) report.full_shards.push(shardName);
        break;
      }
      if (!routed.has(novel.id)) {
        await saveRoute(master, novel.id, shardId);
        routed.add(novel.id);
      }
      await client.query(SQL_INSERT, [
        novel.id, chapter.number, chapter.title, json,
      ]);
      await readAndVerify(client, novel.id, chapter, json);
      report.chapters_verified++;
      // The chapter was missing as of our initial remote D1 snapshot; readback
      // is required before counting a successful new row.
      report.chapters_inserted++;
    }
  }
  for (const shard of SHARDS) {
    const client = clients.get(shard.id);
    const result = (await client.query(SQL_TOTALS)).results;
    assert(Array.isArray(result) && result.length === 1, 'Invalid D1 totals response');
    const total = Number(result[0].total), novelCount = Number(result[0].novels);
    assert(Number.isSafeInteger(total) && total >= 0 &&
      Number.isSafeInteger(novelCount) && novelCount >= 0,
      'Invalid D1 chapter counts');
    report.database_totals.push({
      database: shard.name,
      chapters: total,
      novels: novelCount,
      bytes: await client.size(),
    });
  }
  report.total_chapters = report.database_totals.reduce((sum, db) => sum + db.chapters, 0);
  report.stop_reason = report.full_shards.length ? 'shard_storage_guard_reached' :
    report.chapters_considered >= maxChapters ? 'per_run_limit_reached' :
      report.overlarge_chapters.length ? 'overlarge_chapters_need_review' : 'remaining_or_completed';
  log('Sharded D1 migration summary: ' + JSON.stringify(report));
  return report;
}

export function parseFlags(args) {
  const flags = {};
  assert(args.length % 2 === 0, 'Options must be --mode plan|import --max-chapters N');
  for (let i = 0; i < args.length; i += 2) {
    assert(/^--(?:mode|max-chapters)$/.test(args[i]) && args[i + 1],
      'Unknown or missing shard importer option');
    flags[args[i].slice(2)] = args[i + 1];
  }
  return validateOptions({ mode: flags.mode, maxChapters: flags['max-chapters'] ?? 25 });
}

export async function main(argv = process.argv.slice(2)) {
  const { mode, maxChapters } = parseFlags(argv);
  if (mode === 'import') {
    assert(process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      process.env.D1_SHARDED_WRITE_APPROVED === 'IMPORT_VERIFIED_SHARDED_PILOT',
      'Sharded writing requires an explicitly approved manual GitHub pilot');
  }
  const clients = createClients({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  });
  const report = await syncSharded({ clients, mode, maxChapters });
  if (process.env.D1_SHARDED_REPORT) {
    fs.writeFileSync(process.env.D1_SHARDED_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### NovelHaven five-database chapter migration pilot',
      '',
      '| Database | Chapters in D1 | Distinct novels | Physical bytes |',
      '| --- | ---: | ---: | ---: |',
      ...report.database_totals.map(db =>
        '| ' + db.database + ' | ' + db.chapters + ' | ' + db.novels + ' | ' +
        db.bytes.toLocaleString('en-US') + ' |'),
      '',
      '- Mode: **' + report.mode + '**',
      '- Published novels: ' + report.published_novels,
      '- Chapters considered this run: ' + report.chapters_considered,
      '- Chapters written and read back successfully: ' + report.chapters_verified,
      '- Total chapters across five D1 databases: **' + report.total_chapters + '**',
      '- Stop reason: ' + report.stop_reason,
      '- Chapters requiring size review: ' + report.overlarge_chapters.length,
      '',
      '**This workflow does not change the public NovelHaven reader, GitHub Pages, ' +
      'existing chapter source files, Cloudflare Workers, or AdSense.**',
      '',
    ].join('\n'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Chapter bodies, response payloads and API tokens are NEVER logged.
    console.error('Sharded migration safely paused:', error?.message?.slice(0, 230) ??
      'Unspecified verification failure');
    process.exitCode = 1;
  });
}
