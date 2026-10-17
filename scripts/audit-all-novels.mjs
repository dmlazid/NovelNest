// NovelHaven catalog-wide availability audit. Read-only.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','dist');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const scriptPaths=[...read('index.html').matchAll(/<script\b[^>]*src="([^"]+)"/g)]
 .map(m=>m[1].split('?')[0])
 .filter(s=>s==='catalog.js'||(/^licensed-/.test(s)&&s!=='licensed-ui.js'));
const scope=vm.createContext({window:{NOVELS:[]}});
const scriptsById=new Map();
for(const file of scriptPaths){
 if(!fs.existsSync(path.join(root,file)))throw Error('Catalog file absent: '+file);
 const code=read(file);
 vm.runInContext(code,scope,{filename:file,timeout:3000});
 const id=code.match(/"id":"([^"]+)"/)?.[1];
 if(id)scriptsById.set(id,file);
}
const catalog=scope.window.NOVELS;
if(!Array.isArray(catalog)||catalog.length<1)throw Error('Cannot inspect the active novel catalog');
vm.runInContext(read('source-activity.js'),scope,{filename:'source-activity.js',timeout:3000});
const rows=catalog.map(n=>{
 const total=n.chapters?.length||0;
 const lastReadable=n.chapters?.reduce((last,c,i)=>c?.removedDuplicate?last:i+1,0)||0;
 const observations=[
  ['sourceScanObservedTip','sourceScanObservedAt','source scan'],
  ['sourceActivityChapter','sourceActivityObservedAt','verified source activity'],
  ['sourceObservedChapter','sourceReleaseAt','importer-observed tip'],
  ['sourceReleaseNumber','sourceReleaseAt','source release']
 ].map(([key,time,label])=>({number:Number(n[key]),observedAt:n[time]||'',label}))
  .filter(o=>Number.isSafeInteger(o.number)&&o.number>0);
 const fresh=observations.sort((a,b)=>b.number-a.number)[0]||null;
 const tip=fresh?.number||null;
 const missing=tip==null?null:Math.max(0,tip-total);
 const file=n.lazyChunks?.prefix? n.lazyChunks.prefix+
  String(Math.ceil(total/(n.lazyChunks.capacity||100))).padStart(2,'0')+'.js':'';
 return {
  id:n.id,title:n.title,source:n.source||'unknown',status:n.status,
  catalogChapters:total,lastReadable,sourceObservedTip:tip,
  missingAfterTip:missing,sourceEvidence:fresh?.label||'unobserved',
  observedAt:fresh?.observedAt||'',catalogScript:scriptsById.get(n.id)||'',
  lastChunk:file,sourceUrl:n.sourceUrl||''
 };
});
const results={
 generatedAt:new Date().toISOString(),
 scope:'NovelHaven registered novels; source observations are cached and not live source verification.',
 count:rows.length,
 chapters:rows.reduce((a,x)=>a+x.catalogChapters,0),
 sourceObserved:rows.filter(x=>x.sourceObservedTip!=null).length,
 behindSource:rows.filter(x=>x.missingAfterTip>0).length,
 unobserved:rows.filter(x=>x.sourceObservedTip==null).length,
 readableAtObservedTip:rows.filter(x=>x.missingAfterTip===0).length,
 totalEstimatedUnimported:rows.reduce((a,x)=>a+(x.missingAfterTip||0),0),
 novels:rows.sort((a,b)=>(b.missingAfterTip||0)-(a.missingAfterTip||0)||a.title.localeCompare(b.title))
};
const output=process.env.NOVEL_AUDIT_JSON||'all-novels-chapter-audit.json';
fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
const table=results.novels.filter(x=>x.missingAfterTip>0).slice(0,30).map(x=>
 '| '+x.title.replace(/\|/g,'/')+' | '+x.catalogChapters+' | '+x.sourceObservedTip+' | '+x.missingAfterTip+' |');
const summary=[
 '## NovelHaven — all novels chapter audit',
 'Source tips are last recorded observations, not independent real-time source checks.',
 '',
 '| Metric | Count |','|---|---:|',
 '| Registered novels | '+results.count+' |',
 '| Numbered local chapter slots | '+results.chapters+' |',
 '| Observed source tip available | '+results.sourceObserved+' |',
 '| Behind an observed source tip | '+results.behindSource+' |',
 '| Source tip unavailable | '+results.unobserved+' |',
 '| Estimated chapters not yet imported | '+results.totalEstimatedUnimported+' |',
 '', '### Top catch-up priorities',
 '| Novel | Imported | Source seen | Difference |',
 '|---|---:|---:|---:|',...table,
 '','Complete per-novel details are attached as JSON.',
 'Source lag alone does NOT mean an imported chapter file is broken.'
].join('\n')+'\n';
const md=process.env.NOVEL_AUDIT_MD||'all-novels-chapter-audit.md';
fs.writeFileSync(md,summary);
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
if(results.count<90)throw Error('Expected current catalog to contain 90+ novels');
