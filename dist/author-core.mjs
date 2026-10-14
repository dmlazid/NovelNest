export const GENRES=['Fantasy','Romance','Adventure','Mystery','Science Fiction','Historical','Slice of Life','Other'];
export const wordCount=text=>String(text||'').trim().split(/\s+/).filter(Boolean).length;
export const cleanText=(text,max)=>String(text||'').trim().slice(0,max);
export const validNovel=novel=>!!novel&&typeof novel.title==='string'&&novel.title.trim().length>=3&&novel.title.length<=120&&
  typeof novel.summary==='string'&&novel.summary.trim().length>=30&&novel.summary.length<=2000&&
  GENRES.includes(novel.genre)&&typeof novel.penName==='string'&&novel.penName.trim().length>=2&&novel.penName.length<=60&&
  novel.copyrightConfirmed===true&&novel.guidelinesAccepted===true;
export const validChapter=chapter=>Number.isInteger(chapter.number)&&chapter.number>=1&&chapter.number<=9999&&
  typeof chapter.title==='string'&&chapter.title.trim().length>=3&&chapter.title.length<=120&&
  typeof chapter.body==='string'&&chapter.body.trim().length>=100&&chapter.body.length<=45000;
export const canSubmit=(story,chapters)=>validNovel(story)&&Array.isArray(chapters)&&chapters.length>0&&
 chapters.every(validChapter)&&chapters.reduce((total,chapter)=>total+wordCount(chapter.body),0)>=300;
export const safeDocId=value=>typeof value==='string'&&/^[A-Za-z0-9]{6,100}$/.test(value);
export const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
