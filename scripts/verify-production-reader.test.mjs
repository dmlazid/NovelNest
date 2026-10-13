import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLiveResponses} from './verify-production-reader.mjs';
const publisher='google.com, pub-9356195452195758, DIRECT, f08c47fec0942fa0';
const good={
  '/build-info.json':{status:200,body:'{"chapters":123}'},
  '/sitemaps/catalog.xml':{status:200,body:'<urlset><url>novelhaven.top</url></urlset>'},
  '/novel/shadow-slave/chapter-1/':{status:200,body:'<div data-static-chapter="shadow-slave"><p>Real chapter text</p></div>'},
  '/novel/supreme-harem-god-system/':{status:200,body:'<meta name="robots" content="noindex,follow">',headers:{}},
  '/ads.txt':{status:200,body:publisher}, expectedAds:publisher
};
test('real JSON metadata and HTML chapter required before declaring the reader deployed',()=>{
  assert.equal(classifyLiveResponses(good).production_ready,true);
  const fallback={...good,'/build-info.json':{status:200,body:'<html>app fallback</html>'}};
  assert.equal(classifyLiveResponses(fallback).production_ready,false);
  const noChapter={...good,'/novel/shadow-slave/chapter-1/':{status:200,body:'<html>app fallback</html>'}};
  assert.equal(classifyLiveResponses(noChapter).production_ready,false);
});
test('restricted novels must not load publisher ads while public ads.txt stays unchanged',()=>{
  const leaked={...good,'/novel/supreme-harem-god-system/':{status:200,body:'<meta name="robots" content="noindex"><script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>',headers:{}}};
  assert.equal(classifyLiveResponses(leaked).production_ready,false);
  const changed={...good,'/ads.txt':{status:200,body:'changed'}};
  assert.equal(classifyLiveResponses(changed).ads_txt_preserved,false);
});
