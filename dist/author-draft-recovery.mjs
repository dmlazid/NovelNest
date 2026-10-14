// NovelHaven private, device-only recovery copies for draft chapter forms.
// These never write to Firestore, publish a manuscript, or change reader bookmarks.
const PREFIX='novelhaven.author-recovery.v1.';
const MAX_TITLE=120, MAX_BODY=45000;
export function draftKey(uid,storyId,number){
  if(typeof uid!=='string'||uid.length<1||uid.length>256||
     typeof storyId!=='string'||!/^[A-Za-z0-9]{6,100}$/.test(storyId)||
     !Number.isInteger(number)||number<1||number>9999)return null;
  return PREFIX+encodeURIComponent(uid)+'.'+storyId+'.'+number;
}
export function readDraft(storage,uid,storyId,number){
  const key=draftKey(uid,storyId,number);if(!key)return null;
  try{
    const value=JSON.parse(storage.getItem(key));
    if(value?.version!==1||typeof value.title!=='string'||typeof value.body!=='string'||
       value.title.length>MAX_TITLE||value.body.length>MAX_BODY||
       !Number.isFinite(value.at)||value.at<0)return null;
    return {title:value.title,body:value.body,at:value.at};
  }catch{return null;}
}
export function saveDraft(storage,uid,storyId,number,fields,at=Date.now()){
  const key=draftKey(uid,storyId,number);if(!key)return false;
  const title=String(fields?.title??'').slice(0,MAX_TITLE);
  const body=String(fields?.body??'').slice(0,MAX_BODY);
  try{
    if(!title.trim()&&!body.trim()){storage.removeItem(key);return true;}
    storage.setItem(key,JSON.stringify({version:1,title,body,at}));
    return true;
  }catch{return false;}
}
export function clearDraft(storage,uid,storyId,number){
  const key=draftKey(uid,storyId,number);if(!key)return false;
  try{storage.removeItem(key);return true;}catch{return false;}
}
export function draftChanged(draft,saved){
  return !!draft&&(draft.title!==String(saved?.title??'')||
    draft.body!==String(saved?.body??''));
}
export function pendingDraftNumbers(storage,uid,storyId,chapters=[]){
  if(!Array.isArray(chapters))return [];
  const max=Math.max(0,...chapters.map(ch=>Number(ch.number)||0));
  const entries=[...chapters,{number:max+1,title:'',body:''}];
  return entries.filter(ch=>Number.isInteger(ch.number)&&ch.number<=9999&&
    draftChanged(readDraft(storage,uid,storyId,ch.number),ch))
    .map(ch=>ch.number);
}
