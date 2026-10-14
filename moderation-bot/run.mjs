// Scheduled moderation for NovelHaven. Server-side Firebase Admin only.
// Requires a GitHub Actions secret; never bundle service-account credentials in dist/.
import {createHash} from 'node:crypto';
import {cert,initializeApp} from 'firebase-admin/app';
import {getFirestore,FieldValue,FieldPath} from 'firebase-admin/firestore';
import {screenStory} from './scan.mjs';

const raw=process.env.NOVELHAVEN_FIREBASE_SERVICE_ACCOUNT;
if(!raw)throw new Error('NOVELHAVEN_FIREBASE_SERVICE_ACCOUNT secret is missing. Bot not started.');
let credential;
try{credential=JSON.parse(raw);}catch{throw new Error('Firebase service account must be complete JSON.');}
if(credential.project_id!=='novelnest-7d9ca'||credential.type!=='service_account')
  throw new Error('Service account is not for the approved NovelHaven Firebase project.');
initializeApp({credential:cert(credential),projectId:'novelnest-7d9ca'});
const db=getFirestore();
const trusted=new Set((process.env.NOVELHAVEN_TRUSTED_AUTHOR_UIDS||'').split(',').map(x=>x.trim()).filter(Boolean));
// Empty allowlist is deliberate: new authors ALWAYS need manual copyright/quality review.
const MAX_STORIES=100, MAX_CHAPTERS=300, SCAN_REV='2026-10-14-v1';
const cursorRef=db.collection('moderationBotState').doc('cursor');
// Keep an editor-readable heartbeat alongside moderation results, even when no books exist.
// Firestore browser rules already restrict the moderationReviews collection to editors.
const workerStatusRef=db.collection('moderationReviews').doc('worker_status');
const iso=()=>new Date().toISOString();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function noteFrom(result){
  return ('Automatic check: '+result.reasons.join(' ')+' Review your saved chapters and resubmit.').slice(0,500);
}
async function changeStatus(storyDoc,original,to,result){
  const target=storyDoc.ref,reviewedAt=FieldValue.serverTimestamp();
  const verb=to==='published'?'auto-published':'auto-returned';
  let done=false;
  await db.runTransaction(async tx=>{
    done=false;
    const latest=await tx.get(target);
    if(!latest.exists)return;
    const current=latest.data();
    if(current.status!=='submitted'||current.ownerUid!==original.ownerUid||
       current.updatedAt?.toMillis?.()!==original.updatedAt?.toMillis?.())return;
    const note=to==='published'?'Automatic basic screening passed; trusted author preapproved by owner.':noteFrom(result);
    tx.update(target,{status:to,moderationNote:note,reviewedAt});
    tx.set(db.collection('moderationAudit').doc(),{
      storyId:target.id,actor:'novelhaven-moderation-bot',action:verb,reason:note,
      createdAt:reviewedAt,previousStatus:'submitted',nextStatus:to
    });
    done=true;
  });
  return done?verb:'';
}
async function main(){
  const saved=(await cursorRef.get()).data()?.afterId||'';
  let q=db.collection('authorStories').orderBy(FieldPath.documentId()).limit(MAX_STORIES);
  if(saved)q=q.startAfter(saved);
  const batch=await q.get();
  let checked=0,changed=0,flagged=0,skipped=0,errors=0;
  for(const storyDoc of batch.docs){
    try{
      const story=storyDoc.data();
      // Use bounded scanning. Incomplete chapter scans must never auto-approve.
      const ch=await storyDoc.ref.collection('chapters').limit(MAX_CHAPTERS+1).get();
      const complete=ch.size<=MAX_CHAPTERS;
      const chapters=ch.docs.slice(0,MAX_CHAPTERS).map(d=>d.data());
      const result=screenStory(story,chapters,{complete});
      // Hash text in memory only; store fingerprint instead of manuscript contents.
      const fingerprint=hash({version:SCAN_REV,status:story.status,story,
        chapters:chapters.map(c=>({number:c.number,title:c.title,body:c.body}))});
      const ref=db.collection('moderationReviews').doc(storyDoc.id);
      const old=(await ref.get()).data();
      const freshness=old?.checkedAt?.toMillis?.()||0;
      const recentlyChecked=Date.now()-freshness<24*60*60*1000;
      let action='';
      if(story.status==='submitted'&&result.level==='action-required')
        action=await changeStatus(storyDoc,story,'rejected',result);
      else if(story.status==='submitted'&&result.level==='basic-checks-passed'&&
              result.fullyScanned&&trusted.has(story.ownerUid))
        action=await changeStatus(storyDoc,story,'published',result);
      if(old?.fingerprint!==fingerprint||!recentlyChecked||action){
        await ref.set({...result,sourceStatus:story.status,
          automaticAction:action||'none',fingerprint,scanVersion:SCAN_REV,checkedAt:FieldValue.serverTimestamp()});
        changed++;
      }else skipped++;
      if(result.level!=='basic-checks-passed')flagged++;
      checked++;
      console.log('Screened manuscript; status:',story.status,'screen:',result.level,'action:',action||'none');
    }catch(e){
      errors++;
      // GitHub Actions logs may be public: never print private story IDs, titles, or manuscript text.
      console.error('One manuscript could not be screened; error type:',String(e?.code||e?.name||'unknown'));
    }
  }
  // Do not skip failed manuscripts on the next run. The previous cursor is retained.
  const nextCursor=errors?saved:(batch.size<MAX_STORIES?'':batch.docs.at(-1)?.id||'');
  await cursorRef.set({afterId:nextCursor,
    ranAt:FieldValue.serverTimestamp(),scanned:checked,flagged,updatedReports:changed,errors});
  // Only health and counts go into the editor-readable status document.
  // Never put private draft text, account UIDs, or service-account credentials here.
  await workerStatusRef.set({
    recordType:'worker-status',checkedAt:FieldValue.serverTimestamp(),
    scanSucceeded:errors===0,status:errors?'needs-attention':'healthy',
    scanned:checked,failed:errors,flagged,updatedReports:changed,
    unchanged:skipped,storiesSeen:batch.size,
    continuesNextRun:errors===0&&batch.size===MAX_STORIES,
    scanVersion:SCAN_REV
  });
  console.log(JSON.stringify({time:iso(),checked,errors,flagged,updatedReports:changed,
    unchanged:skipped,nextRunContinues:errors===0&&batch.size===MAX_STORIES}));
  if(errors)throw new Error(errors+' manuscript(s) failed screening; retry is needed.');
}
await main();
