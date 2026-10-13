import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_CHAPTERS_PER_BATCH, chapterStatement, prepareBatch, sqlString,
  loadNovelCatalog,selectChapters,deletedChapterNumbers,readableChapterCount
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


test('imports title-numbered legacy chunks without accepting reordered chapters', () => {
  const {root, cleanup} = fixture();
  try {
    const catalogFile = path.join(root, 'licensed-sample.js');
    fs.writeFileSync(catalogFile, fs.readFileSync(catalogFile, 'utf8').replace('"capacity":100', '"capacity":100,"numberFromTitle":true'));
    const chunkFile = path.join(root, 'data/sample-01.js');
    const original = fs.readFileSync(chunkFile, 'utf8');
    fs.writeFileSync(chunkFile, original.replace(/"number":\d+,/g, ''));
    assert.equal(prepareBatch({root, novelId:'sample-novel', limit:2}).report.chapter_count, 2);
    fs.writeFileSync(chunkFile, fs.readFileSync(chunkFile, 'utf8').replace('Chapter 1:', 'Chapter 9:'));
    assert.throws(() => prepareBatch({root, novelId:'sample-novel'}), /numbering mismatch/);
    fs.writeFileSync(chunkFile, original.replace(/"number":\d+,/g, ''));
    fs.writeFileSync(catalogFile, fs.readFileSync(catalogFile, 'utf8').replace(',"numberFromTitle":true', ''));
    assert.throws(() => prepareBatch({root, novelId:'sample-novel'}), /numbering mismatch/);
  } finally { cleanup(); }
});

test('numbered duplicate tombstones are recognized and skipped by D1 exports',t=>{
  const {root,cleanup}=fixture();
  t.after(cleanup);
  const novelFile=path.join(root,'licensed-sample.js');
  const book=JSON.parse(fs.readFileSync(novelFile,'utf8').match(/window.NOVELS.push\((\{.*\})\);/)[1]);
  const original=JSON.parse(fs.readFileSync(path.join(root,'data/sample-01.js'),'utf8')
    .match(/window.SAMPLE_CHAPTERS = (\[.*\]);/)[1]);
  const removed={number:2,title:'Chapter 2',paragraphs:[],removedDuplicate:true};
  original[1]=removed;
  fs.writeFileSync(path.join(root,'data/sample-01.js'),'window.SAMPLE_CHAPTERS = '+JSON.stringify(original)+';');
  fs.writeFileSync(path.join(root,'removed-duplicates.js'),
    'window.NOVELS[0].chapters[1]={...window.NOVELS[0].chapters[1],paragraphs:[],lazy:false,removedDuplicate:true};');
  fs.writeFileSync(path.join(root,'index.html'),
    fs.readFileSync(path.join(root,'index.html'),'utf8')+'<script src="removed-duplicates.js"></script>');
  const novel=loadNovelCatalog(root)[0];
  assert.deepEqual(deletedChapterNumbers(novel),[2]);
  assert.equal(readableChapterCount(novel),1);
  const chapters=selectChapters(root,novel,1,2);
  assert.equal(chapters[1].removedDuplicate,true);
  assert.deepEqual(chapters[1].paragraphs,[]);
  const batch=prepareBatch({root,novelId:novel.id,start:1,limit:2});
  assert.equal(batch.report.chapter_count,1);
  assert(!batch.sql.includes("'Chapter 2'"));
  assert.throws(()=>prepareBatch({root,novelId:novel.id,start:2,limit:1}),
    /only deleted duplicate chapters/);
  assert.throws(()=>chapterStatement(novel.id,chapters[1]),/Missing chapter paragraphs/);
});
