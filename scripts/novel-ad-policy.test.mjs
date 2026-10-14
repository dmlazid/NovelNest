import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadReviewRegistry,validateReviewRegistry,novelMayHaveGoogleAds} from './novel-ad-policy.mjs';

const read=p=>fs.readFileSync('dist/'+p,'utf8');
const blank={schemaVersion:1,approved:{}};
const grant={textRights:true,translationRights:true,coverRights:true,
  commercialAdsRights:true,originalAddedValueReviewed:true,contentPolicyReviewed:true,
  reviewedOn:'2026-10-14',reviewer:'editor',privateEvidenceReference:'internal_ref_283'};

test('novel advertising fails closed when a sourcewide owner declaration exists but no work-specific grant',()=>{
  const reviews=loadReviewRegistry();
  assert.deepEqual(Object.keys(reviews.approved),[],
    'Do not presume commercial and cover rights for unreviewed imported titles');
  const published=JSON.parse(fs.readFileSync('scripts/auto_import_policy.json','utf8'));
  assert.equal(published.sources.akknovel.sourcewide_authorized,true);
  assert.equal(published.sources.freewebnovel.sourcewide_authorized,true);
  for(const id of ['shadow-slave','martial-god-asura','supreme-harem-god-system'])
    assert.equal(novelMayHaveGoogleAds(id,reviews),false);
});

test('each approval must positively verify text, translation, cover, commercial ads, originality, and content review',()=>{
  assert.equal(novelMayHaveGoogleAds('book',{...blank,approved:{book:grant}}),true);
  for(const key of ['textRights','translationRights','coverRights','commercialAdsRights',
    'originalAddedValueReviewed','contentPolicyReviewed']){
    assert.throws(()=>validateReviewRegistry({...blank,approved:{book:{...grant,[key]:false}}}),
      /Incomplete/);
  }
  assert.throws(()=>validateReviewRegistry({...blank,approved:{book:{...grant,privateEvidenceReference:'private contract with home address'}}}),
    /non-sensitive/);
  assert.throws(()=>validateReviewRegistry({...blank,approved:{book:{...grant,reviewedOn:''}}}),
    /review date/);
});

test('all novel detail pages and SPA chapter routes are ad-free while every title is awaiting review',()=>{
  const builder=fs.readFileSync('scripts/build-compatible-pages.mjs','utf8');
  assert.match(builder,/novelMayHaveGoogleAds\(novel\.id,advertisingReviews\)/);
  assert.match(builder,/chapterAdHold='\/novel\/:novel\/chapter-:number\/ \/restricted-reader\.html 200'/);
  assert.match(builder,/novelAdsHeld:/);
  assert.match(fs.readFileSync('cloudflare/reader/worker.mjs','utf8'),/publisherFree=body\.replace/);
  const script=read('app.js');
  assert(script.includes("publisherScript?.tagName==='SCRIPT'"),
    'Entering an unreviewed reader must unload any previously loaded homepage advertising code');
  assert(read('index.html').includes('pagead2.googlesyndication.com'),
    'Original homepage publisher verification must remain intact');
});
