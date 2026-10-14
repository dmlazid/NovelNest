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
  const novels = [{id:'a',title:'A',chapters:[1,2,3,4],sourceIsOngoing:true,sourceReleaseFirst:3,
    sourceReleaseNumber:4,sourceReleaseAt:new Date(Date.now()-60000).toISOString()}, {id:'b',title:'B',chapters:[1,2]}];
  assert.deepEqual(plain(updates(novels, state)), [{id:'a',title:'A',count:2,first:3}]);
  const acknowledged = empty(); acknowledged.seen.a = 4;
  const merged = merge(empty(), acknowledged, state);
  assert.deepEqual(plain(updates(novels, merged)), []);
});


test('backfill checkpoints and unsynced releases never generate false notifications',()=>{
 const state=empty(); state.data.saved=['a']; state.seen.a=10;
 const old={id:'a',title:'A',chapters:Array(500).fill(1),lastChapterAddedAt:new Date().toISOString()};
 assert.deepEqual(plain(updates([old],state)),[]);
 const metadata={...old,sourceIsOngoing:true,sourceReleaseAt:new Date().toISOString(),
   sourceReleaseFirst:501,sourceReleaseNumber:501};
 assert.deepEqual(plain(updates([metadata],state)),[]);
 metadata.chapters.push(1);
 assert.deepEqual(plain(updates([metadata],state)),[{id:'a',title:'A',count:1,first:501}]);
});

test('last deliberately opened chapter wins by time, including moving backwards',()=>{
  const base=empty(),local=empty(),remote=empty();
  local.data.progress.story={chapter:25,at:100};
  remote.data.progress.story={chapter:17,at:150};
  assert.deepEqual(plain(merge(base,local,remote).data.progress.story),{chapter:17,at:150});
  local.data.progress.story={chapter:16,at:200};
  assert.deepEqual(plain(merge(base,local,remote).data.progress.story),{chapter:16,at:200});
  local.data.progress.story={chapter:26,at:220};
  assert.equal(merge(base,local,remote).data.progress.story.chapter,26);
});
