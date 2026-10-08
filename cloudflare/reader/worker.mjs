export const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderChapter(template,{id,title,total,number,chapter}){
  if(!Array.isArray(chapter.paragraphs)||!chapter.paragraphs.length||!chapter.paragraphs.every(p=>typeof p==='string'&&p.trim()))throw Error('Invalid chapter');
  const root='/novel/'+encodeURIComponent(id)+'/',url=root+'chapter-'+number+'/';
  const body='<article class="reader-wrap"><div class="reader-heading"><a href="'+root+'">'+htmlEscape(title)+'</a><h1>'+htmlEscape(chapter.title)+'</h1></div><div class="prose" data-static-chapter="'+htmlEscape(id)+'" data-chapter-number="'+number+'">'+chapter.paragraphs.map(p=>'<p>'+htmlEscape(p)+'</p>').join('')+'</div><nav class="chapter-nav">'+(number>1?'<a href="'+root+'chapter-'+(number-1)+'/">Previous chapter</a>':'')+'<a href="'+root+'">Chapters</a>'+(number<total?'<a href="'+root+'chapter-'+(number+1)+'/">Next chapter</a>':'')+'</nav></article>';
  return template.split('CHAPTER_TITLE_TOKEN').join(htmlEscape(title+' — '+chapter.title)).split('CHAPTER_URL_TOKEN').join(htmlEscape(url)).split('CHAPTER_ROOT_TOKEN').join(htmlEscape(root)).split('CHAPTER_BODY_TOKEN').join(body);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  if(url.pathname.startsWith('/_internal/'))return new Response('Not found',{status:404});
  const match=url.pathname.match(/^\/novel\/([^/]+)\/chapter-(\d+)\/$/);
  if(!match)return env.ASSETS.fetch(request);
  try{
    const id=decodeURIComponent(match[1]),number=Number(match[2]);
    const assets=p=>env.ASSETS.fetch(new Request(new URL(p,url)));
    const metadataResponse=await assets('/_internal/novels.json');
    if(!metadataResponse.ok)throw Error('Missing catalog');
    const metadata=await metadataResponse.json(),novel=Object.hasOwn(metadata,id)?metadata[id]:null;
    if(!novel||!Number.isSafeInteger(number)||number<1||number>novel.total)return new Response('Chapter not found',{status:404});
    const route=await env.DB1.prepare('SELECT database_id FROM novel_shards WHERE novel_id=?').bind(id).first();
    const binding=env.SHARD_BINDINGS[route?.database_id];
    if(!binding||!env[binding])throw Error('Missing verified route');
    const row=await env[binding].prepare('SELECT title,paragraphs_json FROM chapters WHERE novel_id=? AND chapter_number=?').bind(id,number).first();
    if(!row)throw Error('Chapter migration incomplete');
    const template=await assets('/_internal/chapter.html');if(!template.ok)throw Error('Missing template');
    const body=renderChapter(await template.text(),{id,title:novel.title,total:novel.total,number,chapter:{title:row.title,paragraphs:JSON.parse(row.paragraphs_json)}});
    return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('This chapter is temporarily unavailable. Please try again shortly.',{status:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});}
 }
};
