import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const window = {};
vm.runInNewContext(fs.readFileSync('dist/account-sync.js', 'utf8'), { window });
const { empty, merge, updates } = window.NovelNestSync;
const plain = value => JSON.parse(JSON.stringify(value));

test('stale devices do not resurrect cloud removals, while new bookmark changes are merged', () => {
  const base = empty(), local = empty(), remote = empty();
  base.data.saved = ['a']; local.data.saved = ['a', 'b']; remote.data.saved = ['c'];
  assert.deepEqual(plain(merge(base, local, remote).data.saved), ['c', 'b']);
  local.data.saved = []; remote.data.saved = ['a', 'c'];
  assert.deepEqual(plain(merge(base, local, remote).data.saved), ['c']);
});

test('finished undo syncs without erasing a different chapter finished remotely', () => {
  const base = empty(), local = empty(), remote = empty();
  base.data.chapterStatus.a = { started: [1], finished: [1] };
  local.data.chapterStatus.a = { started: [1], finished: [] };
  remote.data.chapterStatus.a = { started: [1, 2], finished: [1, 2] };
  assert.deepEqual(plain(merge(base, local, remote).data.chapterStatus.a), { started: [1, 2], finished: [2] });
});

test('newer reading positions win and position history stays bounded', () => {
  const base = empty(), local = empty(), remote = empty();
  local.data.progress.a = { chapter: 3, at: 100 }; remote.data.progress.a = { chapter: 4, at: 200 };
  for(let i=0;i<205;i++) local.data.positions['a:'+i] = { at: i };
  const result = merge(base, local, remote);
  assert.equal(result.data.progress.a.chapter, 4);
  assert.equal(Object.keys(result.data.positions).length, 200);
  assert.equal(result.data.positions['a:0'], undefined);
});

test('edits during a sync request survive applying its result', () => {
  const sent = empty(), latest = empty(), result = empty();
  sent.data.saved = ['a']; latest.data.saved = []; result.data.saved = ['a', 'b'];
  assert.deepEqual(plain(merge(sent, latest, result).data.saved), ['b']);
});

test('chapter alerts only include newly added chapters of saved novels and acknowledgements merge', () => {
  const state = empty(); state.data.saved = ['a']; state.seen.a = 2;
  const novels = [{id:'a',title:'A',chapters:[1,2,3,4]}, {id:'b',title:'B',chapters:[1,2]}];
  assert.deepEqual(plain(updates(novels, state)), [{id:'a',title:'A',count:2,first:3}]);
  const acknowledged = empty(); acknowledged.seen.a = 4;
  const merged = merge(empty(), acknowledged, state);
  assert.deepEqual(plain(updates(novels, merged)), []);
});
