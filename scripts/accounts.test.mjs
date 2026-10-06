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
function harness({ storage = new Map(), uid = null, cloud = new Map(), error = null } = {}) {
  const handlers = new Map(), timers = new Map(), nodes = new Map();
  let reloads = 0, stopped = 0, timerId = 0, callback, transactions = 0, failure = error, gate = null;
  const on = (name, fn) => handlers.set(name, [...handlers.get(name)||[], fn]);
  const fire = (name, event) => { for(const fn of handlers.get(name)||[]) fn(event); };
  const node = name => {
    if(!nodes.has(name)) nodes.set(name,{ textContent:'', innerHTML:'', setAttribute(){}, addEventListener:on, querySelector:node, appendChild(){}, insertAdjacentElement(_where,n){nodes.set('#'+n.id,n);}, close(){},showModal(){} });
    return nodes.get(name);
  };
  const document = { querySelector:node, createElement:()=>({innerHTML:'',className:'',setAttribute(){},querySelector:node}),body:node('body'),addEventListener:on };
  const window = {NOVELS:[{id:'book',title:'Book',chapters:[{},{},{}]},{id:'other',title:'Other',chapters:[{},{}]}],addEventListener:on,dispatchEvent:e=>fire(e.type,e),NOVELNEST_FIREBASE:{},NovelNestPositions:{capture(){},stop(){stopped++;},reload(){}},NovelNestApp:{reloadData(){}},NovelNestReading:{reload(){}}};
  const auth = {currentUser: uid ? {uid,displayName:uid} : null};
  const firebaseMock = {
    initializeApp(){return {};},getAuth(){return auth;},getFirestore(){return {};},browserLocalPersistence:{},setPersistence:async()=>{},
    onAuthStateChanged(_auth,fn){callback=fn;fn(auth.currentUser);},doc(_db,collection,id){assert.equal(collection,'users');return id;},
    async runTransaction(_db,fn){transactions++;if(failure)throw Object.assign(Error('failure'),{code:failure});if(gate)await gate;
      return fn({get:async id=>({exists:()=>cloud.has(id),data:()=>copy(cloud.get(id))}),set:(id,value)=>cloud.set(id,copy(value))});},
    signOut:async()=>{auth.currentUser=null;callback(null);},GoogleAuthProvider:class{setCustomParameters(){}},signInWithPopup:async()=>{}
  };
  const context = vm.createContext({window,document,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{getItem(){},setItem(){},removeItem(){}},location:{hash:'#/library',reload(){reloads++;}},navigator:{onLine:true},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),Event,firebaseMock,console});
  for(const name of ['backup.js','account-sync.js','accounts.js']) {
    let source=fs.readFileSync('dist/'+name,'utf8');
    // Replace the external SDK import boundary; all account and storage code is real.
    if(name==='accounts.js')source=source.replace(/import\('https:\/\/www\.gstatic\.com\/firebasejs\/[^']+'\)/g,'Promise.resolve(firebaseMock)');
    vm.runInContext(source,context);
  }
  return {window,storage,cloud,nodes,timers,context,get reloads(){return reloads;},get transactions(){return transactions;},get stopped(){return stopped;},
    async start(){const entry=[...timers].find(([,t])=>t.ms===0);timers.delete(entry[0]);entry[1].fn();await settle();},
    async account(next){auth.currentUser=next?{uid:next,displayName:next}:null;callback(auth.currentUser);await settle();},
    async click(selector){fire('click',{target:{closest:s=>s===selector}});await settle();},
    fail(code){failure=code;},hold(promise){gate=promise;},fire,
    state:()=>copy({data:window.NovelNestBackup.readCurrent(),seen:JSON.parse(storage.get('novelnest.update-seen'))}),
  };
}

test('sign-in keeps guest data separate; explicit import syncs it; sign-out restores guest library', async () => {
  const storage = new Map(); save(storage,fixture()); const h=harness({storage}); await h.start();
  await h.account('alice'); assert.equal(h.reloads,1); assert.deepEqual(h.state().data.saved,[]);
  assert.deepEqual(JSON.parse(storage.get('novelnest.account-cache.guest')).data.saved,['book']);
  const signed=harness({storage,uid:'alice'});await signed.start();await signed.click('[data-import-guest]');
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
  assert.match(h.nodes.get('[data-account-status]').textContent,/Synced/);
});

test('local bookmark removal during an in-flight cloud read is preserved', async () => {
  const storage=new Map();save(storage,fixture());storage.set('novelnest.account-owner','"alice"');
  const h=harness({storage,uid:'alice'});await h.start();
  let release;h.hold(new Promise(r=>release=r));
  const pending=h.window.NovelNestAccounts.synchronize(true);await settle();
  const value=h.state();value.data.saved=[];save(storage,value);h.window.NovelNestAccounts.changed();
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
