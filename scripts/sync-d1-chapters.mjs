#!/usr/bin/env node
/**
 * Copy ALREADY PUBLISHED NovelHaven chapters from GitHub to the existing D1
 * database, without changing the live reader, site deployment, or AdSense.
 *
 * Reads existing Cloudflare D1 progress each run. Strictly limits writes and
 * fails closed if size/account verification fails. No new novels are published.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  loadNovelCatalog, selectChapters, MAX_ROW_BYTES,
} from './export-d1-batch.mjs';

export const DATABASE_ID = '61109519-a023-4ab3-9b2b-8b990752126e';
export const SOFT_LIMIT_BYTES = 380 * 1024 * 1024; // Well below D1 Free 500 MB.
export const DEFAULT_RUN_LIMIT = 200;
export const MAX_RUN_LIMIT = 500;
export const PER_NOVEL_LIMIT = 25;
const SQL_WRITE = 'INSERT INTO chapters (novel_id, chapter_number, title, paragraphs_json) ' +
  'VALUES (?, ?, ?, ?) ON CONFLICT(novel_id, chapter_number) DO NOTHING';

export function validateOptions(options = {}) {
  const mode = options.mode ?? 'plan';
  const maxChapters = Number(options.maxChapters ?? DEFAULT_RUN_LIMIT);
  assert(['plan', 'import'].includes(mode), 'Mode must be plan or import');
  assert(Number.isSafeInteger(maxChapters) && maxChapters >= 1 && maxChapters <= MAX_RUN_LIMIT,
    'max-chapters must be between 1 and ' + MAX_RUN_LIMIT);
  return { mode, maxChapters };
}

export function checkCapacity(bytes, payloadBytes = 0) {
  assert(Number.isSafeInteger(bytes) && bytes >= 0,
    'D1 file size unavailable; stopping without writing');
  assert(Number.isSafeInteger(payloadBytes) && payloadBytes >= 0, 'Invalid chapter byte size');
  // SQLite indices/pages may exceed raw JSON bytes. Reserve 4x per chapter.
  return bytes + Math.max(128 * 1024, payloadBytes * 4) < SOFT_LIMIT_BYTES;
}

export function firstMissingNumber(total, stats, storedNumbers = null) {
  assert(Number.isSafeInteger(total) && total > 0, 'Invalid published chapter count');
  if (!stats || Number(stats.stored) === 0) return 1;
  const count = Number(stats.stored);
  const min = Number(stats.minimum);
  const max = Number(stats.maximum);
  assert([count, min, max].every(Number.isSafeInteger) && count >= 0 && min >= 1 && max >= min,
    'Invalid remote D1 chapter progress');
  if (count === total && min === 1 && max === total) return null;
  if (count === max && min === 1) return max >= total ? null : max + 1;
  if (!storedNumbers) return undefined; // Need to check gaps before choosing a starting chapter.
  const present = new Set(storedNumbers.map(x => Number(x.chapter_number)));
  for (let number = 1; number <= total; number++) if (!present.has(number)) return number;
  return null;
}

export function prioritizeNovels(novels, stats) {
  return novels.filter(n => n.id && Array.isArray(n.chapters) && n.chapters.length)
    .filter(n => firstMissingNumber(n.chapters.length, stats.get(n.id)) !== null)
    .sort((a, b) => {
      const x = Number(stats.get(a.id)?.stored ?? 0) / a.chapters.length;
      const y = Number(stats.get(b.id)?.stored ?? 0) / b.chapters.length;
      return x - y || a.id.localeCompare(b.id);
    });
}

function maskError(error) {
  // Do not print SQL, chapter text, tokens or API response bodies.
  if (error instanceof Error) return error.message.slice(0, 220);
  return 'Unspecified Cloudflare request error';
}

export class D1Client {
  constructor({ token, accountId, databaseId = DATABASE_ID, fetchFn = fetch }) {
    assert(typeof token === 'string' && token.trim(), 'Missing CLOUDFLARE_API_TOKEN');
    assert(/^[a-f0-9]{32}$/i.test(accountId ?? ''), 'Invalid CLOUDFLARE_ACCOUNT_ID');
    assert(databaseId === DATABASE_ID, 'Unrecognized D1 database');
    this.url = 'https://api.cloudflare.com/client/v4/accounts/' +
      accountId + '/d1/database/' + databaseId;
    this.token = token;
    this.fetchFn = fetchFn;
  }

  async request(endpoint = '', method = 'GET', body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await this.fetchFn(this.url + endpoint, {
          method,
          headers: {
            'Authorization': 'Bearer ' + this.token,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); continue; }
        throw new Error('Cloudflare API could not be reached; import paused');
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
        throw new Error('Cloudflare API rate limit or server error; import paused');
      }
      if (!response.ok) throw new Error('Cloudflare API returned HTTP ' + response.status +
        '; check scoped D1 token and account ID');
      let data;
      try { data = await response.json(); }
      catch { throw new Error('Cloudflare API returned invalid JSON'); }
      if (data.success !== true || (Array.isArray(data.errors) && data.errors.length)) {
        throw new Error('Cloudflare D1 rejected the request; import paused');
      }
      return data.result;
    }
    throw new Error('Cloudflare request failed; import paused');
  }

  async size() {
    const db = await this.request();
    assert(db && typeof db === 'object' && db.uuid === DATABASE_ID,
      'Cloudflare database ID mismatch: refusing writes');
    const bytes = Number(db.file_size);
    assert(Number.isSafeInteger(bytes) && bytes >= 0,
      'Cloudflare did not return an accurate database size: refusing writes');
    return bytes;
  }

  async query(sql, params = []) {
    const output = await this.request('/query', 'POST', {
      sql, params: params.map(p => String(p)),
    });
    assert(Array.isArray(output) && output.length === 1 && output[0]?.success === true &&
      Array.isArray(output[0]?.results), 'Unexpected D1 query response; import paused');
    return output[0];
  }
}

/**
 * Read actual stored totals, not estimates from attempted insert statements.
 * Count query is read-only and has no impact on website or AdSense settings.
 */
export async function finishReport(client, report, log = () => {}) {
  const rows = (await client.query(
    'SELECT COUNT(*) AS total, COUNT(DISTINCT novel_id) AS novels FROM chapters'
  )).results;
  assert(Array.isArray(rows) && rows.length === 1,
    'D1 totals response missing; verify remote chapter count');
  const total = Number(rows[0].total);
  const novels = Number(rows[0].novels);
  assert(Number.isSafeInteger(total) && total >= 0 &&
    Number.isSafeInteger(novels) && novels >= 0 && novels <= total,
    'D1 totals are invalid; verify remote chapter count');
  report.total_chapters_in_d1 = total;
  report.novels_in_d1 = novels;
  report.database_bytes_after = await client.size();
  report.safe_capacity_used_percent = Number(
    (100 * report.database_bytes_after / SOFT_LIMIT_BYTES).toFixed(2)
  );
  log('Migration report: ' + JSON.stringify(report));
  return report;
}

export async function syncPublishedChapters({
  client,
  root = 'dist',
  mode = 'plan',
  maxChapters = DEFAULT_RUN_LIMIT,
  log = () => {},
} = {}) {
  ({ mode, maxChapters } = validateOptions({ mode, maxChapters }));
  assert(client && typeof client.query === 'function' && typeof client.size === 'function',
    'Missing D1 client');
  const novels = loadNovelCatalog(root);
  const beforeSize = await client.size();
  const raw = (await client.query(
    'SELECT novel_id, COUNT(*) AS stored, MIN(chapter_number) AS minimum, ' +
    'MAX(chapter_number) AS maximum FROM chapters GROUP BY novel_id',
  )).results;
  const stats = new Map(raw.map(x => [x.novel_id, x]));
  const candidates = prioritizeNovels(novels, stats);
  const report = {
    mode,
    database: 'novelhaven-chapters-01',
    safe_stop_bytes: SOFT_LIMIT_BYTES,
    database_bytes_before: beforeSize,
    published_novels: novels.length,
    novels_with_pending_chapters: candidates.length,
    considered_chapters: 0,
    inserted_chapters: 0,
    skipped_chapters: [],
    stop_reason: 'no_pending_chapters',
    latest_novel: null,
  };
  if (!candidates.length) {
    return finishReport(client, report, log);
  }
  if (!checkCapacity(beforeSize)) {
    report.stop_reason = 'capacity_guard_reached';
    return finishReport(client, report, log);
  }
  for (const novel of candidates) {
    if (report.considered_chapters >= maxChapters) break;
    let start = firstMissingNumber(novel.chapters.length, stats.get(novel.id));
    if (start === undefined) {
      const numbers = (await client.query(
        'SELECT chapter_number FROM chapters WHERE novel_id = ? ORDER BY chapter_number',
        [novel.id],
      )).results;
      start = firstMissingNumber(novel.chapters.length, stats.get(novel.id), numbers);
    }
    if (start === null) continue;
    const limit = Math.min(PER_NOVEL_LIMIT, maxChapters - report.considered_chapters,
      novel.chapters.length - start + 1);
    const selected = selectChapters(root, novel, start, limit);
    report.latest_novel = novel.id;
    for (const chapter of selected) {
      report.considered_chapters += 1;
      const paragraphs = JSON.stringify(chapter.paragraphs);
      const bytes = Buffer.byteLength(paragraphs, 'utf8') +
        Buffer.byteLength(chapter.title, 'utf8') + Buffer.byteLength(novel.id, 'utf8');
      if (bytes >= MAX_ROW_BYTES) {
        report.skipped_chapters.push({ novel_id: novel.id, chapter: chapter.number, reason: 'row_too_large' });
        continue;
      }
      if (mode === 'plan') {
        log('Would import ' + novel.id + ' chapter ' + chapter.number);
        continue;
      }
      // Fail closed if we cannot verify actual remote storage before writing.
      const currentSize = await client.size();
      if (!checkCapacity(currentSize, bytes)) {
        report.stop_reason = 'capacity_guard_reached';
        return finishReport(client, report, log);
      }
      const result = await client.query(SQL_WRITE, [
        novel.id, chapter.number, chapter.title, paragraphs,
      ]);
      const written = Number(result.meta?.rows_written);
      // SQLite metadata can count index writes; trust changes only when present.
      const changes = Number(result.meta?.changes);
      report.inserted_chapters += Number.isFinite(changes) && changes > 0 ? 1 :
        Number.isFinite(written) && written > 0 ? 1 : 0;
    }
  }
  report.stop_reason = report.considered_chapters >= maxChapters ?
    'per_run_limit_reached' : 'remaining_chapters_or_skips';
  return finishReport(client, report, log);
}

function argumentsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert(argv[i]?.startsWith('--') && argv[i + 1], 'Expected --mode and --max-chapters flags');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return validateOptions({ mode: args.mode, maxChapters: args['max-chapters'] });
}

export async function main(argv = process.argv.slice(2)) {
  const args = argumentsFrom(argv);
  const client = new D1Client({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  });
  const report = await syncPublishedChapters({
    client, ...args,
    log: msg => console.log(msg),
  });
  const reportFile = process.env.GITHUB_STEP_SUMMARY;
  if (reportFile) {
    fs.appendFileSync(reportFile,
      '\n### NovelHaven D1 chapter migration\n' +
      '- Mode: ' + report.mode + '\n' +
      '- Published novels checked: ' + report.published_novels + '\n' +
      '- Novels still pending: ' + report.novels_with_pending_chapters + '\n' +
      '- Chapters considered this run: ' + report.considered_chapters + '\n' +
      '- Chapters inserted: ' + report.inserted_chapters + '\n' +
      '- **Total chapters in Cloudflare D1: ' + report.total_chapters_in_d1 + '**\n' +
      '- **Novels with chapters stored in D1: ' + report.novels_in_d1 + '**\n' +
      '- Storage used against safe cutoff: ' + report.safe_capacity_used_percent + '%\n' +
      '- Reason for stopping: ' + report.stop_reason + '\n' +
      '- Database size after: ' + (report.database_bytes_after ?? report.database_bytes_before) + ' bytes\n' +
      '- Database soft cutoff: ' + SOFT_LIMIT_BYTES + ' bytes\n' +
      '- No live reader, GitHub source chapters, or AdSense files were modified.\n');
  }
  const output = process.env.D1_REPORT_PATH;
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('D1 migration summary: ' + JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('D1 migration paused:', maskError(e)); process.exitCode = 1; });
}
