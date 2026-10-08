#!/usr/bin/env node
/**
 * Read-only capacity planning for NovelHaven's PUBLISHED lazy chapter chunks.
 * Estimates storage required to migrate these chapters to Cloudflare D1.
 * Does not call Cloudflare, create databases, edit novels, or deploy Workers.
 *
 * Caution: SQLite physical storage/index overhead is data dependent. This is a
 * conservative planning estimate, NOT a guarantee or a final routing scheme.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNovelCatalog } from './export-d1-batch.mjs';

export const SAFE_DATABASE_BYTES = 380 * 1024 * 1024;
export const PLANNING_TARGET_BYTES = 300 * 1024 * 1024;
export const FREE_ACCOUNT_DATABASES = 10;
// Source JS is not identical to physical SQLite pages. Reserve an explicit
// multiplier, per-chapter overhead, and per-novel margin. The figure is rough.
export const SOURCE_BUFFER_FACTOR = 1.7;
export const ROW_OVERHEAD_BYTES = 256;
export const NOVEL_OVERHEAD_BYTES = 1 * 1024 * 1024;

export function projectedBytes(sourceBytes, chapters) {
  assert(Number.isSafeInteger(sourceBytes) && sourceBytes >= 0, 'Invalid source size');
  assert(Number.isSafeInteger(chapters) && chapters >= 1, 'Invalid chapter count');
  return Math.ceil(sourceBytes * SOURCE_BUFFER_FACTOR + chapters * ROW_OVERHEAD_BYTES +
    NOVEL_OVERHEAD_BYTES);
}

export function chunkPath(root, prefix, index) {
  assert(typeof prefix === 'string' && /^data\/[a-z0-9][a-z0-9/_-]*-$/.test(prefix) &&
    !prefix.includes('..') && !prefix.includes('//'),
    'Unsafe or unexpected lazy chapter prefix');
  assert(Number.isSafeInteger(index) && index >= 1, 'Invalid chapter chunk number');
  const base = path.resolve(root);
  const filename = path.resolve(base, prefix + String(index).padStart(2, '0') + '.js');
  assert(filename.startsWith(base + path.sep), 'Chapter file escapes dist folder');
  return filename;
}

export function estimatePublishedVolumes(root = 'dist') {
  const novels = loadNovelCatalog(root);
  const paths = new Set();
  const volumes = [];
  for (const novel of novels) {
    if (!novel.chapters?.length) continue;
    const config = novel.lazyChunks;
    assert(config && Number.isSafeInteger(config.capacity) && config.capacity > 0,
      'Published novel has no valid chunk configuration: ' + novel.id);
    const chunks = Math.ceil(novel.chapters.length / config.capacity);
    let sourceBytes = 0;
    for (let i = 1; i <= chunks; i++) {
      const filename = chunkPath(root, config.prefix, i);
      assert(!paths.has(filename),
        'Same chapter chunk referenced more than once: ' + path.relative(root, filename));
      paths.add(filename);
      const entry = fs.statSync(filename);
      assert(entry.isFile(), 'Chapter chunk is not a file: ' + filename);
      sourceBytes += entry.size;
    }
    volumes.push({
      id: novel.id, title: novel.title, published_chapters: novel.chapters.length,
      chunk_files: chunks, source_bytes: sourceBytes,
      projected_d1_bytes: projectedBytes(sourceBytes, novel.chapters.length),
    });
  }
  return volumes;
}

export function simulateShardPlan(volumes, {
  targetBytes = PLANNING_TARGET_BYTES,
  maxDatabases = FREE_ACCOUNT_DATABASES,
} = {}) {
  assert(Number.isSafeInteger(targetBytes) && targetBytes > 0, 'Invalid shard target');
  assert(Number.isSafeInteger(maxDatabases) && maxDatabases >= 1, 'Invalid shard count');
  const bins = [];
  const tooLarge = [];
  for (const book of [...volumes].sort((a, b) =>
    b.projected_d1_bytes - a.projected_d1_bytes || a.id.localeCompare(b.id))) {
    if (book.projected_d1_bytes > targetBytes) {
      tooLarge.push(book.id);
      continue;
    }
    const eligible = bins.filter(b => b.estimated_bytes + book.projected_d1_bytes <= targetBytes)
      .sort((a, b) => b.estimated_bytes - a.estimated_bytes || a.number - b.number);
    const chosen = eligible[0] ?? (() => {
      const bin = { number: bins.length + 1, estimated_bytes: 0,
        novels: 0, chapters: 0 };
      bins.push(bin);
      return bin;
    })();
    chosen.estimated_bytes += book.projected_d1_bytes;
    chosen.novels += 1;
    chosen.chapters += book.published_chapters;
  }
  return {
    illustrative_shards: bins,
    illustrative_shards_needed: bins.length,
    books_over_single_shard_target: tooLarge,
    estimated_free_slots_sufficient: tooLarge.length === 0 && bins.length <= maxDatabases,
  };
}

export function planD1Capacity(root = 'dist') {
  const volumes = estimatePublishedVolumes(root);
  const total = (key) => volumes.reduce((a, b) => a + b[key], 0);
  const shards = simulateShardPlan(volumes);
  return {
    status: 'ESTIMATE_ONLY_NO_DATABASES_CREATED',
    assumptions: {
      source_data_buffer_factor: SOURCE_BUFFER_FACTOR,
      row_overhead_bytes: ROW_OVERHEAD_BYTES,
      overhead_per_novel_bytes: NOVEL_OVERHEAD_BYTES,
      target_bytes_per_illustrative_shard: PLANNING_TARGET_BYTES,
      actual_importer_stop_bytes: SAFE_DATABASE_BYTES,
      cloudflare_free_max_databases_per_account: FREE_ACCOUNT_DATABASES,
    },
    published_novels: volumes.length,
    total_published_chapters: total('published_chapters'),
    source_chunk_files: total('chunk_files'),
    total_chapter_source_bytes: total('source_bytes'),
    projected_d1_bytes: total('projected_d1_bytes'),
    ...shards,
    largest_novels_by_estimated_size: [...volumes]
      .sort((a, b) => b.projected_d1_bytes - a.projected_d1_bytes)
      .slice(0, 8),
    warning: 'Planning figures are not measured physical D1 storage. Existing database has ' +
      'already imported chapters from the catalog, so this plan is NOT a routing map. ' +
      'Cloudflare account may contain other databases. No new database was created.',
  };
}

export function writePlan(report, { out = process.env.D1_CAPACITY_OUT,
  summary = process.env.GITHUB_STEP_SUMMARY } = {}) {
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  if (summary) {
    fs.appendFileSync(summary, [
      '### NovelHaven D1 free-tier capacity planning (read-only)',
      '',
      '| Metric | Estimate |',
      '| --- | ---: |',
      '| Published novels | ' + report.published_novels + ' |',
      '| Chapters in catalog | ' + report.total_published_chapters + ' |',
      '| Chapter source bytes | ' + report.total_chapter_source_bytes.toLocaleString('en-US') + ' |',
      '| Estimated D1 total bytes | ' + report.projected_d1_bytes.toLocaleString('en-US') + ' |',
      '| Illustrative databases at 300 MiB target | ' + report.illustrative_shards_needed + ' |',
      '| Largest novels too large for one planning shard | ' +
        report.books_over_single_shard_target.length + ' |',
      '',
      '**Important:** This is a size estimate and an illustrative distribution, NOT ' +
        'an applied database routing scheme. Existing chapters stay in GitHub Pages; ' +
        'no additional D1 databases were created. Cloudflare D1 actual size and ' +
        'other existing databases must be checked before provisioning.',
      '',
    ].join('\n'));
  }
  console.log('D1 capacity estimate: ' + JSON.stringify({
    status: report.status,
    novels: report.published_novels,
    chapters: report.total_published_chapters,
    source_bytes: report.total_chapter_source_bytes,
    projected_d1_bytes: report.projected_d1_bytes,
    illustrative_shards_needed: report.illustrative_shards_needed,
    too_large_books: report.books_over_single_shard_target.length,
    estimated_free_slots_sufficient: report.estimated_free_slots_sufficient,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { writePlan(planD1Capacity()); }
  catch (e) { console.error('D1 capacity estimate failed:', e.message); process.exitCode = 1; }
}
