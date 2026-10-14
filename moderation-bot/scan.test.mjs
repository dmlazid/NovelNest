import test from 'node:test';
import assert from 'node:assert/strict';
import {screenStory} from './scan.mjs';
const novel={title:'The Moonlit Orchard',penName:'Writer One',genre:'Fantasy',
  summary:'A farm grows stranger with each passing winter.',
  copyrightConfirmed:true,guidelinesAccepted:true};
const chapter={number:1,title:'The First Frost',body:'A story of quiet courage. '.repeat(80)};
test('normal manuscript passes objective screening but copyright remains unverified',()=>{
  const r=screenStory(novel,[chapter]);
  assert.equal(r.level,'basic-checks-passed');assert.equal(r.copyrightVerified,false);
  assert.equal(r.wordCount,400);
});
test('short or incomplete manuscripts are returned for revision',()=>{
  assert.equal(screenStory(novel,[]).level,'action-required');
  assert.equal(screenStory(novel,[{...chapter,body:'few words'}]).level,'action-required');
  assert.equal(screenStory({...novel,copyrightConfirmed:false},[chapter]).level,'action-required');
});
test('possible spam and truncated scans go to human review',()=>{
  const r=screenStory(novel,[{...chapter,body:chapter.body+' https://a.test https://b.test https://c.test'}]);
  assert.equal(r.level,'needs-review');
  assert.equal(screenStory(novel,[chapter],{complete:false}).fullyScanned,false);
  assert.equal(screenStory(novel,[chapter],{complete:false}).level,'needs-review');
});
