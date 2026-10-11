import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
function book(id,extra={}){
  return {id,title:id,author:'Author',genre:'Fantasy',tags:['Fantasy'],status:'Ongoing',
    updated:'2026-10-11',cover:'/assets/'+id+'.jpg',externalUrl:'',
    chapters:Array.from({length:3},(_,i)=>({number:i+1,title:'Chapter '+(i+1)})),...extra};
}
function harness(books,now='2026-10-11T09:00:00Z'){
  const source=fs.readFileSync('dist/app.js','utf8');
  const code=source.slice(0,source.indexOf("main.addEventListener('submit'"));
  const context=vm.createContext({window:{NOVELS:books,sessionStorage:{getItem:()=>null,setItem:()=>{}}},
    document:{querySelector:()=>({}),body:{},documentElement:{}},
    localStorage:{getItem:()=>null},URLSearchParams,console,
    Date:class FixedDate extends Date{static now(){return Date.parse(now)}}});
  vm.runInContext(code,context);
  return expr=>vm.runInContext(expr,context);
}
const source=(id,more={})=>book(id,{sourceIsOngoing:true,sourceObservedChapter:3,
  sourceReleaseFirst:3,sourceReleaseNumber:3,sourceReleaseAt:'2026-10-11T08:56:00Z',...more});
test('local imports never appear as source releases even when marked updated now',()=>{
  const records=[book('import-of-old-chapters',{lastChapterAddedAt:'2026-10-11T08:59:00Z',
    chapters:Array(500).fill({title:'Old'})}),source('actual-new'),source('finished',{sourceIsOngoing:false}),
    source('old',{sourceReleaseAt:'2026-09-11T08:00:00Z'})];
  const view=harness(records);
  const result=Array.from(view('latestOngoingReleases(novels)'),x=>x.id);
  assert.deepEqual(result,['actual-new']);
  const html=view('home()').split('home-release-list">')[1].split('</section>')[0];
  assert.match(html,/actual-new/);
  assert.doesNotMatch(html,/import-of-old-chapters|finished|old/);
});
test('unavailable newly released chapter never points to a nonexistent local chapter',()=>{
  const view=harness([source('waiting',{sourceReleaseNumber:10,sourceReleaseTitle:'Chapter 10: New'}),source('ready')]);
  const waiting=view('homeReleaseRow(novels[0])');
  assert.match(waiting,/href="\/novel\/waiting\/"/);
  assert.match(waiting,/Syncing chapter to NovelHaven/);
  const ready=view('homeReleaseRow(novels[1])');
  assert.match(ready,/href="\/novel\/ready\/chapter-3\/"/);
  assert.match(ready,/Detected 4 mins ago/);
});
test('timestamps are detection times, not imported-at or catalog-updated times',()=>{
  const view=harness([book('a')]),now=Date.parse('2026-10-11T09:00:00Z');
  const time=view("releaseTimeLabel({sourceReleaseAt:'2026-10-11T08:56:00Z',lastChapterAddedAt:'2026-10-11T08:59:00Z'},"+now+")");
  assert.equal(time.label,'Detected 4 mins ago');
  const wrong=view("releaseTimeLabel({updated:'2026-10-11',lastChapterAddedAt:'2026-10-11T08:59:00Z'},"+now+")");
  assert.equal(wrong.label,'Source update');
});
test('empty actual releases list shows a truthful explanation',()=>{
  const html=harness([book('import-only')])('home()');
  assert.match(html,/No verified new source chapters yet/);
  assert.doesNotMatch(html,/home-release-row/);
});
test('source release directory shows actual latest source numbers and time',()=>{
  const html=harness([source('source-updated'),book('old-backfill')])("directoryPage('releases')");
  assert.match(html,/Detected source chapters · last 7 days/);
  assert.match(html,/source-updated/);
  assert.doesNotMatch(html,/old-backfill/);
});
