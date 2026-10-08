#!/usr/bin/env node
// Export a small, verified batch of existing NovelHaven chapters as D1 SQL.
// This command NEVER contacts Cloudflare or changes the live website.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const MAX_STATEMENT_BYTES = 95_000;
export const MAX_ROW_BYTES = 1_900_000;
export const MAX_CHAPTERS_PER_BATCH = 25;

export function sqlString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

export function chapterStatement(novelId, chapter) {
  assert(typeof novelId === 'string' && novelId.length > 0, 'Missing novel ID');
  assert(Number.isSafeInteger(chapter.number) && chapter.number > 0, 'Invalid chapter number');
  assert(typeof chapter.title === 'string' && chapter.title.trim(), 'Missing chapter title');
  assert(Array.isArray(chapter.paragraphs) && chapter.paragraphs.length, 'Missing chapter paragraphs');
  assert(chapter.paragraphs.every(p => typeof p === 'string' && p.trim()), 'Invalid chapter paragraph');
  const paragraphs = JSON.stringify(chapter.paragraphs);
  assert(Buffer.byteLength(paragraphs, 'utf8') < MAX_ROW_BYTES,
    'Chapter exceeds the Cloudflare D1 2 MB row limit: ' + novelId + ' #' + chapter.number);
  const statement =
    'INSERT INTO chapters (novel_id, chapter_number, title, paragraphs_json) VALUES (' +
    sqlString(novelId) + ', ' + chapter.number + ', ' +
    sqlString(chapter.title) + ', ' + sqlString(paragraphs) + ')' +
    ' ON CONFLICT(novel_id, chapter_number) DO UPDATE SET ' +
    'title=excluded.title, paragraphs_json=excluded.paragraphs_json, updated_at=CURRENT_TIMESTAMP;';
  assert(Buffer.byteLength(statement, 'utf8') <= MAX_STATEMENT_BYTES,
    'Chapter exceeds the D1 100 KB SQL statement limit: ' + novelId + ' #' + chapter.number);
  return statement;
}

export function loadNovelCatalog(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)]
    .map(match => match[1].split('?')[0])
    .filter(name => name === 'catalog.js' || /^licensed-(?!ui\.js)/.test(name));
  assert(scripts.includes('catalog.js'), 'Missing novel catalog script');
  const context = vm.createContext({ window: {} });
  for (const name of scripts) {
    const scriptPath = path.join(root, name);
    assert(fs.existsSync(scriptPath), 'Catalog script missing: ' + name);
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context,
      { filename: name, timeout: 2000 });
  }
  assert(Array.isArray(context.window.NOVELS), 'Invalid novel catalog');
  return context.window.NOVELS;
}

export function selectChapters(root, novel, start, limit) {
  assert(Number.isSafeInteger(start) && start >= 1, 'Start must be a positive integer');
  assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_CHAPTERS_PER_BATCH,
    'Count must be between 1 and ' + MAX_CHAPTERS_PER_BATCH);
  assert(Array.isArray(novel.chapters) && novel.chapters.length, 'Novel has no chapters');
  assert(start <= novel.chapters.length,
    'Start is beyond last published chapter (' + novel.chapters.length + ')');
  const config = novel.lazyChunks;
  assert(config && Number.isSafeInteger(config.capacity) && config.capacity > 0 &&
    typeof config.prefix === 'string' && typeof config.global === 'string',
    'Invalid lazy-chunk configuration');
  const end = Math.min(novel.chapters.length, start + limit - 1);
  const chunkCache = new Map();
  const selected = [];
  for (let number = start; number <= end; number++) {
    const chunkNo = Math.floor((number - 1) / config.capacity) + 1;
    if (!chunkCache.has(chunkNo)) {
      const relative = config.prefix + String(chunkNo).padStart(2, '0') + '.js';
      const file = path.join(root, relative);
      assert(fs.existsSync(file), 'Missing chapter chunk: ' + relative);
      const context = vm.createContext({ window: {} });
      vm.runInContext(fs.readFileSync(file, 'utf8'), context,
        { filename: relative, timeout: 2000 });
      const chunk = context.window[config.global];
      assert(Array.isArray(chunk), 'Invalid chapter chunk: ' + relative);
      chunkCache.set(chunkNo, chunk);
    }
    const source = chunkCache.get(chunkNo)[(number - 1) % config.capacity];
    const metadata = novel.chapters[number - 1];
    assert(source && metadata, 'Missing chapter #' + number);
    const sourceNumber = Number(source.number ?? (config.numberFromTitle
      ? source.title?.match(/^Chapter\s+(\d+)/i)?.[1] : NaN));
    assert(sourceNumber === number && Number(metadata.number) === number,
      'Chapter numbering mismatch at #' + number);
    assert(source.title === metadata.title,
      'Chapter title mismatch at #' + number);
    selected.push({
      number,
      title: source.title,
      paragraphs: source.paragraphs,
    });
  }
  return selected;
}

export function prepareBatch({ root = 'dist', novelId, start = 1, limit = 5 }) {
  assert(typeof novelId === 'string' && novelId.trim(), 'Provide --novel');
  const novels = loadNovelCatalog(root);
  const novel = novels.find(item => item.id === novelId);
  assert(novel, 'No published novel has ID: ' + novelId);
  const selected = selectChapters(root, novel, start, limit);
  const statements = selected.map(chapter => chapterStatement(novel.id, chapter));
  const sql = '-- NovelHaven D1 pilot import; idempotent and non-destructive.\n' +
    '-- Existing GitHub chapters remain authoritative during testing.\n' +
    statements.join('\n') + '\n';
  const report = {
    novel_id: novel.id,
    novel_title: novel.title,
    first_chapter: selected[0].number,
    last_chapter: selected[selected.length - 1].number,
    chapter_count: selected.length,
    total_published_chapters: novel.chapters.length,
    sql_bytes: Buffer.byteLength(sql, 'utf8'),
    mode: 'generated-only; not imported',
  };
  return { sql, report };
}

function argumentsFrom(argv) {
  const opts = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert(key && key.startsWith('--') && index + 1 < argv.length,
      'Expected --novel, --start, --limit, --out and --report arguments');
    opts[key.slice(2)] = argv[index + 1];
  }
  assert(opts.novel && opts.out && opts.report,
    'Required: --novel ID --out /tmp/chapters.sql --report /tmp/report.json');
  return {
    novelId: opts.novel,
    start: Number(opts.start ?? '1'),
    limit: Number(opts.limit ?? '5'),
    out: opts.out,
    report: opts.report,
  };
}

export function main(argv = process.argv.slice(2)) {
  const opts = argumentsFrom(argv);
  const generated = prepareBatch(opts);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.mkdirSync(path.dirname(opts.report), { recursive: true });
  fs.writeFileSync(opts.out, generated.sql);
  fs.writeFileSync(opts.report, JSON.stringify(generated.report, null, 2) + '\n');
  console.log(JSON.stringify(generated.report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
