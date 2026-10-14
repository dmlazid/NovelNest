import test from 'node:test';
import assert from 'node:assert/strict';
import {draftKey,readDraft,saveDraft,clearDraft,draftChanged,pendingDraftNumbers} from '../dist/author-draft-recovery.mjs';

function device(){
  const data=new Map();
  return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
const writer='testWriterOne',other='otherWriterTwo',story='ABc123DEF456';

test('chapter recovery survives a reload but is scoped to a specific writer and novel',()=>{
  const storage=device(), text={title:'Chapter One',body:'A long chapter\nthat is still being written.'};
  assert(saveDraft(storage,writer,story,1,text,123456));
  assert.deepEqual(readDraft(storage,writer,story,1),{...text,at:123456});
  assert.equal(readDraft(storage,other,story,1),null);
  assert.equal(readDraft(storage,writer,story,2),null);
  assert.equal(readDraft(storage,writer,'DifferentStory001',1),null);
  assert.equal(draftKey(writer,'../../users',1),null);
  assert.equal(draftKey(writer,story,0),null);
});
test('save to Firestore can clear only that chapter recovery record',()=>{
  const storage=device();
  assert(saveDraft(storage,writer,story,1,{title:'A',body:'Draft'},50));
  assert(saveDraft(storage,writer,story,2,{title:'B',body:'Another'},51));
  assert(clearDraft(storage,writer,story,1));
  assert.equal(readDraft(storage,writer,story,1),null);
  assert(readDraft(storage,writer,story,2));
});
test('unsaved text is detected before editorial submission',()=>{
  const storage=device();
  const chapters=[{number:1,title:'Start',body:'Saved text'},{number:2,title:'Next',body:'Next text'}];
  saveDraft(storage,writer,story,1,{title:'Start',body:'Saved text'},20);
  assert.deepEqual(pendingDraftNumbers(storage,writer,story,chapters),[]);
  saveDraft(storage,writer,story,2,{title:'Next',body:'Revised next text'},21);
  saveDraft(storage,writer,story,3,{title:'New',body:'Unpublished chapter'},22);
  assert.deepEqual(pendingDraftNumbers(storage,writer,story,chapters),[2,3]);
  assert(draftChanged(readDraft(storage,writer,story,3),null));
});
test('broken or blocked local storage never publishes nor deletes anything',()=>{
  const storage=device(),key=draftKey(writer,story,1);
  storage.data.set(key,'{broken');
  assert.equal(readDraft(storage,writer,story,1),null);
  storage.data.set(key,JSON.stringify({version:1,title:'A',body:'x'.repeat(45001),at:1}));
  assert.equal(readDraft(storage,writer,story,1),null);
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
  assert.equal(readDraft(blocked,writer,story,1),null);
  assert.equal(saveDraft(blocked,writer,story,1,{title:'A',body:'X'}),false);
  assert.equal(clearDraft(blocked,writer,story,1),false);
});
