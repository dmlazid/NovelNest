import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GENRES,wordCount,validNovel,validChapter,canSubmit,safeDocId,escapeHTML} from '../dist/author-core.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sample={title:'The Moonlit Orchard',penName:'Writer One',summary:'A farm grows a little stranger with each passing winter.',
  genre:'Fantasy',copyrightConfirmed:true,guidelinesAccepted:true};
const chapter={number:1,title:'The First Frost',body:'A story of quiet courage. '.repeat(30)};

test('author forms enforce complete original novel metadata and chapter drafts',()=>{
 assert(validNovel(sample));
 assert(validChapter(chapter));
 assert(canSubmit(sample,[chapter]));
 assert(!canSubmit({...sample,copyrightConfirmed:false},[chapter]));
 assert(!canSubmit(sample,[{...chapter,body:'short'}]));
 assert(!canSubmit(sample,[]));
 assert(GENRES.includes('Romance'));
 assert(wordCount('one  two\nthree')===3);
 assert(safeDocId('Af6AnB83b9'));
 assert(!safeDocId('../users/owner'));
 assert.equal(escapeHTML('<img onerror="oops" src=x>'),'&lt;img onerror=&quot;oops&quot; src=x&gt;');
});

test('all Author Studio routes are ad-free, secure and noindex until reviewed',()=>{
 for(const name of ['author-studio','author-admin','original-novels','original-story','author-guidelines']){
  const html=read('dist/'+name+'.html');
  assert.match(html,/name="robots" content="noindex,follow"/);
  assert.doesNotMatch(html,/adsbygoogle|pagead2\.googlesyndication/);
 }
 const js=read('dist/author-publishing.js');
 assert.match(js,/onAuthStateChanged/);
 assert.match(js,/where\('ownerUid','==',state\.user\.uid\)/);
 assert.match(js,/where\('status','==','published'\)/);
 assert.match(js,/status:'submitted'/);
 assert.match(js,/status:'draft'/);
 assert.match(js,/status==='published'/);
 assert.match(js,/reader-body'\)\.textContent=chapter\.body/);
 assert.doesNotMatch(js,/innerHTML\s*=\s*chapter\.body|eval\(/);
});
test('Firestore rules protect authors, moderation and existing bookmarks',()=>{
 const rules=read('firebase/firestore.rules');
 assert.match(rules,/match \/users\/\{userId\}/);
 assert.match(rules,/match \/authorStories\/\{storyId\}/);
 assert.match(rules,/match \/authorAdmins\/\{adminUid\}/);
 assert.match(rules,/match \/chapters\/\{chapterId\}/);
 assert.match(rules,/resource\.data\.status == 'published'/);
 assert.match(rules,/request\.resource\.data\.status == 'draft'/);
 assert.match(rules,/resource\.data\.status == 'submitted'/);
 assert.match(rules,/request\.resource\.data\.ownerUid == request\.auth\.uid/);
 assert.match(rules,/allow list, create, update, delete: if false/);
 assert.doesNotMatch(rules,/allow (read|write): if true/);
});
