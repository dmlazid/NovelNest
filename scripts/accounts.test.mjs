import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const copy = v => JSON.parse(JSON.stringify(v));
const empty = () => ({data:{saved:[],progress:{},positions:{},chapterStatus:{}},seen:{}});
const fixture = () => ({data:{saved:['book'],progress:{book:{chapter:1,at:100}},positions:{},chapterStatus:{book:{started:[1,2],finished:[1]}}},seen:{book:3}});
const keys = {saved:'novelnest.saved',progress:'novelnest.progress',positions:'novelnest.positions',chapterStatus:'novelnest.chapter-status'};
function save(storage, value) { for (const [key, name] of Object.entries(keys)) storage.set(name, JSON.stringify(value.data[key])); storage.set('novelnest.update-seen', JSON.stringify(value.seen)); }
const settle = async () => { for(let i=0;i<20;i++) await Promise.resolve(); };
function harness({ storage = new Map(), uid = null, adminUids = [], cloud = new Map(), error = null, catalog = [{id:'book',title:'Book',chapters:[{},{},{}]},{id:'other',title:'Other',chapters:[{},{}]}] } = {}) {
  const handlers = new Map(), timers = new Map(), nodes = new Map(), downloads=[],downloadBlobs=[];
  let reloads = 0, stopped = 0, timerId = 0, callback, transactions = 0, failure = error, gate = null;
  const uiUpdates={full:0,card:0,shelf:0,lastRefresh:null};
  const on = (name, fn) => handlers.set(name, [...handlers.get(name)||[], fn]);
  const fire = (name, event) => { for(const fn of handlers.get(name)||[]) fn(event); };
  const node = name => {
    if(!nodes.has(name)) nodes.set(name,{ textContent:'', innerHTML:'', dataset:{}, setAttribute(){}, addEventListener:on, querySelector:node, appendChild(){}, insertAdjacentElement(_where,n){nodes.set('#'+n.id,n);}, close(){},showModal(){} });
    return nodes.get(name);
  };
  const document = { querySelectorAll:selector=>selector==='[data-account-status]'?[node(selector)]:[], querySelector:node,
    createElement:()=>({innerHTML:'',className:'',setAttribute(){},querySelector:node,
      click(){downloads.push({download:this.download,href:this.href});},remove(){}}),
    body:node('body'),addEventListener:on };
  const window = {NOVELS:catalog,addEventListener:on,dispatchEvent:e=>fire(e.type,e),NOVELNEST_FIREBASE:{},NovelNestPositions:{capture(){},stop(){stopped++;},reload(){}},NovelNestApp:{reloadData(){},refresh(options){uiUpdates.full++;uiUpdates.lastRefresh=options;},refreshLibraryProgress(){uiUpdates.card++;},refreshLibraryBookmarks(){uiUpdates.shelf++;}},NovelNestReading:{reload(){}}};
  const auth = {currentUser: uid ? {uid,displayName:uid} : null};
  const firebaseMock = {
    initializeApp(){return {};},getAuth(){return auth;},getFirestore(){return {};},browserLocalPersistence:{},setPersistence:async()=>{},
    onAuthStateChanged(_auth,fn){callback=fn;fn(auth.currentUser);},
    doc(_db,collection,id){assert(['users','authorAdmins'].includes(collection));return collection==='users'?id:'admin:'+id;},
    async getDoc(ref){const okay=ref.startsWith('admin:')&&adminUids.includes(ref.slice(6));return {exists:()=>okay,data:()=>okay?{role:'editor'}:null};},
    async runTransaction(_db,fn){transactions++;if(failure)throw Object.assign(Error('failure'),{code:failure});if(gate)await gate;
      return fn({get:async id=>({exists:()=>cloud.has(id),data:()=>copy(cloud.get(id))}),set:(id,value)=>cloud.set(id,copy(value))});},
    signOut:async()=>{auth.currentUser=null;callback(null);},GoogleAuthProvider:class{setCustomParameters(){}},signInWithPopup:async()=>{}
  };
  const context = vm.createContext({window,document,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{getItem(){},setItem(){},removeItem(){}},location:{hash:'#/library',reload(){reloads++;}},navigator:{onLine:true},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    URL:{createObjectURL(blob){downloadBlobs.push(blob);return 'blob:novelhaven-'+downloadBlobs.length;},revokeObjectURL(){}},
    Blob,Event,firebaseMock,console});
  for(const name of ['backup.js','account-sync.js','accounts.js']) {
    let source=fs.readFileSync('dist/'+name,'utf8');
    // Replace the external SDK import boundary; all account and storage code is real.
    if(name==='accounts.js')source=source.replace(/import\('https:\/\/www\.gstatic\.com\/firebasejs\/[^']+'\)/g,'Promise.resolve(firebaseMock)');
    vm.runInContext(source,context);
  }
  return {window,storage,cloud,nodes,timers,context,uiUpdates,downloads,downloadBlobs,get reloads(){return reloads;},get transactions(){return transactions;},get stopped(){return stopped;},
    async start(){const entry=[...timers].find(([,t])=>t.ms===0);timers.delete(entry[0]);entry[1].fn();await settle();},
    async account(next){auth.currentUser=next?{uid:next,displayName:next}:null;callback(auth.currentUser);await settle();},
    async click(selector){fire('click',{target:{closest:s=>s===selector}});await settle();},
    fail(code){failure=code;},hold(promise){gate=promise;},fire,
    state:()=>copy({data:window.NovelNestBackup.readCurrent(),seen:JSON.parse(storage.get('novelnest.update-seen'))}),
  };
}

test('first sign-in keeps existing guest bookmarks and progress; sign-out restores guest library', async () => {
  const storage = new Map(); save(storage,fixture()); const h=harness({storage}); await h.start();
  await h.account('alice'); assert.equal(h.reloads,1); assert.deepEqual(h.state().data.saved,['book']);
  assert.deepEqual(JSON.parse(storage.get('novelnest.account-cache.guest')).data.saved,['book']);
  const signed=harness({storage,uid:'alice'});await signed.start();
  assert.deepEqual(signed.cloud.get('alice').data.saved,['book']);
  await signed.click('[data-signout]'); assert.equal(signed.reloads,1);assert.deepEqual(signed.state(),fixture());
});

test('switching Google accounts cannot upload the previous account library', async () => {
  const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'bob'});await h.start();
  assert.equal(h.transactions,0);assert.equal(h.reloads,1);assert.deepEqual(h.state().data.saved,[]);
  assert.deepEqual(JSON.parse(storage.get('novelnest.account-cache.alice')).data.saved,['book']);
});

test('offline edits remain locally and sync after a failed request is retried', async () => {
  const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice',error:'unavailable'});await h.start();
  assert.deepEqual(h.state().data.saved,['book']);assert.equal(h.cloud.size,0);
  assert.match(h.nodes.get('[data-account-status]').textContent,/stays on this device/);
  h.fail(null);await h.window.NovelNestAccounts.synchronize(true);
  assert.deepEqual(h.cloud.get('alice').data.saved,['book']);
  assert.match(h.nodes.get('[data-account-status]').textContent,/All changes synced/);
});

test('local bookmark removal during an in-flight cloud read is preserved', async () => {
  const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice'});await h.start();
  let release;h.hold(new Promise(r=>release=r));
  const pending=h.window.NovelNestAccounts.synchronize(true);await settle();
  const value=h.state();value.data.saved=[];save(storage,value);h.window.NovelNestAccounts.bookmarkAction('book',false);h.window.NovelNestAccounts.changed();
  release();await pending;
  assert.deepEqual(h.state().data.saved,[]);
  h.hold(null);await h.window.NovelNestAccounts.synchronize(true);
  assert.deepEqual(h.cloud.get('alice').data.saved,[]);
});

test('remote removals update the live local library without being resurrected', async () => {
  const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
  storage.set('novelnest.account-base.alice',JSON.stringify(fixture()));
  const cloud=new Map([['alice',{version:1,...empty()}]]);
  const h=harness({storage,uid:'alice',cloud});await h.start();
  assert.deepEqual(h.state().data.saved,[]);
  assert.deepEqual(cloud.get('alice').data.saved,[]);
});

test('permission errors preserve local data and identify cloud access failure', async () => {
  const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice',error:'permission-denied'});await h.start();
  assert.deepEqual(h.state(),fixture());assert.match(h.nodes.get('[data-account-status]').textContent,/access was denied/);
});

test('another tab switching accounts stops this reader before reloading', async () => {
  const h=harness();await h.start();h.fire('storage',{key:'novelnest.account-owner'});
  assert.equal(h.stopped,1);assert.equal(h.reloads,1);
});

test('background position autosaves never repaint or flicker the Library page',async()=>{
  const h=harness();await h.start();
  const before=h.uiUpdates.full;
  h.fire('storage',{key:'novelnest.positions'});
  h.fire('storage',{key:'novelnest.update-seen'});
  h.fire('storage',{key:'novelnest.preferences'});
  assert.equal(h.uiUpdates.full,before,'No full route transition during autosave');
  assert.equal(h.uiUpdates.card,0,'Unrelated autosaves cannot redraw Continue Reading');
  h.fire('storage',{key:'novelnest.progress'});
  assert.equal(h.uiUpdates.full,before);
  assert.equal(h.uiUpdates.card,1,'Progress edits refresh only the in-place card');
  h.fire('storage',{key:'novelnest.saved'});
  assert.equal(h.uiUpdates.full,before,'Bookmark changes must not remount the Library');
  assert.equal(h.uiUpdates.shelf,1,'Refresh only the saved bookshelf');
});
test('cloud session uses the actual last opened chapter when its timestamp is newer',async()=>{
  const storage=new Map();
  const data=fixture();data.data.progress.book={chapter:2,at:100};
  save(storage,data);storage.set('novelnest.account-owner','"alice"');
  const remote=empty();remote.data.progress.book={chapter:1,at:200};
  const cloud=new Map([['alice',{version:1,...remote}]]);
  const h=harness({storage,uid:'alice',cloud});await h.start();
  assert.equal(h.state().data.progress.book.chapter,1);
  assert.equal(h.uiUpdates.full,0,'Progress synchronization does not flash the entire library');
});

test('missing catalog during sign-in never removes saved bookmarks on device or cloud', async () => {
  const storage=new Map(), record=fixture();
  save(storage,record);
  storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice',catalog:[]});
  await h.start();
  assert.deepEqual(h.state().data.saved,['book'],'Existing bookmark survives missing script during initialization');
  assert.deepEqual(h.state().data.progress.book,{chapter:1,at:100});
  await h.window.NovelNestAccounts.synchronize(true);
  assert.deepEqual(h.cloud.get('alice').data.saved,['book'],'Cloud sync may not interpret an unloaded title as deleted');
  // Simulate the returning catalog on the next visit with the same storage.
  const returning=harness({storage,uid:'alice',cloud:h.cloud});
  await returning.start();
  assert.deepEqual(returning.state().data.saved,['book']);
});
test('a real bookmark removal still synchronizes between devices', async () => {
  const storage=new Map(), existing=fixture();
  save(storage,existing);
  storage.set('novelnest.account-owner','"alice"');
  const cloud=new Map([['alice',{version:1,...fixture()}]]);
  const h=harness({storage,uid:'alice',cloud});
  await h.start();
  const state=h.state();
  state.data.saved=[];
  save(storage,state);
  h.window.NovelNestAccounts.bookmarkAction('book',false);
  h.window.NovelNestAccounts.changed();
  await h.window.NovelNestAccounts.synchronize(true);
  assert.deepEqual(h.state().data.saved,[]);
  assert.deepEqual(cloud.get('alice').data.saved,[]);
});

test('a stale local sync baseline cannot remove cloud bookmarks when the account cache is missing',async()=>{
  const storage=new Map();
  storage.set('novelnest.account-base.alice',JSON.stringify(fixture()));
  const cloud=new Map([['alice',{version:1,...fixture()}]]);
  const h=harness({storage,uid:'alice',cloud});await h.start();
  assert.equal(h.reloads,1);
  assert.deepEqual(h.state().data.saved,[]);
  const next=harness({storage,uid:'alice',cloud});await next.start();
  assert.deepEqual(next.state().data.saved,['book']);
  assert.deepEqual(cloud.get('alice').data.saved,['book']);
});

test('transient null authentication does not delete a signed-in library or reload the tab',async()=>{
  const storage=new Map();save(storage,fixture());
  storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice',error:'unavailable'});await h.start();
  await h.account(null);
  assert.equal(h.reloads,0);
  assert.deepEqual(h.state().data.saved,['book']);
  assert.match(h.nodes.get('[data-account-status]').textContent,/remain saved/);
});
test('opening a new tab does not overwrite any saved bookmark, progress or Finished key',async()=>{
  const storage=new Map();save(storage,fixture());
  const before=new Map([...storage].filter(([k])=>Object.values(keys).includes(k)));
  const h=harness({storage});
  await h.start();
  for(const [k,value] of before)assert.equal(storage.get(k),value);
});

test('an unexplained blank local shelf cannot erase a synced cloud library',async()=>{
 const storage=new Map(), data=fixture();save(storage,data);
 storage.set('novelnest.account-owner','"alice"');
 storage.set('novelnest.account-base.alice',JSON.stringify(data));
 const cloud=new Map([['alice',{version:1,...fixture()}]]);
 const h=harness({storage,uid:'alice',cloud});await h.start();
 const blank=h.state();blank.data.saved=[];save(storage,blank);
 h.window.NovelNestAccounts.changed();await h.window.NovelNestAccounts.synchronize(true);
 assert.deepEqual(h.state().data.saved,['book']);
 assert.deepEqual(cloud.get('alice').data.saved,['book']);
});
test('explicit Finished undo survives sync, but a stale tab cannot clear unrelated Finished chapters',async()=>{
 const storage=new Map(),data=fixture();
 data.data.chapterStatus.book={started:[1,2],finished:[1,2]};
 save(storage,data);storage.set('novelnest.account-owner','"alice"');
 storage.set('novelnest.account-base.alice',JSON.stringify(data));
 const cloud=new Map([['alice',{version:1,...copy(data)}]]);
 const h=harness({storage,uid:'alice',cloud});await h.start();
 const stale=h.state();stale.data.chapterStatus.book={started:[1],finished:[]};
 save(storage,stale);
 h.window.NovelNestAccounts.changed();
 await h.window.NovelNestAccounts.synchronize(true);
 assert.deepEqual(h.state().data.chapterStatus.book.finished,[1,2]);
 const edited=h.state();edited.data.chapterStatus.book={started:[1,2],finished:[2]};
 save(storage,edited);h.window.NovelNestAccounts.chapterFinishAction('book',1,false);
 h.window.NovelNestAccounts.changed();await h.window.NovelNestAccounts.synchronize(true);
 assert.deepEqual(cloud.get('alice').data.chapterStatus.book.finished,[2]);
});

test('removing a bookmark before Firebase restores sign-in records the user action',async()=>{
 const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
 const h=harness({storage,uid:'alice'}); // auth SDK has not started yet
 h.window.NovelNestAccounts.bookmarkAction('book',false);
 assert.deepEqual(JSON.parse(storage.get('novelnest.pending-saved-removals.alice')),['book']);
 await h.start();
});

test('Ctrl-click and middle-click novel links preserve the browser new-tab action',async()=>{
 const h=harness();await h.start();
 let navigations=0,prevented=0;
 h.window.NovelNestApp.navigate=()=>navigations++;
 const anchor={target:'',getAttribute:()=>'/novel/book/chapter-1/'};
 const target={closest:selector=>selector==='a[href^="/novel/"]'?anchor:null};
 for(const overrides of [{button:0,ctrlKey:true},{button:1,ctrlKey:false},{button:0,metaKey:true}]){
   h.fire('click',{target,button:overrides.button,ctrlKey:overrides.ctrlKey,
     metaKey:overrides.metaKey,shiftKey:false,altKey:false,preventDefault(){prevented++;}});
 }
 assert.equal(navigations,0);
 assert.equal(prevented,0);
});

test('Firebase sign-in and background sync never create a new Library account panel',async()=>{
  const storage=new Map();save(storage,fixture());
  storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice',cloud:new Map([['alice',{version:1,...fixture()}]])});
  await h.start();
  assert.equal(h.nodes.has('#account-panel'),false,
    'Library account panel must be pre-rendered by app.js, not inserted by Firebase');
  await h.window.NovelNestAccounts.synchronize(true);
  assert.equal(h.nodes.has('#account-panel'),false,
    'Background account synchronization must not re-create its Library panel');
  assert.match(h.nodes.get('[data-account-status]').textContent,/synced/i);
});

test('verified Firebase editor sees Admin Dashboard before all reading links',async()=>{
 const h=harness({uid:'owner',adminUids:['owner']});await h.start();
 assert.equal(h.nodes.get('[data-admin-shortcut]').hidden,false);
 await h.click('[data-profile]');
 const profile=h.nodes.get('#account-drawer').innerHTML;
 assert.match(profile,/VERIFIED NOVELHAVEN ADMIN/);
 assert.match(profile,/owner-account-card/);
 assert(profile.indexOf('owner-account-card')<profile.indexOf('<div class="drawer-rows">'));
 assert.match(profile,/writer-account-card/);
 await h.click('[data-menu]');
 const menu=h.nodes.get('#navigation-drawer').innerHTML;
 assert.match(menu,/owner-menu-card/);
 assert(menu.indexOf('Admin Dashboard')<menu.indexOf('catalog-menu-tabs'));
 assert.match(menu,/writer-menu-card/);
 assert.match(menu,/Start Writing/);
 assert.doesNotMatch(menu,/menuLink\('\/author-studio\.html','Write & Publish'/);
});
test('regular readers and guests see inviting author card but not administrator tools',async()=>{
 for(const config of [{uid:null},{uid:'reader',adminUids:['owner']}]){
   const h=harness(config);await h.start();
   assert.equal(h.nodes.get('[data-admin-shortcut]').hidden,true);
   await h.click('[data-profile]');
   assert.doesNotMatch(h.nodes.get('#account-drawer').innerHTML,/VERIFIED NOVELHAVEN ADMIN|owner-account-card/);
   assert.match(h.nodes.get('#account-drawer').innerHTML,/writer-account-card/);
   await h.click('[data-menu]');
   assert.doesNotMatch(h.nodes.get('#navigation-drawer').innerHTML,/owner-menu-card/);
   assert.match(h.nodes.get('#navigation-drawer').innerHTML,/Start Writing/);
 }
});
test('admin role is cleared when switching to an account without permission',async()=>{
 const h=harness({uid:'owner',adminUids:['owner']});await h.start();
 assert.equal(h.nodes.get('[data-admin-shortcut]').hidden,false);
 await h.account('reader');
 assert.equal(h.nodes.get('[data-admin-shortcut]').hidden,true);
});

test('founder profile has verified crown, real reading statistics and working owner-only tools',async()=>{
 const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"owner"');
 const h=harness({uid:'owner',adminUids:['owner'],storage});await h.start();
 await h.click('[data-profile]');
 const html=h.nodes.get('#account-drawer').innerHTML;
 assert.match(html,/founder-profile-summary/);
 assert.match(html,/FOUNDER · VERIFIED ADMIN/);
 assert.match(html,/Founder Command Center/);
 assert.match(html,/FOUNDER PRIVILEGES/);
 assert.match(html,/data-founder-backup/);
 assert.match(html,/data-sync-now/);
 assert.match(html,/My manuscripts/);
 assert.match(html,/Moderation/);
 assert.match(html,/Chapters finished/);
 assert.match(html,/owner-stats/);
 // Export is a real action, not a dummy premium button.
 await h.click('[data-founder-backup]');
 assert.equal(h.downloads.length,1,'Founder should receive a downloaded JSON file');
 assert.match(h.downloads[0].download,/novelhaven-reading-backup-\d{4}-\d{2}-\d{2}\.json/);
 const raw=await h.downloadBlobs[0].text(),payload=JSON.parse(raw);
 assert.equal(payload.format,'novelnest-backup');
 assert.equal(payload.version,1);
 assert.deepEqual(payload.data.saved,['book']);
 assert.deepEqual(payload.data.chapterStatus.book.finished,[1]);
});
test('non-editors cannot trigger founder backup, even by artificially invoking its event',async()=>{
 for(const config of [{uid:null},{uid:'ordinary',adminUids:['owner']}]){
  const h=harness(config);await h.start();
  await h.click('[data-founder-backup]');
  assert.equal(h.downloads.length,0);
 }
});
test('admin menu defaults compact; Novel list and Genres expand independently on tap',async()=>{
 const h=harness({uid:'owner',adminUids:['owner']});await h.start();
 await h.click('[data-menu]');
 const markup=h.nodes.get('#navigation-drawer').innerHTML;
 assert.match(markup,/<details class="owner-menu-dropdown owner-menu-card"/);
 assert.doesNotMatch(markup,/<details class="owner-menu-dropdown owner-menu-card"[^>]* open/);
 assert.match(markup,/data-catalog-tab="novels"/);
 assert.match(markup,/data-catalog-tab="genres"/);
 assert.match(markup,/id="catalog-novels-panel"[^>]+hidden/);
 assert.match(markup,/id="catalog-genres-panel"[^>]+hidden/);
 const panels={novels:{dataset:{catalogPanel:'novels'},hidden:true},genres:{dataset:{catalogPanel:'genres'},hidden:true}};
 const tabs={};
 const drawer={querySelectorAll(sel){return sel==='[data-catalog-tab]'?Object.values(tabs):Object.values(panels);}};
 for(const key of ['novels','genres']){
   const attrs={'aria-expanded':'false'};
   tabs[key]={dataset:{catalogTab:key},closest:s=>s==='.site-drawer'?drawer:null,
     getAttribute:k=>attrs[k],setAttribute:(k,v)=>{attrs[k]=v;}};
 }
 const tap=name=>h.fire('click',{button:0,target:{closest:s=>s==='[data-catalog-tab]'?tabs[name]:null}});
 tap('novels');assert.equal(panels.novels.hidden,false);assert.equal(panels.genres.hidden,true);
 tap('novels');assert.equal(panels.novels.hidden,true,'Tap again should collapse panel');
 tap('genres');assert.equal(panels.genres.hidden,false);assert.equal(panels.novels.hidden,true);
 tap('novels');assert.equal(panels.novels.hidden,false);assert.equal(panels.genres.hidden,true);
});
