import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Load the exact homepage functions shipped to users without depending on the
// full chapter catalog. This catches both release leakage and layout regressions.
function makeNovel(id,{status='Ongoing',updated='2026-10-10',chapters=3,external=false}={}){
  return {id,title:id,author:'Author',genre:'Fantasy',tags:['Fantasy'],status,
    updated,cover:'/assets/'+id+'.jpg',externalUrl:external?'https://example.org':'',
    chapters:Array.from({length:chapters},(_,i)=>({number:i+1,title:'Chapter '+(i+1)}))};
}
function pageHarness(books,{now='2026-10-11T09:00:00Z',seed=0.1,storage}={}){
  const code=fs.readFileSync('dist/app.js','utf8');
  const prefix=code.slice(0,code.indexOf("main.addEventListener('submit'"));
  assert(prefix.includes('function latestOngoingReleases'));
  const session=new Map(storage||[]);
  const pseudoMath=Object.create(Math);
  let state=Math.floor(seed*4294967295)>>>0;
  pseudoMath.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const context=vm.createContext({
    window:{NOVELS:books,sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)}},
    document:{querySelector:()=>({}),body:{},documentElement:{}},
    localStorage:{getItem:()=>null},
    URLSearchParams,Date:class FixedDate extends Date { static now(){ return Date.parse(now); } },Math:pseudoMath,console,
  });
  vm.runInContext(prefix,context);
  return {context,session,
    render:expr=>vm.runInContext(expr,context),
    releases:()=>Array.from(vm.runInContext('latestOngoingReleases(novels,'+Date.parse(now)+')',context),n=>n.id)};
}

test('release list excludes completed, old, future-dated, and external novels',()=>{
  const books=[
    makeNovel('today',{updated:'2026-10-11'}),
    makeNovel('week',{updated:'2026-10-06'}),
    makeNovel('boundary-old',{updated:'2026-10-04'}),
    makeNovel('completed',{status:'Completed',updated:'2026-10-11'}),
    makeNovel('old',{updated:'2026-09-20'}),
    makeNovel('future',{updated:'2026-12-11'}),
    makeNovel('external',{updated:'2026-10-11',external:true}),
    makeNovel('empty',{updated:'2026-10-11',chapters:0}),
  ];
  const site=pageHarness(books);
  assert.deepEqual(site.releases(),['today','week']);
  const list=site.render("directoryPage('releases')");
  assert.match(list,/today/);
  assert.match(list,/week/);
  for(const banned of ['completed','old','boundary-old','future','external','empty']){
    assert.doesNotMatch(list,new RegExp('href="/novel/'+banned+'/'));
  }
  assert.match(list,/Ongoing · last 7 days/);
  assert.doesNotMatch(list,/>All novels</);
});

test('homepage release feed shows only updated ongoing stories; finished books have their own section',()=>{
  const books=[
    makeNovel('recent-ongoing',{updated:'2026-10-11'}),
    makeNovel('finished-now',{status:'Completed',updated:'2026-10-11'}),
    makeNovel('stale-ongoing',{updated:'2026-01-01'}),
    ...Array.from({length:25},(_,i)=>makeNovel('story-'+i,{updated:'2026-10-10',status:i%5?'Ongoing':'Completed'})),
  ];
  const site=pageHarness(books);
  const html=site.render('home()');
  const release=html.split('home-release-list">')[1].split('</section>')[0];
  assert.match(release,/recent-ongoing/);
  assert.doesNotMatch(release,/finished-now|stale-ongoing/);
  assert.match(html,/Completed Novels/);
  const allFeatured=[...html.matchAll(/class="home-top-(?:feature|row)" href="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(allFeatured.length,7);
  assert.equal(new Set(allFeatured).size,7);
});

test('featured rotation avoids repeating prior seven when enough books exist',()=>{
  const books=Array.from({length:32},(_,i)=>makeNovel('story-'+i));
  const first=pageHarness(books,{seed:0.14});
  const firstIds=JSON.parse(first.session.get('novelhaven.previousFeatured')||'[]');
  assert.equal(firstIds.length,0,'home not rendered yet');
  first.render('home()');
  const previous=JSON.parse(first.session.get('novelhaven.previousFeatured'));
  const second=pageHarness(books,{seed:0.83,storage:first.session});
  second.render('home()');
  const next=JSON.parse(second.session.get('novelhaven.previousFeatured'));
  assert.equal(previous.length,7);
  assert.equal(next.length,7);
  assert.equal(new Set([...previous,...next]).size,14,'refresh should show different featured books');
  assert.deepEqual(second.releases().length,32);
});

test('homepage gives helpful empty state when no current ongoing releases exist',()=>{
  const site=pageHarness([makeNovel('old-story',{status:'Completed'}),makeNovel('older-ongoing',{updated:'2026-01-01'})]);
  const html=site.render('home()');
  assert.match(html,/No ongoing novels have a recent chapter update listed this week/);
  assert.doesNotMatch(html,/home-release-row/);
});

test('release timestamp labels are accurate and dates without hours never invent minutes',()=>{
  const site=pageHarness([makeNovel('ongoing')]);
  const now=Date.parse('2026-10-11T09:00:00Z');
  const precise=site.render("releaseTimeLabel({lastChapterAddedAt:'2026-10-11T08:56:00Z',updated:'2026-10-11'},"+now+")");
  assert.equal(precise.label,'4 mins ago');
  assert.equal(precise.full,'Added to NovelHaven: 2026-10-11T08:56:00Z');
  const byDay=site.render("releaseTimeLabel({updated:'2026-10-10'},"+now+")");
  assert.equal(byDay.label,'Updated Oct 10');
  assert.doesNotMatch(byDay.label,/min|hour/i);
});

test('release items show readable chapter details and timestamp without fake source times',()=>{
  const books=[makeNovel('newer',{updated:'2026-10-11'})];
  books[0].lastChapterAddedAt='2026-10-11T08:56:00Z';
  const site=pageHarness(books,{now:'2026-10-11T09:00:00Z'});
  const row=site.render("homeReleaseRow(novels[0])");
  assert.match(row,/home-release-genres/);
  assert.match(row,/home-release-chapter/);
  assert.match(row,/home-release-time/);
  assert.match(row,/datetime="2026-10-11T08:56:00Z"/);
  assert.match(row,/ago/);
});
