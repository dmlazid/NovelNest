import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../dist/',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const ad='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9356195452195758';
const legal=[
  'about.html','contact.html','copyright.html','editorial-policy.html',
  'content-licensing.html','advertising-disclosure.html','privacy.html',
  'privacy-choices.html','terms.html'
];

test('policy and account privacy utility pages do not request ad code',()=>{
  for(const path of legal){
    const html=read(path);
    assert(!html.includes(ad),path+': legal or utility page should not load advertising code');
    assert(html.includes('<h1>'),path+': missing useful page content');
    assert(html.includes('<main id="main"'),path+': missing main landmark');
    assert(html.includes('https://novelhaven.top/'+path),path+': missing canonical URL');
    assert(html.includes('Novel<span>Haven</span>'),path+': wrong brand');
    assert(!html.includes('Novel<span>Nest</span>'),path+': old brand still present');
  }
});

test('publisher verification remains untouched on the homepage and original reading guides',()=>{
  for(const path of ['index.html','reading-desk.html','guide-reading-list.html']){
    assert(read(path).includes(ad),path+': publisher verification must be preserved');
  }
  assert.match(read('ads.txt'),/^google\.com, pub-9356195452195758, DIRECT, f08c47fec0942fa0/m);
});

test('privacy controls are clearly described as local, not account deletion or ad consent',()=>{
  const choices=read('privacy-choices.html');
  assert(choices.includes('data-clear-novelnest'),'Existing local clear button must still work');
  assert(choices.includes('privacy-controls.js'),'Privacy controls script must still be loaded');
  assert(choices.includes('does not erase synced Firebase account data'));
  assert(choices.includes('set advertising consent'));
  assert(choices.includes('Approval not confirmed'));
  assert(!choices.includes('Under review setup'));
});

test('rights pages avoid blanket title licensing assertions and public secrets disclosure',()=>{
  const app=read('app.js');
  assert(!app.includes('Licensed edition'),'Novel-specific verified licenses must not be implied');
  assert(app.includes('NovelHaven reader'));
  const copyright=read('copyright.html'),licensing=read('content-licensing.html');
  assert(copyright.includes('publicly visible'));
  assert(copyright.includes('do not')||copyright.includes('Do not'));
  assert(licensing.includes('Rights checks are specific to each work'));
  assert(licensing.includes('does not establish permission by itself'));
  assert(read('about.html').includes('Importing an older chapter into NovelHaven is not presented as a new release'));
});

test('copyright, privacy and contact pages are discoverable from site footer',()=>{
  const home=read('index.html');
  for(const page of ['about.html','privacy.html','privacy-choices.html','terms.html',
    'contact.html','copyright.html','content-licensing.html','editorial-policy.html','advertising-disclosure.html']){
    assert(home.includes('href="/'+page+'"'),'Site footer missing '+page);
  }
  assert(read('copyright.html').includes('github.com/dmlazid/NovelNest/issues/new'));
});
