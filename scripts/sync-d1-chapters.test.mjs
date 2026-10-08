import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkCapacity, firstMissingNumber, prioritizeNovels,
  syncPublishedChapters, validateOptions, D1Client, SOFT_LIMIT_BYTES,
} from './sync-d1-chapters.mjs';

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'novelhaven-auto-d1-'));
  const root = path.join(parent, 'dist');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const make = (id, chapters) => {
    const novel = {
      id, title: id, chapters: chapters.map(c => ({ number: c.number, title: c.title })),
      lazyChunks: { prefix: 'data/' + id + '-', capacity: 100, global: id.toUpperCase() + '_CHAPTERS' },
    };
    fs.writeFileSync(path.join(root, 'licensed-' + id + '.js'), 'window.NOVELS.push(' +
      JSON.stringify(novel) + ');');
    fs.writeFileSync(path.join(root, 'data/' + id + '-01.js'), 'window.' +
      novel.lazyChunks.global + '=' + JSON.stringify(chapters) + ';');
    return novel;
  };
  const books = [
    make('a', [1, 2, 3].map(n => ({ number: n, title: 'Chapter ' + n, paragraphs: ['This is chapter ' + n] }))),
    make('b', [1, 2].map(n => ({ number: n, title: 'Chapter ' + n, paragraphs: ["It's chapter " + n] }))),
  ];
  fs.writeFileSync(path.join(root, 'index.html'),
    '<script src="catalog.js"></script><script src="licensed-a.js"></script><script src="licensed-b.js"></script>');
  fs.writeFileSync(path.join(root, 'catalog.js'), 'window.NOVELS=[];');
  return { root, books, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

class FakeD1 {
  constructor() { this.rows = new Map(); this.bytes = 1024; this.writeCalls = 0; }
  key(id, number) { return id + ':' + number; }
  async size() { return this.bytes; }
  async query(sql, params = []) {
    if (sql.startsWith('SELECT novel_id, COUNT(*)')) {
      const values = new Map();
      for (const key of this.rows.keys()) {
        const [id, num] = key.split(':');
        if (!values.has(id)) values.set(id, []);
        values.get(id).push(Number(num));
      }
      return { results: [...values].map(([id, numbers]) => ({
        novel_id: id,
        stored: numbers.length,
        minimum: Math.min(...numbers),
        maximum: Math.max(...numbers),
      })) };
    }
    if (sql.startsWith('SELECT chapter_number')) {
      const matches = [...this.rows.keys()]
        .filter(key => key.startsWith(params[0] + ':'))
        .map(key => ({ chapter_number: Number(key.split(':')[1]) }));
      return { results: matches };
    }
    if (sql.startsWith('INSERT INTO chapters')) {
      this.writeCalls++;
      const [id, number, title, paragraphs] = params;
      const key = this.key(id, number);
      if (this.rows.has(key)) return { results: [], meta: { changes: 0, rows_written: 0 } };
      this.rows.set(key, { title, paragraphs });
      this.bytes += Buffer.byteLength(paragraphs) * 2 + 100;
      return { results: [], meta: { changes: 1, rows_written: 1 } };
    }
    throw Error('Unexpected SQL in fake D1');
  }
}

test('fails closed when storage limit or size validation fails', () => {
  assert.equal(checkCapacity(2048, 1000), true);
  assert.equal(checkCapacity(SOFT_LIMIT_BYTES - 20_000, 1000), false);
  assert.throws(() => checkCapacity(-1), /size unavailable/);
  assert.throws(() => validateOptions({ mode: 'import', maxChapters: 501 }), /between 1 and 500/);
  assert.throws(() => validateOptions({ mode: 'unknown' }), /plan or import/);
});

test('recognizes complete, partial and gapped chapter progress', () => {
  assert.equal(firstMissingNumber(5, null), 1);
  assert.equal(firstMissingNumber(5, { stored: 5, minimum: 1, maximum: 5 }), null);
  assert.equal(firstMissingNumber(5, { stored: 2, minimum: 1, maximum: 2 }), 3);
  assert.equal(firstMissingNumber(5, { stored: 2, minimum: 1, maximum: 4 }), undefined);
  assert.equal(firstMissingNumber(5, { stored: 2, minimum: 1, maximum: 4 },
    [{chapter_number: 1}, {chapter_number: 4}]), 2);
});

test('prioritizes novels with the least progress, never completed ones', () => {
  const novels = [
    {id:'a', chapters: Array(10).fill({})},
    {id:'b', chapters: Array(20).fill({})},
    {id:'c', chapters: Array(2).fill({})},
  ];
  const stats = new Map([
    ['a', {stored:5, minimum:1, maximum:5}],
    ['b', {stored:0, minimum:0, maximum:0}],
    ['c', {stored:2, minimum:1, maximum:2}],
  ]);
  assert.deepEqual(prioritizeNovels(novels, stats).map(x=>x.id), ['b', 'a']);
});

test('plan never writes, import resumes without duplicating existing chapters', async () => {
  const f = fixture();
  try {
    const client = new FakeD1();
    const plan = await syncPublishedChapters({client, root:f.root, mode:'plan', maxChapters:5});
    assert.equal(plan.inserted_chapters, 0);
    assert.equal(client.rows.size, 0);
    const first = await syncPublishedChapters({client, root:f.root, mode:'import', maxChapters:3});
    assert.equal(first.inserted_chapters, 3);
    assert.equal(client.rows.size, 3);
    const second = await syncPublishedChapters({client, root:f.root, mode:'import', maxChapters:3});
    assert.equal(second.inserted_chapters, 2);
    assert.equal(client.rows.size, 5);
    const complete = await syncPublishedChapters({client, root:f.root, mode:'import', maxChapters:3});
    assert.equal(complete.inserted_chapters, 0);
    assert.equal(complete.stop_reason, 'no_pending_chapters');
  } finally { f.cleanup(); }
});

test('database capacity prevents all remote writes while keeping readers unchanged', async () => {
  const f = fixture();
  try {
    const client = new FakeD1();
    client.bytes = SOFT_LIMIT_BYTES - 20_000;
    const report = await syncPublishedChapters({client, root:f.root, mode:'import', maxChapters:3});
    assert.equal(report.stop_reason, 'capacity_guard_reached');
    assert.equal(client.writeCalls, 0);
  } finally { f.cleanup(); }
});

test('Cloudflare client rejects invalid IDs before making requests', () => {
  assert.throws(() => new D1Client({token: 'secret', accountId: 'bad'}), /Invalid CLOUDFLARE_ACCOUNT_ID/);
  assert.throws(() => new D1Client({
    token: 'secret', accountId:'a'.repeat(32), databaseId:'a'.repeat(36),
  }), /Unrecognized D1 database/);
});

test('D1 REST API parses valid GET and query envelopes', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({url, method:options.method});
    const result = options.method === 'GET' ?
      {uuid:'61109519-a023-4ab3-9b2b-8b990752126e', file_size:8192} :
      [{results:[{novel_id:'a', stored:0}], success:true, meta:{size_after:8192}}];
    return {ok:true, status:200, json: async()=>({success:true, result})};
  };
  const client = new D1Client({token:'secret', accountId:'a'.repeat(32), fetchFn:fakeFetch});
  assert.equal(await client.size(),8192);
  const result = await client.query('SELECT ?', ['hello']);
  assert.equal(result.results[0].novel_id,'a');
  assert.equal(calls.length,2);
});
