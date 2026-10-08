import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_CHAPTERS_PER_BATCH, chapterStatement, prepareBatch, sqlString
} from './export-d1-batch.mjs';

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'novelhaven-d1-'));
  const root = path.join(parent, 'dist');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const chapters = [
    { number: 1, title: "Chapter 1: A's book", paragraphs: ["It's ready", 'Second paragraph'] },
    { number: 2, title: 'Chapter 2', paragraphs: ['Another chapter'] },
  ];
  const novel = {
    id: 'sample-novel',
    title: 'Sample novel',
    chapters: chapters.map(c => ({ number: c.number, title: c.title, lazy: true })),
    lazyChunks: { prefix: 'data/sample-', capacity: 100, global: 'SAMPLE_CHAPTERS' },
  };
  fs.writeFileSync(path.join(root, 'index.html'),
    '<script defer src="catalog.js"></script><script defer src="licensed-sample.js"></script>');
  fs.writeFileSync(path.join(root, 'catalog.js'), 'window.NOVELS = [];');
  fs.writeFileSync(path.join(root, 'licensed-sample.js'),
    'window.NOVELS.push(' + JSON.stringify(novel) + ');');
  fs.writeFileSync(path.join(root, 'data/sample-01.js'),
    'window.SAMPLE_CHAPTERS = ' + JSON.stringify(chapters) + ';');
  return {
    root,
    cleanup: () => fs.rmSync(parent, { recursive: true, force: true }),
  };
}

test('escapes apostrophes in D1 SQL', () => {
  assert.equal(sqlString("A's"), "'A''s'");
  const statement = chapterStatement('test', {
    number: 1, title: "Chapter's start", paragraphs: ["It's safe"],
  });
  assert.match(statement, /Chapter''s start/);
  assert.match(statement, /It''s safe/);
  assert.match(statement, /ON CONFLICT\(novel_id, chapter_number\)/);
});

test('exports only the requested range with original title and paragraphs', () => {
  const { root, cleanup } = fixture();
  try {
    const { sql, report } = prepareBatch({ root, novelId: 'sample-novel', start: 2, limit: 1 });
    assert.equal(report.chapter_count, 1);
    assert.equal(report.first_chapter, 2);
    assert.equal(report.last_chapter, 2);
    assert.match(sql, /Chapter 2/);
    assert.doesNotMatch(sql, /Chapter 1/);
    assert.doesNotMatch(sql, /CREATE TABLE/);
  } finally { cleanup(); }
});

test('caps importer batch sizes and rejects unavailable novels', () => {
  const { root, cleanup } = fixture();
  try {
    assert.throws(() => prepareBatch({
      root, novelId: 'sample-novel', limit: MAX_CHAPTERS_PER_BATCH + 1,
    }), /Count must be between/);
    assert.throws(() => prepareBatch({ root, novelId: 'missing-novel' }), /No published novel/);
    assert.throws(() => prepareBatch({ root, novelId: 'sample-novel', start: 500 }), /beyond last/);
  } finally { cleanup(); }
});

test('rejects SQL statements exceeding Cloudflare limits before any import', () => {
  assert.throws(() => chapterStatement('test', {
    number: 1, title: 'Too long', paragraphs: ['x'.repeat(110_000)],
  }), /SQL statement limit/);
});

test('fails if a chapter has broken or missing metadata', () => {
  const { root, cleanup } = fixture();
  try {
    const file = path.join(root, 'data/sample-01.js');
    const broken = [{ number: 8, title: 'Wrong chapter', paragraphs: ['Broken'] }];
    fs.writeFileSync(file, 'window.SAMPLE_CHAPTERS = ' + JSON.stringify(broken));
    assert.throws(() => prepareBatch({ root, novelId: 'sample-novel' }), /numbering mismatch/);
  } finally { cleanup(); }
});
