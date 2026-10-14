// Owner-only view of server-generated moderation reports.
// Never reads author chapter text; public visitors cannot read these Firestore collections.
import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore,doc,getDoc,collection,getDocs,query,limit,orderBy} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
if(document.body.dataset.authorPage==='admin'&&window.NOVELNEST_FIREBASE?.projectId){
  const app=getApps().length?getApp():initializeApp(window.NOVELNEST_FIREBASE);
  const auth=getAuth(app),db=getFirestore(app),host=document.getElementById('author-content');
  const reports=new Map();
  let history=[],heartbeat=null,ready=false,busy=false,lastReview='',generation=0,problem='';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const friendlyTime=t=>{try{return t?.toDate?.().toLocaleString()||'Not checked yet';}catch{return 'Unknown';}};
  const label=r=>r?.level==='action-required'?'Action required':
    r?.level==='needs-review'?'Needs review':r?.level==='basic-checks-passed'?'Basic checks passed':'Not yet screened';
  const tone=r=>r?.level==='action-required'?'action':r?.level==='needs-review'?'warning':
    r?.level==='basic-checks-passed'?'clear':'waiting';
  const detail=r=>!r?'<p>Awaiting background screening. Review all chapters yourself before deciding.</p>':
    '<p><strong>'+escape(label(r))+'</strong> · '+Number(r.chapterCount||0)+' scanned chapter(s) · '+Number(r.wordCount||0)+' words</p>'+
    ((r.reasons||[]).length?'<h4>Changes needed</h4><ul>'+r.reasons.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul>':'')+
    ((r.warnings||[]).length?'<h4>Review carefully</h4><ul>'+r.warnings.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul>':'')+
    '<p class="bot-disclaimer">Automatic screening does not establish originality, copyright permission, or contextual safety. Check the manuscript before approval.</p>'+
    '<p class="bot-disclaimer">Last checked: '+escape(friendlyTime(r.checkedAt))+'</p>';
  function decorate(){
    if(!ready||!host)return;
    const dashboard=host.querySelector('.dashboard-summary');
    if(dashboard&&!host.querySelector('#bot-console')){
      const issues=[...reports.values()].filter(r=>r.sourceStatus!=='draft'&&r.level!=='basic-checks-passed').length;
      const newest=[...reports.values()].map(r=>r.checkedAt?.toMillis?.()||0).reduce((a,b)=>Math.max(a,b),0);
      const recent=[...reports.values()].find(r=>(r.checkedAt?.toMillis?.()||0)===newest);
      const lastScan=heartbeat?.checkedAt||recent?.checkedAt;
      const scannedInRun=Number(heartbeat?.scanned||0);
      const failedInRun=Number(heartbeat?.failed||0);
      const healthMessage=heartbeat?.status==='healthy'
        ?'<p class="bot-health">✓ Background moderation checked Firebase successfully. '+scannedInRun+' manuscript(s) screened in the latest run.</p>'
        :heartbeat?.status==='needs-attention'
          ?'<p class="bot-alert">The most recent background check had '+failedInRun+' error(s). Open GitHub Actions to inspect the job.</p>'
          :'<p class="bot-disclaimer">No worker heartbeat has been recorded yet. The latest GitHub workflow must run with the updated code before this status appears.</p>';
      const el=document.createElement('section');el.id='bot-console';el.className='panel bot-console';
      el.innerHTML='<div class="bot-heading"><div><span class="author-eyebrow">AUTOMATIC + OWNER REVIEW</span><h2>Smart Moderation Center</h2></div><button class="button outline" type="button" data-bot-refresh>Refresh reports</button></div>'+
        '<div class="bot-stats"><div><strong>'+reports.size+'</strong><span>Manuscripts screened</span></div>'+
        '<div><strong>'+issues+'</strong><span>Reports needing attention</span></div>'+
        '<div><strong>'+escape(lastScan?friendlyTime(lastScan):'Not recorded')+'</strong><span>Most recent scan</span></div></div>'+healthMessage+
        (problem?'<p class="bot-alert">'+escape(problem)+'</p>':'')+
        (reports.size?'<p>Automatic checks are recorded below. NovelHaven still sends uncertain submissions for your editorial review.</p>':
          '<p>No saved original manuscripts have been screened yet. If no authors have saved or submitted stories, this is normal. The publishing queue is ready for future manuscripts.</p>')+
        '<p class="bot-disclaimer">Personal drafts remain private and are never auto-published. Automatic publication is limited to owner-trusted author UIDs that you explicitly configure. A basic screening pass is not proof of copyright ownership.</p>'+
        '<h3>Recent automatic decisions</h3>'+
        (history.length?'<ul class="bot-history">'+history.slice(0,8).map(a=>'<li><strong>'+escape(a.action||'Checked')+
          '</strong> · '+escape(a.storyId||'')+'<span>'+escape(friendlyTime(a.createdAt))+'</span><p>'+escape(a.reason||'')+'</p></li>').join('')+'</ul>':
          '<p class="muted">No automatic decisions have been recorded.</p>');
      dashboard.insertAdjacentElement('afterend',el);
    }
    for(const card of host.querySelectorAll('[data-review-open],[data-hide-published]')){
      const id=card.dataset.reviewOpen||card.dataset.hidePublished;
      const parent=card.closest('.story-card,.moderation-card');
      if(!parent||parent.querySelector('.bot-risk'))continue;
      const r=reports.get(id),node=document.createElement('span');
      node.className='bot-risk bot-risk-'+tone(r);
      node.textContent='✦ '+label(r);
      node.title='Automatic check; not an editorial decision';
      parent.querySelector('div')?.append(node);
    }
    const note=host.querySelector('#review-note');
    if(note&&lastReview&&!host.querySelector('#bot-review-detail')){
      const el=document.createElement('section');el.className='panel bot-review';el.id='bot-review-detail';
      const r=reports.get(lastReview);
      el.innerHTML='<span class="author-eyebrow">AUTOMATIC SCREENING · OWNER VERIFIES</span><h2>'+escape(label(r))+'</h2>'+detail(r);
      note.closest('section')?.insertAdjacentElement('beforebegin',el);
    }
  }
  let queued=false;
  const observer=new MutationObserver(()=>{
    if(queued)return;queued=true;
    queueMicrotask(()=>{queued=false;decorate();});
  });
  if(host)observer.observe(host,{childList:true,subtree:true});
  document.addEventListener('click',event=>{
    const selected=event.target.closest('[data-review-open]');
    if(selected)lastReview=selected.dataset.reviewOpen||'';
    if(event.target.closest('[data-bot-refresh]')){
      event.preventDefault();
      load();
    }
    if(event.target.closest('[data-action="admin-back"]'))lastReview='';
  },true);
  async function load(){
    if(!ready||busy)return;
    busy=true;
    try{
      // Only editor accounts may read these collections; Firestore rules verify membership.
      const [items,audit]=await Promise.all([
        getDocs(query(collection(db,'moderationReviews'),orderBy('checkedAt','desc'),limit(500))),
        getDocs(query(collection(db,'moderationAudit'),orderBy('createdAt','desc'),limit(25)))
      ]);
      reports.clear();heartbeat=null;
      for(const item of items.docs){
        const data=item.data();
        if(item.id==='__worker_status__'&&data.recordType==='worker-status'){
          heartbeat=data;
          continue;
        }
        if(data.recordType==='worker-status')continue;
        reports.set(item.id,data);
      }
      history=audit.docs.map(x=>x.data());problem='';
    }catch(e){problem='Automatic report access is unavailable. Publish the repository moderation Firestore rules, or check the owner account permissions.';console.warn('Moderation console read unavailable:',e?.code||'unknown');}
    finally{
      busy=false;
      host.querySelector('#bot-console')?.remove();
      host.querySelector('#bot-review-detail')?.remove();
      host.querySelectorAll('.bot-risk').forEach(x=>x.remove());
      decorate();
    }
  }
  onAuthStateChanged(auth,async user=>{
    const current=++generation;ready=false;reports.clear();history=[];heartbeat=null;problem='';
    host.querySelector('#bot-console')?.remove();
    if(!user)return;
    try{
      const badge=await getDoc(doc(db,'authorAdmins',user.uid));
      if(current!==generation)return;
      ready=badge.exists()&&badge.data()?.role==='editor';
      if(ready)await load();
    }catch(e){console.warn('Cannot verify moderation dashboard access:',e?.code||'unknown');}
  });
}
