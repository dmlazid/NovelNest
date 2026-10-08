import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('source chapter labels preserve split parts without a conflicting sequence prefix', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync('dist/chapter-labels.js', 'utf8'), context);
  const labels = context.window.NovelNestChapterLabels;
  assert.equal(labels.title('Chapter 1800: Chapter 1799 - Subduing the Bamboo Slip'), 'Chapter 1799 - Subduing the Bamboo Slip');
  assert.equal(labels.title('Chapter 7: Chapter 6.2 - Hero Hunting (3) Part 2'), 'Chapter 6.2 - Hero Hunting (3) Part 2');
  assert.equal(labels.title('Chapter 1700: \u200bChapter 1700: Quinn Museum'), 'Chapter 1700: Quinn Museum');
  assert.equal(labels.number({ title: 'Chapter 7: Chapter 6.2 - Hero Hunting' }, 7), '6.2');
});

test('reader enhancements safely skip the homepage and unknown novels', () => {
  const code = fs.readFileSync('dist/licensed-ui.js', 'utf8');
  const reader = code.slice(code.indexOf('  function fixReader'), code.indexOf('  function fixAbout'));
  assert.doesNotThrow(() => vm.runInNewContext(reader + ';fixReader(null);', { location: { pathname: '/', hash: '' } }));
});

test('footer links resolve to the same policy from home and nested chapters', () => {
  const index = fs.readFileSync('dist/index.html', 'utf8');
  const footer = index.slice(index.indexOf('<footer'));
  for (const [, href] of footer.matchAll(/href="([^"]+)"/g)) {
    const fromHome = new URL(href, 'https://novelhaven.top/');
    const fromChapter = new URL(href, 'https://novelhaven.top/novel/martial-god-asura/chapter-1800/');
    assert.equal(fromChapter.href, fromHome.href);
  }
});

test('static chapter loader uses absolute pages, rejects errors, and keeps navigation races isolated', async () => {
  const events = new Map(), requests = [], timers = [];
  const novel = { id: 'book', lazyChunks: {capacity:100,global:'CHAPTERS'}, chapters: [1,2].map(number => ({number,title:'Chapter '+number,lazy:true,paragraphs:['Loading chapter…']})) };
  const location = { hash:'', pathname:'/novel/book/chapter-1/' };
  const prose = {innerHTML:'',setAttribute(){}};
  let refreshes=0;
  const window = { NOVELNEST_STATIC_READERS:true, NOVELS:[novel], addEventListener:(name,fn)=>events.set(name,fn), NovelNestApp:{refresh(){refreshes++}} };
  const document = {querySelector:()=>prose,addEventListener:(name,fn)=>events.set('document:'+name,fn)};
  const context = vm.createContext({window,document,location,URLSearchParams,setTimeout:fn=>timers.push(fn),fetch:url=>new Promise(resolve=>requests.push({url,resolve})),DOMParser:class {parseFromString(text){const data=JSON.parse(text);return {querySelector:()=>({dataset:{staticChapter:data.id,chapterNumber:data.number},querySelectorAll:()=>data.paragraphs.map(textContent=>({textContent}))})}}}});
  vm.runInContext(fs.readFileSync('dist/lazy-chapters.js','utf8'),context);
  timers.shift()();
  assert.equal(requests[0].url,'/novel/book/chapter-1/');
  location.pathname='/novel/book/chapter-2/';events.get('novelnest:route-rendered')();timers.shift()();
  assert.equal(requests.length,2,'different chapters in the same former chunk need independent requests');
  requests[0].resolve({ok:true,text:async()=>JSON.stringify({id:'book',number:'1',paragraphs:['First chapter.']})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(novel.chapters[0].lazy,false);assert.equal(refreshes,0,'late previous chapter must not replace the active page');
  requests[1].resolve({ok:false,status:404});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(prose.innerHTML,/Try again/);assert.equal(novel.chapters[1].lazy,true);
  events.get('document:click')({target:{closest:()=>true}});
  requests[2].resolve({ok:true,text:async()=>JSON.stringify({id:'book',number:'2',paragraphs:['Second chapter.']})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(novel.chapters[1].lazy,false);assert.equal(refreshes,1);
});
