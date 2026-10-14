import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GENRES,wordCount,validNovel,validChapter,canSubmit,safeDocId,escapeHTML} from '../dist/author-core.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sample={title:'The Moonlit Orchard',penName:'Writer One',summary:'A farm grows a little stranger with each passing winter.',
  genre:'Fantasy',copyrightConfirmed:true,guidelinesAccepted:true};
const chapter={number:1,title:'The First Frost',body:'A story of quiet courage. '.repeat(80)};

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
 for(const name of ['author-studio','author-admin','original-novels','original-story'])
   assert.match(read('dist/'+name+'.html'),/author-publishing\.js\?v=3/);
 const js=read('dist/author-publishing.js');
 assert.match(js,/onAuthStateChanged/);
 assert.match(js,/where\('ownerUid','==',state\.user\.uid\)/);
 assert.match(js,/where\('status','==','published'\)/);
 assert.match(js,/status:'submitted'/);
 assert.match(js,/status:'draft'/);
 assert.match(js,/status==='published'/);
 assert.match(js,/captureChapterRecovery/);
 assert.match(js,/data-action="restore-draft"/);
 assert.match(js,/pendingDraftNumbers/);
 assert.match(js,/data-hide-published/);
 assert.match(js,/status:'hidden'/);
 assert.match(js,/Report a copyright or content concern/);
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
 assert.match(rules,/isEditor\(\) && resource\.data\.status == 'published'/);
 assert.match(rules,/request\.resource\.data\.status == 'hidden'/);
 assert.match(rules,/request\.resource\.data\.ownerUid == request\.auth\.uid/);
 assert.match(rules,/allow list, create, update, delete: if false/);
 assert.doesNotMatch(rules,/allow (read|write): if true/);
});


test('empty moderation queues show a private, truthful worker heartbeat',()=>{
 const worker=read('moderation-bot/run.mjs');
 const dashboard=read('dist/moderation-dashboard.js');
 const html=read('dist/author-admin.html');
 const rules=read('firebase/firestore.rules');
 assert.match(worker,/doc\('__worker_status__'\)/);
 assert.match(worker,/recordType:'worker-status'/);
 assert.match(worker,/checkedAt:FieldValue\.serverTimestamp\(\)/);
 assert.match(worker,/if\(errors\)throw new Error/);
 assert.match(dashboard,/heartbeat=data/);
 assert.match(dashboard,/No saved original manuscripts have been screened yet/);
 assert.match(html,/moderation-dashboard\.js\?v=2/);
 assert.match(rules,/match \/moderationReviews\/\{storyId\}/);
 assert.doesNotMatch(dashboard,/Activate the scheduled worker using/);
});
