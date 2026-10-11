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
  assert.match(ready,/New chapter detected/);
});
test('timestamps are detection times, not imported-at or catalog-updated times',()=>{
  const view=harness([book('a')]),now=Date.parse('2026-10-11T09:00:00Z');
  const time=view("releaseTimeLabel({sourceReleaseAt:'2026-10-11T08:56:00Z',lastChapterAddedAt:'2026-10-11T08:59:00Z'},"+now+")");
  assert.equal(time.label,'New chapter detected');
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
  assert.match(html,/Source chapter updates · last 5 days/);
  assert.match(html,/source-updated/);
  assert.doesNotMatch(html,/old-backfill/);
});

test('verified source publication time is distinguished from import detection',()=>{
  const n=source('published',{sourcePublishedAt:'2026-10-11T08:56:00Z',sourcePublishedChapter:3,sourcePublishedVerified:true});
  const view=harness([n]);
  const time=view("releaseTimeLabel(novels[0],Date.parse('2026-10-11T09:00:00Z'))");
  assert.equal(time.label,'4 mins ago');
  assert.match(time.full,/Verified original source publication/);
  const wrong=harness([source('mismatch',{sourcePublishedAt:'2026-10-11T08:56:00Z',sourcePublishedChapter:2,sourcePublishedVerified:true})]);
  assert.equal(wrong("releaseTimeLabel(novels[0])").label,'New chapter detected');
});

test('source-reported chapters within five days appear even before tracking baseline; old imports do not',()=>{
  const reported=book('source-five-days',{
    sourceIsOngoing:true,
    sourceActivityVerified:true,sourceActivityIsOngoing:true,
    sourceActivityObservedAt:'2026-10-11T08:59:00Z',
    sourceActivityAgeSeconds:4*86400,sourceActivityChapter:5,
    sourceActivityTitle:'Chapter 5: Real source update',
    chapters:Array.from({length:3},(_,i)=>({title:'Chapter '+(i+1)}))
  });
  const view=harness([
    book('imported-hundreds',{lastChapterAddedAt:'2026-10-11T08:59:00Z',
      chapters:Array(500).fill({title:'Older chapter'})}),reported,
    book('source-eighteen-days',{...reported,id:'source-eighteen-days',sourceActivityAgeSeconds:18*86400})
  ]);
  assert.deepEqual(Array.from(view('latestOngoingReleases(novels)'), n=>n.id),['source-five-days']);
  const markup=view('homeReleaseRow(novels[1])');
  assert.match(markup,/Chapter 5: Real source update/);
  assert.match(markup,/Source: about 4 days ago/);
  assert.match(markup,/Syncing chapter to NovelHaven/);
});
test('source-reported hourly activity sorts ahead of older source updates',()=>{
  const one=source('detected',{sourceReleaseAt:'2026-10-10T09:00:00Z'});
  const newer=book('reported',{sourceIsOngoing:true,sourceActivityIsOngoing:true,
    sourceActivityVerified:true,sourceActivityObservedAt:'2026-10-11T08:59:00Z',
    sourceActivityAgeSeconds:3600,sourceActivityChapter:3,sourceActivityTitle:'Chapter 3'});
  const view=harness([one,newer]);
  assert.deepEqual(Array.from(view('latestOngoingReleases(novels)'), n=>n.id),['reported','detected']);
  assert.match(view('homeReleaseRow(novels[1])'),/Source: about 1 hour ago/);
});

test('five-day rolling cutoff excludes older source reports and import-only changes',()=>{
  const now='2026-10-11T09:00:00Z';
  const report=(id,age,status='Ongoing')=>book(id,{status,
    sourceActivityVerified:true,sourceActivityIsOngoing:true,
    sourceActivityObservedAt:now,sourceActivityAgeSeconds:age,
    sourceActivityChapter:3,sourceActivityTitle:'Chapter 3'});
  const view=harness([report('within',4*86400),report('exactly-five',5*86400),
    report('over-five',6*86400),report('source-ongoing-cached-completed',3600,'Completed'),
    book('just-imported',{lastChapterAddedAt:now})],now);
  const shown=Array.from(view('latestOngoingReleases(novels)'),n=>n.id);
  assert.deepEqual(shown,['source-ongoing-cached-completed','within']);
  assert.equal((view('home()').match(/class="home-release-row"/g)||[]).length,2);
});
test('homepage includes every five-day source update without top ten truncation',()=>{
  const rows=Array.from({length:13},(_,i)=>book('novel-'+i,{
    sourceActivityVerified:true,sourceActivityIsOngoing:true,
    sourceActivityObservedAt:'2026-10-11T09:00:00Z',
    sourceActivityAgeSeconds:(i+1)*3600,sourceActivityChapter:3,
    sourceActivityTitle:'Chapter 3'}));
  const view=harness(rows);
  assert.equal((view('home()').match(/class="home-release-row"/g)||[]).length,13);
  assert.equal(Array.from(view('latestOngoingReleases(novels)')).length,13);
});
