import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('dist/app.js','utf8');
const pairs=[['supreme-magus',1915],['supreme-magus',1916],['my-rich-wife',752],['my-rich-wife',872],['reborn-at-boot-camp-general-dont-mess-around',3670],['necropolis-immortal',1587],['necropolis-immortal',1765],['martial-peak',5178],['martial-god-asura',6012]];
test('exactly nine previously audited duplicate chapter routes are excluded',()=>{
  const head=source.slice(source.indexOf('const removedDuplicateChapters='),source.indexOf('const chapterTitle='));
  const ctx=vm.createContext({});
  vm.runInContext(head+';globalThis.audit={removedDuplicateChapters,isRemovedDuplicate,visibleChapterIndexes,adjacentChapter};',ctx);
  const audit=ctx.audit;
  assert.equal([...audit.removedDuplicateChapters.values()].reduce((n,set)=>n+set.size,0),9);
  for(const [id,number] of pairs){
    const n={id,chapters:Array.from({length:number+2},(_,i)=>({number:i+1}))};
    assert(audit.isRemovedDuplicate(n,number-1),id+': '+number);
    assert(!audit.visibleChapterIndexes(n).includes(number-1));
    assert.equal(audit.adjacentChapter(n,number-1,1),number);
  }
  const novel={id:'supreme-magus',chapters:Array.from({length:1918},()=>({}))};
  assert.equal(audit.adjacentChapter(novel,1913,1),1916);
  assert.equal(audit.adjacentChapter(novel,1916,-1),1913);
  assert(!audit.isRemovedDuplicate({id:'shadow-slave',chapters:[{}]},0));
});
test('reader and chapter table hide duplicate entries without changing chapter numbering',()=>{
  assert.match(source,/n\.chapters\.flatMap\(\(c,i\)=>isRemovedDuplicate\(n,i\)\?\[\]:\[/);
  assert.match(source,/if\(isRemovedDuplicate\(n,i\)\)/);
  assert.match(source,/const adjacentChapter=/);
  assert.match(source,/Duplicate chapter removed/);
  assert.match(source,/chapter-\$\{i\+1\}/);
});
