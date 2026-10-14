import {initializeApp,getApp,getApps} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,getDocs,addDoc,setDoc,updateDoc,query,where,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {GENRES,cleanText,wordCount,validNovel,validChapter,canSubmit,safeDocId,escapeHTML as esc} from '/author-core.mjs';
import {readDraft,saveDraft,clearDraft,draftChanged,pendingDraftNumbers} from '/author-draft-recovery.mjs';

if(!window.NOVELNEST_FIREBASE?.projectId)throw new Error('Firebase settings are not available for original-novel publishing.');
const app=getApps().length?getApp():initializeApp(window.NOVELNEST_FIREBASE);
const db=getFirestore(app),auth=getAuth(app),view=document.body.dataset.authorPage;
const host=document.getElementById('author-content'),banner=document.getElementById('author-message'),authBox=document.getElementById('author-auth');
const state={user:null,isAdmin:false,story:null,chapters:[],editing:0};
let backupTimer=0, authGeneration=0;
const chapterForm=()=>host.querySelector('[data-form="chapter"]');
// Local drafts protect writing during browser restarts and failed requests.
// They never publish or overwrite the author's Firestore chapter automatically.
function captureChapterRecovery(){
  clearTimeout(backupTimer);backupTimer=0;
  const form=chapterForm();
  if(!form||state.story?.status!=='draft'||!state.user)return true;
  const data=new FormData(form),number=Number(data.get('number'));
  const fields={title:String(data.get('title')||''),body:String(data.get('body')||'')};
  const saved=state.chapters.find(c=>c.number===number);
  if(!draftChanged(fields,saved)){
    clearDraft(localStorage,state.user.uid,state.story.id,number);
    return true;
  }
  const okay=saveDraft(localStorage,state.user.uid,state.story.id,number,fields);
  const label=form.querySelector('[data-author-backup-status]');
  if(label)label.textContent=okay?
    'Recovery copy saved on this device. Press Save Chapter to save it to your account.':
    'Your browser cannot store a recovery copy. Press Save Chapter before leaving.';
  return okay;
}
function changeChapterSafely(){
  if(!chapterForm()||captureChapterRecovery())return true;
  notice('Unsaved text cannot be protected on this device. Please save the chapter first.',true);
  return false;
}
const forbidden=error=>/permission-denied|missing or insufficient permissions/i.test(String(error?.code||'')+' '+String(error?.message||''));
function notice(text='',bad=false){banner.textContent=text;banner.dataset.error=String(bad);}
function fail(error){
  console.warn('NovelHaven author action unavailable:',error?.code||error?.name||'error');
  notice(forbidden(error)?'Author publishing is not activated yet. The owner must deploy the reviewed Firestore rules and configure an administrator. Existing novels and bookmarks are unaffected.':
    'Could not complete this request. Check your connection and try again. No publishing was performed.',true);
}
const wait=text=>{host.innerHTML='<section class="panel"><p class="muted">'+esc(text)+'</p></section>';};
const statusBadge=status=>'<span class="chip">'+esc(status||'draft')+'</span>';
const byNumber=(a,b)=>a.number-b.number;
const chapterWords=chs=>chs.reduce((count,c)=>count+wordCount(c.body),0);
const opts=(selected)=>GENRES.map(g=>'<option value="'+esc(g)+'"'+(g===selected?' selected':'')+'>'+esc(g)+'</option>').join('');
const timestamp=story=>story.updatedAt?.toMillis?.()||0;
async function chaptersFor(id){
  const items=await getDocs(collection(db,'authorStories',id,'chapters'));
  return items.docs.map(snapshot=>({id:snapshot.id,...snapshot.data()})).sort(byNumber);
}
function authUI(){
  authBox.innerHTML=state.user?
    '<a href="/?account=1" class="author-account-link">'+esc(state.user.displayName||'My account')+'</a>'+(state.isAdmin?'<a class="button secondary" href="/author-admin.html">♢ Dashboard</a>':'')+'<button class="button secondary" data-action="logout">Sign out</button>':
    '<button class="button outline" data-action="login">Sign in with Google</button>';
}
function signInPrompt(){
  host.innerHTML='<section class="panel"><h2>Your stories, your account</h2><p>Sign in with Google to create original novels, save drafts securely and submit chapters for approval. Your novels remain private until reviewed.</p><button class="button" data-action="login">Continue with Google</button></section>';
}
function listingCard(story){
  return '<article class="story-card"><div><h3>'+esc(story.title)+'</h3><p>by '+esc(story.penName||'Author')+' · '+esc(story.genre||'Other')+'</p>'+statusBadge(story.status)+
    (story.moderationNote?'<p class="muted">Editor note: '+esc(story.moderationNote)+'</p>':'')+
    '</div><button class="button outline" data-open="'+esc(story.id)+'">Open Studio</button></article>';
}
async function studioHome(){
  if(!state.user){signInPrompt();return;}
  const currentUid=state.user.uid;
  const composeMode=new URLSearchParams(location.search).get('compose')==='1';
  state.story=null;state.chapters=[];state.editing=0;
  // Paint the composer before the Firestore story query, to avoid an empty mobile screen.
  const composer=      '<section class="panel" id="new-story"><h2>Start a new novel</h2><form class="form-grid" data-form="create-novel">'+
      '<div class="two-col"><label>Novel title<input name="title" maxlength="120" minlength="3" required placeholder="Your original title"></label>'+
      '<label>Author pen name<input name="penName" maxlength="60" minlength="2" required value="'+esc(state.user.displayName||'')+'"></label></div>'+
      '<label>Genre<select name="genre">'+opts('Fantasy')+'</select></label>'+
      '<label>Synopsis (at least 30 characters)<textarea name="summary" minlength="30" maxlength="2000" required placeholder="What makes your story special?"></textarea></label>'+
      '<label class="field-check"><input type="checkbox" name="copyright" required><span>I own this story and its characters, or I have written permission to publish it. I grant NovelHaven a non-exclusive license to display it. I may request takedown.</span></label>'+
      '<label class="field-check"><input type="checkbox" name="guidelines" required><span>I agree to the <a href="/terms.html" target="_blank" rel="noopener">site rules</a>, content review, and no plagiarism, pirated chapters, explicit sexual content, or hateful material.</span></label>'+
      '<button class="button" type="submit">Create private draft</button></form></section>';
  const listing='<section class="panel" id="studio-story-list" aria-live="polite"><h2>My novels</h2><p class="muted">Loading saved manuscripts…</p></section>';
  host.innerHTML=composeMode?composer+listing:listing+composer;
  if(composeMode){
    requestAnimationFrame(()=>{
      if(state.user?.uid!==currentUid)return;
      host.querySelector('#new-story')?.scrollIntoView({behavior:'instant',block:'start'});
    });
  }
  try{
    const snap=await getDocs(query(collection(db,'authorStories'),where('ownerUid','==',state.user.uid)));
    // A delayed Firebase response must not redraw the page after sign-out or navigation.
    const target=host.querySelector('#studio-story-list');
    if(state.user?.uid!==currentUid||!target)return;
    const list=snap.docs.map(s=>({id:s.id,...s.data()})).sort((a,b)=>timestamp(b)-timestamp(a));
    target.innerHTML='<div class="toolbar"><h2 style="margin:0;flex:1">My novels</h2>'+
      '<span data-studio-admin-slot>'+(state.isAdmin?'<a class="button secondary" href="/author-admin.html">Review submissions</a>':'')+'</span>'+
      '<a class="button outline" href="/original-novels.html">Browse originals</a></div>'+
      '<p class="muted">Drafts are private. Submitted stories cannot be edited until an editor returns them. There is no subscription cap on personal drafts; Firebase storage and service limits apply.</p>'+
      (list.length?list.map(listingCard).join(''):'<p>You have no novels yet. Use the form to create your first original story.</p>');
  }catch(e){
    if(state.user?.uid!==currentUid)return;
    const target=host.querySelector('#studio-story-list');
    if(target)target.innerHTML='<h2>My novels</h2><p class="muted">Your manuscript list is temporarily unavailable. The new draft form stays open so you do not lose what you have typed.</p>';
    fail(e);
  }
}
async function openStory(id){
  if(!state.user||!safeDocId(id))return;
  wait('Opening your draft…');
  try{
    const snapshot=await getDoc(doc(db,'authorStories',id));
    if(!snapshot.exists()||snapshot.data().ownerUid!==state.user.uid){notice('This draft is not available to your account.',true);await studioHome();return;}
    state.story={id,...snapshot.data()};
    state.chapters=await chaptersFor(id);state.editing=0;renderEditor();
  }catch(e){fail(e);}
}
function renderEditor(){
  const s=state.story;
  if(!s)return;
  const canEdit=s.status==='draft';
  const wordTotal=chapterWords(state.chapters);
  const current=state.chapters.find(c=>c.number===state.editing);
  const next=Math.max(0,...state.chapters.map(c=>c.number))+1;
  const activeNumber=current?.number||next;
  const recovery=canEdit&&state.user?readDraft(localStorage,state.user.uid,s.id,activeNumber):null;
  const hasRecovery=canEdit&&draftChanged(recovery,current);
  host.innerHTML='<div class="toolbar"><button class="button outline" data-action="back">← My novels</button>'+statusBadge(s.status)+
    (s.status==='published'?'<a class="button secondary" href="/original-story.html?id='+encodeURIComponent(s.id)+'">Read published story</a>':'')+'</div>'+
    '<section class="panel"><h2>'+esc(s.title)+'</h2><p class="stats">'+state.chapters.length+' chapter(s) · '+wordTotal+' words · Status: '+esc(s.status)+'</p>'+
    (s.moderationNote?'<div class="warning">Editor feedback: '+esc(s.moderationNote)+'</div>':'')+
    (s.status==='submitted'?'<div class="warning">Submitted for review. Editing is paused until the decision.</div>':'')+
    (s.status==='hidden'?'<div class="warning">This novel has been unpublished by an editor following a content or copyright concern. It is not public. Your chapters remain private; <a href="/contact.html">contact NovelHaven</a> to discuss the decision.</div>':'')+
    (s.status==='rejected'?'<div class="warning">Revision requested. Return this story to draft to make changes.</div><button class="button outline" data-action="revise">Revise story</button>':'')+
    '<form class="form-grid" data-form="edit-novel"><div class="two-col"><label>Novel title<input name="title" maxlength="120" minlength="3" required value="'+esc(s.title)+'"'+(canEdit?'':' disabled')+'></label>'+
    '<label>Pen name<input name="penName" maxlength="60" minlength="2" required value="'+esc(s.penName)+'"'+(canEdit?'':' disabled')+'></label></div>'+
    '<label>Genre<select name="genre"'+(canEdit?'':' disabled')+'>'+opts(s.genre)+'</select></label>'+
    '<label>Synopsis<textarea name="summary" minlength="30" maxlength="2000" required'+(canEdit?'':' disabled')+'>'+esc(s.summary)+'</textarea></label>'+
    (canEdit?'<button class="button outline" type="submit">Save novel details</button>':'')+'</form></section>'+
    '<section class="panel"><h2>Chapters</h2><p class="muted">Write your own content. New drafts remain private and no ads run on manuscript pages.</p>'+
    (state.chapters.length?state.chapters.map(c=>'<div class="chapter-item"><div><strong>Chapter '+c.number+': '+esc(c.title)+'</strong><div class="stats">'+wordCount(c.body)+' words</div></div>'+
      (canEdit?'<button class="button outline" data-edit-chapter="'+c.number+'">Edit</button>':'')+'</div>').join(''):'<p>No chapters yet.</p>')+
    (canEdit?(hasRecovery?'<div class="warning author-recovery" data-author-recovery><strong>Unsaved writing found on this device.</strong><p>Your recovery copy is private to this browser. It was not submitted or saved to your account. Restore it into the editor or discard it.</p><div class="toolbar"><button type="button" class="button" data-action="restore-draft">Restore writing</button><button type="button" class="button outline" data-action="discard-draft">Discard backup</button></div></div>':'')+'<form class="form-grid" data-form="chapter"><h3>'+(current?'Edit chapter '+current.number:'New chapter '+next)+'</h3>'+
      '<input type="hidden" name="number" value="'+(current?current.number:next)+'"><label>Chapter title<input maxlength="120" minlength="3" name="title" required value="'+esc(current?.title||'')+'"></label>'+
      '<label>Chapter text<textarea class="chapter-body" name="body" minlength="100" maxlength="45000" required placeholder="Start writing here…">'+esc(current?.body||'')+'</textarea></label>'+
      '<p class="stats" role="status" data-author-backup-status>While you type, a recovery copy is kept on this device. Save Chapter saves the actual draft to your account.</p>'+
      '<div class="toolbar"><button class="button" type="submit">Save chapter draft</button>'+(current?'<button type="button" class="button outline" data-action="new-chapter">Write next chapter</button>':'')+'</div></form>':'')+
    '</section>'+
    (canEdit?'<section class="panel"><h2>Submit for editorial review</h2><p>At least 1 chapter and 300 original words are required before submission. An editor checks originality, rights, quality and safety before making the story public.</p>'+
    '<button class="button" data-action="submit"'+(canSubmit(s,state.chapters)?'':' disabled')+'>Submit for approval</button></section>':'');
}
async function createNovel(form){
  const data=new FormData(form);
  const story={title:cleanText(data.get('title'),120),penName:cleanText(data.get('penName'),60),
    genre:String(data.get('genre')||''),summary:cleanText(data.get('summary'),2000),
    copyrightConfirmed:data.has('copyright'),guidelinesAccepted:data.has('guidelines'),
    ownerUid:state.user.uid,status:'draft',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  if(!validNovel(story)){notice('Complete every field and confirm your ownership of this original work.',true);return;}
  const created=await addDoc(collection(db,'authorStories'),story);
  notice('Private draft created. You can now write chapters.');await openStory(created.id);
}
async function saveDetails(form){
  if(state.story?.status!=='draft')return;
  const data=new FormData(form);
  const patch={title:cleanText(data.get('title'),120),penName:cleanText(data.get('penName'),60),
    genre:String(data.get('genre')||''),summary:cleanText(data.get('summary'),2000),updatedAt:serverTimestamp()};
  if(!validNovel({...state.story,...patch})){notice('Check your title, synopsis and pen name.',true);return;}
  await updateDoc(doc(db,'authorStories',state.story.id),patch);
  state.story={...state.story,...patch};notice('Novel details saved.');renderEditor();
}
async function saveChapter(form){
  if(state.story?.status!=='draft')return;
  const data=new FormData(form),chapter={number:Number(data.get('number')),title:cleanText(data.get('title'),120),
    body:cleanText(data.get('body'),45000),updatedAt:serverTimestamp()};
  if(!validChapter(chapter)){notice('A chapter needs a title and at least 100 characters of original text.',true);return;}
  const chapterId=String(chapter.number).padStart(4,'0');
  await setDoc(doc(db,'authorStories',state.story.id,'chapters',chapterId),chapter);
  clearDraft(localStorage,state.user.uid,state.story.id,chapter.number);
  state.chapters=await chaptersFor(state.story.id);state.editing=0;
  notice('Chapter draft saved securely to your account.');renderEditor();
}
async function submitNovel(){
  const s=state.story;
  if(s?.status!=='draft'||!canSubmit(s,state.chapters)){notice('Write at least 300 original words across your chapters, then try again.',true);return;}
  if(!changeChapterSafely())return;
  const pending=pendingDraftNumbers(localStorage,state.user.uid,s.id,state.chapters);
  if(pending.length){
    notice('Unsaved writing remains on this device for Chapter '+pending.join(', ')+'. Save those chapters to your account or discard their backups before submitting.',true);
    return;
  }
  if(!confirm('Submit this novel for editorial approval? You cannot edit it while the submission is under review.'))return;
  await updateDoc(doc(db,'authorStories',s.id),{status:'submitted',updatedAt:serverTimestamp()});
  state.story={...s,status:'submitted'};notice('Your novel is submitted. It is not yet public.');renderEditor();
}
async function reviseNovel(){
  if(state.story?.status!=='rejected')return;
  await updateDoc(doc(db,'authorStories',state.story.id),{status:'draft',updatedAt:serverTimestamp()});
  state.story.status='draft';notice('Returned to a private draft for revisions.');renderEditor();
}
async function adminHome(){
  if(!state.user){signInPrompt();return;}
  if(!state.isAdmin){host.innerHTML='<section class="panel"><h2>Editor access only</h2><p>This review dashboard is restricted to the administrator selected by the NovelHaven owner. Writers can manage their manuscripts from Author Studio.</p><a class="button" href="/author-studio.html">Author Studio</a></section>';return;}
  state.story=null;wait('Loading submitted manuscripts…');
  try{
    const [waiting,publishedSnapshot,draftSnapshot]=await Promise.all([
      getDocs(query(collection(db,'authorStories'),where('status','==','submitted'))),
      getDocs(query(collection(db,'authorStories'),where('status','==','published'))),
       getDocs(query(collection(db,'authorStories'),where('status','==','draft')))
    ]);
    const stories=waiting.docs.map(s=>({id:s.id,...s.data()})).sort((a,b)=>timestamp(b)-timestamp(a));
    const published=publishedSnapshot.docs.map(s=>({id:s.id,...s.data()})).sort((a,b)=>timestamp(b)-timestamp(a));
    const drafts=draftSnapshot.docs.map(s=>({id:s.id,...s.data()})).sort((a,b)=>timestamp(b)-timestamp(a));
    const authors=new Set([...stories,...published].map(s=>s.ownerUid)).size;
    host.innerHTML='<section class="dashboard-summary"><span class="author-eyebrow">VERIFIED ADMINISTRATOR</span><h2>Your publishing desk</h2><div class="dashboard-stats"><div><strong>'+stories.length+'</strong><span>Awaiting review</span></div><div><strong>'+published.length+'</strong><span>Published originals</span></div><div><strong>'+authors+'</strong><span>Authors with submitted or published work</span></div></div><p>Counts reflect the current submission queue and published original novels.</p></section>'+ '<section class="panel"><h2>Pending manuscripts ('+stories.length+')</h2>'+
      '<p class="muted">New authors require human approval. Only explicitly owner-trusted authors can qualify for automatic approval after objective checks.</p>'+
      (stories.length?stories.map(s=>'<div class="story-card"><div><h3>'+esc(s.title)+'</h3><p>'+esc(s.penName)+' · '+esc(s.genre)+'</p><p>'+esc(s.summary.slice(0,170))+'</p></div><button class="button outline" data-review-open="'+esc(s.id)+'">Review</button></div>').join(''):
        '<p>No submissions are waiting for review.</p>')+'</section>'+
      '<section class="panel"><h2>Private drafts ('+drafts.length+')</h2>'+
      '<p class="muted">Read-only and not publicly visible. Inspect saved chapters for safety or quality without changing the writer\'s work. Drafts cannot be approved before submission.</p>'+
      (drafts.length?drafts.map(s=>'<div class="story-card"><div><h3>'+esc(s.title)+'</h3><p>'+esc(s.penName)+' · '+esc(s.genre)+'</p></div><button class="button outline" data-review-open="'+esc(s.id)+'">Inspect privately</button></div>').join(''):
        '<p>No private drafts found.</p>')+'</section>'+
      '<section class="panel"><h2>Published novels ('+published.length+')</h2>'+
      '<p class="muted">You can take down an approved story when a copyright or content issue is reported. Removal requires a reason and does not delete the author\'s private manuscript.</p>'+
      (published.length?published.map(s=>'<div class="moderation-card"><div><strong>'+esc(s.title)+'</strong><p class="stats">by '+esc(s.penName)+' · '+esc(s.genre)+'</p></div>'+
        '<label class="moderation-reason">Reason for unpublishing (required)<textarea maxlength="500" data-hide-reason="'+esc(s.id)+'" placeholder="Explain the rights or policy concern"></textarea></label>'+
        '<button type="button" class="button outline" data-hide-published="'+esc(s.id)+'">Unpublish this novel</button></div>').join(''):
        '<p>No original novels have been approved yet.</p>')+'</section>';
  }catch(e){fail(e);}
}
async function reviewOpen(id){
  if(!state.isAdmin||!safeDocId(id))return;
  wait('Loading original manuscript for review…');
  try{
    const snap=await getDoc(doc(db,'authorStories',id));
    if(!snap.exists()||!['submitted','draft'].includes(snap.data().status)){await adminHome();return;}
    state.story={id,...snap.data()};state.chapters=await chaptersFor(id);
    const s=state.story;
    host.innerHTML='<div class="toolbar"><button class="button outline" data-action="admin-back">← Owner dashboard</button></div>'+
      '<section class="panel"><h2>'+esc(s.title)+'</h2><p>by '+esc(s.penName)+' · '+esc(s.genre)+'</p><p>'+esc(s.summary)+'</p>'+
      '<p class="stats">'+state.chapters.length+' chapter(s) · '+chapterWords(state.chapters)+' words</p>'+
      (s.status==='draft'?'<div class="warning">PRIVATE DRAFT · Read-only owner inspection. This story cannot be published or rejected until the author submits it. Respect the writer\'s privacy.</div>':'<div class="warning">The author claims originality and permission. This is not independent proof. Check for plagiarism, copyright violations, harmful content and low quality before approving. No ads run on this review.</div>')+'</section>'+
      state.chapters.map(c=>'<section class="panel"><h3>Chapter '+c.number+': '+esc(c.title)+'</h3><div class="story-text">'+esc(c.body)+'</div></section>').join('')+
      (s.status==='submitted'?'<section class="panel"><h2>Editorial decision</h2><label>Reviewer note (optional on approval; required for rejection)<textarea id="review-note" maxlength="500" style="width:100%;min-height:95px;border:1px solid var(--line);border-radius:9px;padding:10px"></textarea></label>'+
      '<div class="toolbar"><button class="button" data-decision="published"'+(canSubmit(s,state.chapters)?'':' disabled')+'>Approve for public reading</button>'+
      '<button class="button outline" data-decision="rejected">Request changes / Reject</button></div>'+
      '<p class="muted">Approved stories become readable immediately. Pages remain ad-free and noindex during the initial publishing pilot.</p></section>':'<section class="panel"><h2>Private draft</h2><p>This manuscript is not submitted. Inspection is read-only; publishing and rejection are disabled until submission.</p></section>');
  }catch(e){fail(e);}
}
async function reviewDecision(status){
  if(!state.isAdmin||state.story?.status!=='submitted'||!['published','rejected'].includes(status))return;
  const note=cleanText(document.getElementById('review-note')?.value||'',500);
  if(status==='rejected'&&!note){notice('Explain what the writer should fix.',true);return;}
  if(status==='published'&&!canSubmit(state.story,state.chapters)){notice('This submission needs a complete novel and at least 300 original words.',true);return;}
  if(!confirm(status==='published'?'Approve this novel for public reading?':'Return this manuscript for revisions?'))return;
  await updateDoc(doc(db,'authorStories',state.story.id),{status,moderationNote:note,reviewedAt:serverTimestamp()});
  notice(status==='published'?'Story approved for public reading.':'Story returned to the author.');await adminHome();
}
async function hidePublished(id){
  if(!state.isAdmin||!safeDocId(id))return;
  const input=host.querySelector('[data-hide-reason="'+id+'"]');
  const reason=cleanText(input?.value||'',500);
  if(reason.trim().length<10){
    notice('Provide a clear reason of at least 10 characters before unpublishing.',true);
    return;
  }
  if(!confirm('Remove this original novel from public reading? The manuscript stays private for its author.'))return;
  const ref=doc(db,'authorStories',id);
  const current=await getDoc(ref);
  if(!current.exists()||current.data().status!=='published'){
    notice('This novel is no longer public. Refresh the queue.',true);return;
  }
  await updateDoc(ref,{status:'hidden',moderationNote:reason,reviewedAt:serverTimestamp()});
  notice('Novel unpublished; its author can still see the private manuscript.');
  await adminHome();
}
async function publicCatalog(){
  wait('Loading approved original stories…');
  try{
    const snap=await getDocs(query(collection(db,'authorStories'),where('status','==','published')));
    const list=snap.docs.map(s=>({id:s.id,...s.data()})).sort((a,b)=>timestamp(b)-timestamp(a));
    host.innerHTML='<section class="panel"><h2>Stories from NovelHaven authors</h2>'+
      '<p class="muted">Only editor-approved original manuscripts are displayed here.</p>'+
      (list.length?'<div class="story-list">'+list.map(s=>'<article class="story-card"><h3>'+esc(s.title)+'</h3><p>'+esc(s.penName)+' · '+esc(s.genre)+'</p><p>'+esc(s.summary.slice(0,240))+'</p><a class="button outline" href="/original-story.html?id='+encodeURIComponent(s.id)+'">Read novel</a></article>').join('')+'</div>':
      '<div class="warning">Original novels are coming soon. Writers can submit their work for review in the Author Studio.</div>')+
      '<div class="toolbar"><a class="button" href="/author-studio.html">Become an author</a></div></section>';
  }catch(e){fail(e);host.innerHTML='<section class="panel"><p>Approved original stories are not available yet. Please check back later.</p><a href="/">Go to NovelHaven</a></section>';}
}
async function publicStory(){
  const id=new URLSearchParams(location.search).get('id');
  if(!safeDocId(id)){host.innerHTML='<section class="panel"><p>Story not found.</p><a href="/original-novels.html">View original novels</a></section>';return;}
  wait('Loading this original story…');
  try{
    const snap=await getDoc(doc(db,'authorStories',id));
    if(!snap.exists()||snap.data().status!=='published'){host.innerHTML='<section class="panel"><p>This novel is not publicly available.</p></section>';return;}
    const story=snap.data(),chs=await chaptersFor(id);
    if(!chs.length){host.innerHTML='<section class="panel"><p>Chapters are unavailable.</p></section>';return;}
    state.story={id,...story};state.chapters=chs;
    let last=1;try{last=Number(localStorage.getItem('novelhaven.original.progress.'+id))||1;}catch{}
    host.innerHTML='<section class="panel"><div class="toolbar"><a class="button outline" href="/original-novels.html">← Original Novels</a></div>'+
      '<h2>'+esc(story.title)+'</h2><p>by '+esc(story.penName)+' · '+esc(story.genre)+'</p><p>'+esc(story.summary)+'</p>'+
      '<p class="stats">An original NovelHaven author submission, reviewed before publication. Chapters: '+chs.length+'</p>'+
      '<p class="stats"><a href="mailto:novelhaven15@gmail.com?subject='+encodeURIComponent('Report NovelHaven original story '+id)+'">Report a copyright or content concern about this novel</a></p></section>'+
      '<section class="panel"><h3>Chapters</h3><div class="toolbar" id="public-chapters">'+
      chs.map(c=>'<button class="button outline" data-read-chapter="'+c.number+'">Chapter '+c.number+'</button>').join('')+'</div></section>'+
      '<article class="panel"><h2 class="reader-title" id="reader-title"></h2><div class="story-text" id="reader-body"></div>'+
      '<div class="toolbar"><button class="button outline" id="chapter-previous" data-action="previous-chapter">Previous</button>'+
      '<button class="button" id="chapter-next" data-action="next-chapter">Next chapter</button></div></article>';
    showPublicChapter(chs.some(c=>c.number===last)?last:chs[0].number);
  }catch(e){fail(e);host.innerHTML='<section class="panel"><p>This story cannot be loaded right now.</p></section>';}
}
function showPublicChapter(number){
  const chapter=state.chapters.find(c=>c.number===number);if(!chapter)return;
  state.editing=number;
  document.getElementById('reader-title').textContent='Chapter '+number+': '+chapter.title;
  document.getElementById('reader-body').textContent=chapter.body;
  const index=state.chapters.findIndex(c=>c.number===number);
  document.getElementById('chapter-previous').disabled=index===0;
  document.getElementById('chapter-next').disabled=index===state.chapters.length-1;
  try{localStorage.setItem('novelhaven.original.progress.'+state.story.id,String(number));}catch{}
}
async function runView(){
  if(view==='studio')await studioHome();
  else if(view==='admin')await adminHome();
  else if(view==='catalog')await publicCatalog();
  else if(view==='reader')await publicStory();
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action],[data-open],[data-edit-chapter],[data-review-open],[data-decision],[data-hide-published],[data-read-chapter]');
  if(!button)return;
  const action=button.dataset.action;
  try{
    if(action==='login'){const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);}
    else if(action==='logout'){if(changeChapterSafely())await signOut(auth);}
    else if(action==='back'){if(changeChapterSafely())await studioHome();}
    else if(action==='new-chapter'){if(changeChapterSafely()){state.editing=0;renderEditor();}}
    else if(action==='restore-draft'){
      const form=chapterForm();
      if(form){
        const number=Number(new FormData(form).get('number'));
        const local=readDraft(localStorage,state.user?.uid,state.story?.id,number);
        if(local){
          form.elements.namedItem('title').value=local.title;
          form.elements.namedItem('body').value=local.body;
          host.querySelector('[data-author-recovery]')?.remove();
          notice('Recovered this device\'s chapter backup. Press Save Chapter to save to your account.');
        }
      }
    }
    else if(action==='discard-draft'){
      const form=chapterForm();
      if(form){
        const number=Number(new FormData(form).get('number'));
        clearDraft(localStorage,state.user?.uid,state.story?.id,number);
        host.querySelector('[data-author-recovery]')?.remove();
        notice('Local recovery copy discarded; the saved chapter was not changed.');
      }
    }
    else if(action==='submit')await submitNovel();
    else if(action==='revise')await reviseNovel();
    else if(action==='admin-back')await adminHome();
    else if(action==='previous-chapter'||action==='next-chapter'){
      const index=state.chapters.findIndex(c=>c.number===state.editing);
      showPublicChapter(state.chapters[index+(action==='previous-chapter'?-1:1)]?.number);
    }
    else if(button.dataset.open)await openStory(button.dataset.open);
    else if(button.dataset.editChapter){if(changeChapterSafely()){state.editing=Number(button.dataset.editChapter);renderEditor();}}
    else if(button.dataset.reviewOpen)await reviewOpen(button.dataset.reviewOpen);
    else if(button.dataset.decision)await reviewDecision(button.dataset.decision);
    else if(button.dataset.hidePublished)await hidePublished(button.dataset.hidePublished);
    else if(button.dataset.readChapter)showPublicChapter(Number(button.dataset.readChapter));
  }catch(error){fail(error);}
});
document.addEventListener('input',event=>{
  const form=event.target.closest?.('[data-form="chapter"]');
  if(!form||!['title','body'].includes(event.target.name))return;
  clearTimeout(backupTimer);
  backupTimer=setTimeout(captureChapterRecovery,650);
});
window.addEventListener('pagehide',()=>captureChapterRecovery());
document.addEventListener('visibilitychange',()=>{if(document.hidden)captureChapterRecovery();});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
  const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
  try{
    if(!state.user)throw new Error('Not signed in');
    if(form.dataset.form==='create-novel')await createNovel(form);
    else if(form.dataset.form==='edit-novel')await saveDetails(form);
    else if(form.dataset.form==='chapter')await saveChapter(form);
  }catch(error){fail(error);}finally{if(button)button.disabled=false;}
});
onAuthStateChanged(auth,async user=>{
  const ticket=++authGeneration;
  captureChapterRecovery();
  state.user=user;state.isAdmin=false;authUI();
  // Render the writing form in parallel with slow editor-privilege lookup.
  const earlyStudio=view==='studio'?runView():null;
  if(user)try{
    const badge=await getDoc(doc(db,'authorAdmins',user.uid));
    if(ticket!==authGeneration||auth.currentUser?.uid!==user.uid)return;
    state.isAdmin=badge.exists()&&badge.data()?.role==='editor';
  }catch(error){if(!forbidden(error))console.warn('Admin membership is not yet configured.');}
  if(ticket!==authGeneration)return;
  authUI();
  if(view==='studio'){
    await earlyStudio;
    const slot=host.querySelector('[data-studio-admin-slot]');
    if(slot&&state.isAdmin)slot.innerHTML='<a class="button secondary" href="/author-admin.html">Review submissions</a>';
  }else await runView();
});
