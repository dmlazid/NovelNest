import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLiveSourceNovels} from './live-home-check.mjs';

function rendered(releases,latest){
  return '<html><body><section class="home-feed-section home-release-section">'+
    releases.map(id=>'<a class="home-release-row" href="/novel/'+id+'/chapter-2/">New</a>').join('')+
    '</section><section><h2>Latest Novels</h2><div class="home-cover-grid">'+
    latest.map(id=>'<a class="home-novel-tile" href="/novel/'+id+'/">Book</a>').join('')+
    '</div></section></body></html>';
}
test('matches top six real source releases from browser-rendered homepage',()=>{
  const ids=['new-1','new-2','new-3','new-4','new-5','new-6','new-7'];
  const result=extractLiveSourceNovels(rendered(ids,ids.slice(0,6)));
  assert.deepEqual(result.latest,ids.slice(0,6));
  assert.equal(result.released.length,7);
});
test('rejects imported books, wrong order and missing client-rendered sections',()=>{
  assert.throws(()=>extractLiveSourceNovels(rendered(['a','b'],['old-import','a'])),
    /most recent source releases/);
  assert.throws(()=>extractLiveSourceNovels(rendered(['a','b'],['b','a'])),
    /most recent source releases/);
  assert.throws(()=>extractLiveSourceNovels('<html><main id="main"></main></html>'),
    /missing from rendered homepage/);
});
test('fewer than six source releases displays only available genuine updates',()=>{
  assert.deepEqual(extractLiveSourceNovels(rendered(['a'],['a'])).latest,['a']);
});
