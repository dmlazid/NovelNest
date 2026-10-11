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
  assert.match(ready,/>4 mins ago<\/time>/);
});
test('timestamps are detection times, not imported-at or catalog-updated times',()=>{
  const view=harness([book('a')]),now=Date.parse('2026-10-11T09:00:00Z');
  const time=view("releaseTimeLabel({sourceReleaseAt:'2026-10-11T08:56:00Z',lastChapterAddedAt:'2026-10-11T08:59:00Z'},"+now+")");
  assert.equal(time.label,'4 mins ago');
  const wrong=view("releaseTimeLabel({updated:'2026-10-11',lastChapterAddedAt:'2026-10-11T08:59:00Z'},"+now+")");
  assert.equal(wrong.label,'Time unavailable');
});
test('empty actual releases list shows a truthful explanation',()=>{
  const html=harness([book('import-only')])('home()');
  assert.match(html,/No verified new source chapters yet/);
  assert.doesNotMatch(html,/home-release-row/);
});
test('source release directory shows actual latest source numbers and time',()=>{
  const html=harness([source('source-updated'),book('old-backfill')])("directoryPage('releases')");
  assert.match(html,/Latest Novels/);
  assert.match(html,/Completed Novels/);
  assert.doesNotMatch(html,/Verified source chapter changes|New source chapters detected|local import progress|Source chapter updates/);
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
  assert.equal(wrong("releaseTimeLabel(novels[0])").label,'4 mins ago');
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
  assert.match(markup,/>4 days ago<\/span>/);
  assert.match(markup,/Syncing chapter to NovelHaven/);
});
test('source-reported hourly activity sorts ahead of older source updates',()=>{
  const one=source('detected',{sourceReleaseAt:'2026-10-10T09:00:00Z'});
  const newer=book('reported',{sourceIsOngoing:true,sourceActivityIsOngoing:true,
    sourceActivityVerified:true,sourceActivityObservedAt:'2026-10-11T08:59:00Z',
    sourceActivityAgeSeconds:3600,sourceActivityChapter:3,sourceActivityTitle:'Chapter 3'});
  const view=harness([one,newer]);
  assert.deepEqual(Array.from(view('latestOngoingReleases(novels)'), n=>n.id),['reported','detected']);
  assert.match(view('homeReleaseRow(novels[1])'),/>1 hour ago<\/span>/);
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

test('visible release times omit Source and Detected while tooltips keep timestamp provenance',()=>{
  const now='2026-10-11T09:00:00Z';
  const view=harness([
    source('first-seen'),
    book('source-reported',{
      sourceActivityVerified:true,sourceActivityIsOngoing:true,
      sourceActivityObservedAt:now,sourceActivityAgeSeconds:3600,
      sourceActivityChapter:3,sourceActivityTitle:'Chapter 3'
    })
  ],now);
  const first=view('homeReleaseRow(novels[0])');
  const reported=view('homeReleaseRow(novels[1])');
  assert.match(first,/>4 mins ago<\/time>/);
  assert.match(reported,/>1 hour ago<\/span>/);
  assert.match(first,/NovelHaven first detected source chapter growth/);
  assert.match(reported,/Approximate age reported by the original source/);
  assert.doesNotMatch(first,/home-release-time[^>]*>.*(?:Detected|Source:).*<\/time>/);
  assert.doesNotMatch(reported,/home-release-time[^>]*>.*(?:Detected|Source:).*<\/span>/);
  const yesterday=harness([book('yesterday',{sourceActivityVerified:true,sourceActivityIsOngoing:true,sourceActivityObservedAt:now,
    sourceActivityAgeSeconds:86400,sourceActivityChapter:3})],now);
  assert.equal(yesterday('releaseTimeLabel(novels[0]).label'),'Yesterday');
});

test('source recent chapter is not hidden when local importer is already ahead',()=>{
  const reported=book('source-newest-five',{
    chapters:Array.from({length:12},(_,i)=>({number:i+1,title:'Local '+(i+1)})),
    sourceActivityVerified:true,sourceActivityIsOngoing:true,
    sourceActivityObservedAt:'2026-10-11T09:00:00Z',
    sourceActivityAgeSeconds:7200,sourceActivityChapter:5,
    sourceActivityTitle:'Chapter 5: Genuine source update'
  });
  const view=harness([reported]);
  assert.deepEqual(Array.from(view('latestOngoingReleases(novels)'), n=>n.id),['source-newest-five']);
  const markup=view('homeReleaseRow(novels[0])');
  assert.match(markup,/Chapter 5: Genuine source update/);
  assert.match(markup,/>2 hours ago<\/span>/);
});

test('Latest Novels cards prioritize genuine five-day updates without using chapter imports',()=>{
  const recent=Array.from({length:13},(_,i)=>source('fresh-'+i,{
    sourceReleaseAt:'2026-10-11T08:'+String(59-i).padStart(2,'0')+':00Z'
  }));
  const backfills=Array.from({length:4},(_,i)=>book('backfill-'+i,{
    updated:'2026-10-11',lastChapterAddedAt:'2026-10-11T08:59:00Z'
  }));
  const view=harness([...recent,...backfills]);
  const html=view('home()');
  const area=html.split('<h2><span aria-hidden="true">↻</span> Latest Novels</h2>')[1]
    .split('</section>')[0];
  assert.equal((area.match(/class="home-novel-tile"/g)||[]).length,6);
  assert.doesNotMatch(area,/backfill-/);
  assert.match(area,/fresh-/);
});
test('Latest Novels full directory orders real releases ahead of imported older novels',()=>{
  const v=harness([
    book('a-old-import',{updated:'2026-10-11',lastChapterAddedAt:'2026-10-11T08:59:00Z'}),
    source('z-first',{sourceReleaseAt:'2026-10-11T08:50:00Z'}),
    source('y-newest',{sourceReleaseAt:'2026-10-11T08:58:00Z'})
  ]);
  const html=v("directoryPage('novels')");
  const newer=html.indexOf('/novel/y-newest/');
  const earlier=html.indexOf('/novel/z-first/');
  const old=html.indexOf('/novel/a-old-import/');
  assert(newer>=0 && earlier>=0 && old>=0);
  assert(newer < earlier && earlier < old);
});
