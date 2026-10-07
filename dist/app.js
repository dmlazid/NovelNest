'use strict';
const novels=window.NOVELS;
const main=document.querySelector('#main');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
let saved=read('novelnest.saved',[]); if(!Array.isArray(saved)) saved=[]; saved=saved.filter(id=>novels.some(n=>n.id===id));
let progress=read('novelnest.progress',{}); if(!progress||typeof progress!=='object'||Array.isArray(progress))progress={};
let preferences=read('novelnest.preferences',{}); if(!preferences||typeof preferences!=='object')preferences={};
let storageWarning=false;
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));if(key!=='novelnest.preferences')window.NovelNestAccounts?.changed()}catch{if(!storageWarning){toast('Storage is unavailable. Changes will last for this visit.');storageWarning=true}}}
function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200)}
function applySettings(){document.body.dataset.theme=['night','sepia'].includes(preferences.theme)?preferences.theme:'light';document.documentElement.style.setProperty('--reader-size',`${Math.min(28,Math.max(16,Number(preferences.size)||20))}px`)}
function toggleSave(id){if(!novels.some(n=>n.id===id))throw new Error('Unknown novel');const exists=saved.includes(id);saved=exists?saved.filter(x=>x!==id):[...saved,id];persist('novelnest.saved',saved);document.querySelector('#library-count').textContent=saved.length;document.querySelectorAll('[data-save]').forEach(b=>{if(b.dataset.save===id){b.textContent=saved.includes(id)?'♥ Saved in library':'♡ Save to library';b.setAttribute('aria-pressed',String(saved.includes(id)))}});toast(exists?'Removed from your library':'Saved to your library');return {id,saved:!exists}}
const internalUrl=path=>`./#${path.startsWith('/')?path:'/'+path}`;
const bookUrl=n=>internalUrl(`/novel/${n.id}`);
const chapterUrl=(n,i)=>internalUrl(`/read/${n.id}/${i+1}`);
const SYNOPSIS_PREVIEW_LENGTH = 340;
function synopsisHtml(n){
  const full = String(n.synopsis || '').trim();
  if (full.length <= SYNOPSIS_PREVIEW_LENGTH) return `<p>${esc(full)}</p>`;
  let cut = full.lastIndexOf(' ', SYNOPSIS_PREVIEW_LENGTH);
  if (cut < SYNOPSIS_PREVIEW_LENGTH - 65) cut = SYNOPSIS_PREVIEW_LENGTH;
  const preview = full.slice(0, cut).trimEnd();
  const id = `synopsis-full-${n.id}`;
  return `<div class="synopsis-collapsible" data-synopsis>
    <p data-synopsis-preview>${esc(preview)}…</p>
    <p id="${esc(id)}" data-synopsis-full hidden>${esc(full)}</p>
    <button type="button" class="synopsis-toggle" data-synopsis-toggle aria-controls="${esc(id)}" aria-expanded="false">See more</button>
  </div>`;
}
const image=n=>n.externalUrl?`<div class="cover external-cover" aria-hidden="true"><span>EXTERNAL<br>READ</span><strong>G</strong><span>NovelNest<br>Reading list</span></div>`:`<img class="cover" src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy" width="200" height="300">`;
const genres=[...new Set(novels.flatMap(n=>n.tags))].sort();
function searchForm(value=''){return `<form class="search-form" role="search"><span aria-hidden="true">⌕</span><input name="q" aria-label="Search novels by title or author" placeholder="Search titles, authors, genres…" value="${esc(value)}"><button aria-label="Search" type="submit">Search</button></form>`}
function chips(selected='All'){return `<div class="chips" aria-label="Filter by genre">${['All',...genres].map(g=>`<a class="chip ${selected===g?'selected':''}" ${selected===g?'aria-current="true"':''} href="./#/browse${g==='All'?'':'?genre='+encodeURIComponent(g)}">${g}</a>`).join('')}</div>`}
function card(n){return `<a class="book-card" href="${bookUrl(n)}">${image(n)}<div><span class="tag">${esc(n.genre)}</span><h3>${esc(n.title)}</h3><p>${esc(n.author)}</p><p>${n.externalUrl?"Read on "+esc(n.externalSource):n.chapters.length+" chapters"} · ${esc(n.status)}</p><span class="meta">${n.externalUrl?"External reading link":"Licensed edition"}</span></div></a>`}
function lastRead(n){const p=progress[n.id];return p&&Number.isInteger(p.chapter)&&p.chapter>=0&&p.chapter<n.chapters.length?p:null}
function latestRows(limit=9){return novels.flatMap(n=>n.chapters.map((c,i)=>({n,c,i}))).sort((a,b)=>b.n.updated.localeCompare(a.n.updated)||b.i-a.i).slice(0,limit).map(({n,c,i})=>`<a class="chapter-row" href="${chapterUrl(n,i)}">${image(n)}<div><strong>${esc(n.title)}</strong><p>Chapter ${i+1}: ${esc(c.title)}</p></div><time datetime="${n.updated}">${new Date(n.updated+'T00:00:00Z').toLocaleDateString('en',{month:'short',day:'numeric',timeZone:'UTC'})}</time></a>`).join('')}
function continueBox(){const recent=novels.filter(n=>lastRead(n)).sort((a,b)=>(lastRead(b).at||0)-(lastRead(a).at||0))[0];return recent?`<section class="continue-box"><div><span class="eyebrow">Continue reading</span><p><strong>${esc(recent.title)}</strong> · Chapter ${lastRead(recent).chapter+1}</p></div><a class="button" href="${chapterUrl(recent,lastRead(recent).chapter)}">Continue</a></section>`:''}
function homeDate(value){
  const date=new Date(value+'T00:00:00Z');
  return Number.isNaN(date.getTime())?'Updated':date.toLocaleDateString('en',{month:'short',day:'numeric',timeZone:'UTC'});
}
function homeReleaseRow(n){
  const i=Math.max(0,n.chapters.length-1),c=n.chapters[i];
  return `<a class="home-release-row" href="${chapterUrl(n,i)}">
    <img class="home-release-cover" src="${esc(n.cover)}" alt="" loading="lazy">
    <span class="home-release-copy">
      <strong>${esc(n.title)}</strong>
      <small>${esc(n.tags.slice(0,2).join(', ')||n.genre)}</small>
      <span><b>Ch. ${i+1}</b> ${esc(c?.title||'Latest chapter')}</span>
    </span>
    <time datetime="${esc(n.updated)}">${homeDate(n.updated)}</time>
  </a>`;
}
function homeNovelTile(n){
  return `<a class="home-novel-tile" href="${bookUrl(n)}">
    <span class="home-tile-art">
      <img src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy">
      <span class="home-tile-shade"></span>
      <span class="home-tile-copy">
        <strong>${esc(n.title)}</strong>
        <small>▣ English Novel</small>
        <small>▤ ${esc(n.tags.slice(0,2).join(' · ')||n.genre)}</small>
      </span>
    </span>
    <span class="home-tile-badges">
      ${n.status==='Completed'?'<b class="home-full-badge">Full</b>':''}
      <b class="home-chapter-badge">${n.chapters.length} Chapters</b>
    </span>
  </a>`;
}
function homeTopFeature(n){
  return `<a class="home-top-feature" href="${bookUrl(n)}">
    <span class="home-top-art">
      <img src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy">
      <span class="home-top-overlay"></span>
      <span class="home-top-copy">
        <strong>${esc(n.title)}</strong>
        <small>◉ English Novel</small>
        <small>▤ ${esc(n.tags.slice(0,2).join(' · ')||n.genre)}</small>
      </span>
    </span>
    <span class="home-top-badge">${n.chapters.length} Chapters</span>
  </a>`;
}
function homeTopRow(n){
  return `<a class="home-top-row" href="${bookUrl(n)}">
    <img src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy">
    <span class="home-top-row-copy">
      <strong>${esc(n.title)}</strong>
      <small>◉ English Novel</small>
      <small>▤ ${esc(n.tags.slice(0,2).join(', ')||n.genre)}</small>
      <b>${n.chapters.length} Chapters</b>
    </span>
  </a>`;
}
function home(){
  const sorted=[...novels].sort((a,b)=>b.updated.localeCompare(a.updated)||b.chapters.length-a.chapters.length);
  const topFeatures=sorted.slice(0,4);
  const topRows=sorted.slice(4,7);
  const releases=sorted.slice(0,10);
  const latestNovels=sorted.slice(0,6);
  const completed=sorted.filter(n=>n.status==='Completed').slice(0,6);
  return `<div class="home-feed">
    <section class="home-showcase" aria-label="Featured novels">
      <div class="home-top-grid">${topFeatures.map(homeTopFeature).join('')}</div>
      <div class="home-top-list">${topRows.map(homeTopRow).join('')}</div>
    </section>
    <section class="home-feed-section home-release-section">
      <div class="home-feed-head"><h1><span aria-hidden="true">↻</span> Latest Release Novels</h1><a href="./#/latest-releases">See more</a></div>
      <div class="home-release-list">${releases.map(homeReleaseRow).join('')}</div>
    </section>
    <section class="home-feed-section">
      <div class="home-feed-head"><h2><span aria-hidden="true">↻</span> Latest Novels</h2><a href="./#/latest-novels">See more</a></div>
      <div class="home-cover-grid">${latestNovels.map(homeNovelTile).join('')}</div>
    </section>
    <section class="home-feed-section">
      <div class="home-feed-head"><h2><span aria-hidden="true">✓</span> Completed Novels</h2><a href="./#/completed">See more</a></div>
      ${completed.length?`<div class="home-cover-grid">${completed.map(homeNovelTile).join('')}</div>`:'<p class="home-empty">No completed novels yet.</p>'}
    </section>
  </div>`;
}
function directoryRow(n){
  const tags=(n.tags||[]).slice(0,2).join(', ')||n.genre||'Novel';
  return `<a class="directory-novel-row" href="${bookUrl(n)}">
    <img class="directory-novel-cover" src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy">
    <span class="directory-novel-copy">
      <strong class="directory-novel-title">${esc(n.title)}</strong>
      <small class="directory-novel-author">${esc(n.author)}</small>
      <span class="directory-novel-meta"><span aria-hidden="true">◉</span> English Novel</span>
      <span class="directory-novel-meta"><span aria-hidden="true">▤</span> ${esc(tags)}</span>
      <span class="directory-novel-badges">
        ${n.status==='Completed'?'<b class="directory-full-badge">Full</b>':''}
        <b class="directory-chapter-badge">${n.chapters.length} Chapters</b>
      </span>
    </span>
  </a>`;
}
function directoryPage(kind){
  const settings={
    releases:{title:'Latest Release Novels',icon:'↻',eyebrow:'Fresh updates',description:'Novels with the newest chapter updates first.'},
    novels:{title:'Latest Novels',icon:'↻',eyebrow:'New on NovelNest',description:'Browse the latest novels available in the NovelNest catalog.'},
    completed:{title:'Completed Novels',icon:'✓',eyebrow:'Finished stories',description:'Complete novels you can read from beginning to end.'}
  };
  const cfg=settings[kind]||settings.novels;
  let results=[...novels];
  if(kind==='completed') results=results.filter(n=>n.status==='Completed');
  if(kind==='novels') results.sort((a,b)=>b.updated.localeCompare(a.updated)||a.title.localeCompare(b.title));
  else results.sort((a,b)=>b.updated.localeCompare(a.updated)||b.chapters.length-a.chapters.length);
  return `<div class="directory-page">
    <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">${esc(cfg.title)}</span></nav>
    <section class="directory-shell">
      <header class="directory-heading">
        <span class="eyebrow">${esc(cfg.eyebrow)}</span>
        <h1><span aria-hidden="true">${cfg.icon}</span> ${esc(cfg.title)}</h1>
        <p>${esc(cfg.description)}</p>
      </header>
      ${kind==='releases'?'<nav class="directory-switch" aria-label="Novel status"><a aria-current="page" href="./#/latest-releases">All novels</a><a href="./#/completed">Completed</a></nav>':''}
      ${results.length?`<div class="directory-novel-list">${results.map(directoryRow).join('')}</div>`:'<div class="empty"><h2>No novels here yet.</h2><p>More stories will appear here when they are available.</p></div>'}
    </section>
  </div>`;
}
function browse(params){const q=params.get('q')||'',genre=params.get('genre')||'All',status=params.get('status')||'All',sort=params.get('sort')||'latest';let results=novels.filter(n=>(genre==='All'||n.tags.includes(genre))&&(status==='All'||n.status===status)&&`${n.title} ${n.author} ${n.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));results.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title):(a,b)=>b.updated.localeCompare(a.updated));return `<section class="intro"><div><span class="eyebrow">Your next escape</span><h1>Browse novels</h1><p class="muted">Find a story that feels like your kind of world.</p></div>${searchForm(q)}</section>${chips(genre)}<div class="toolbar"><span class="muted">${results.length} ${results.length===1?'story':'stories'}${q?` matching “${esc(q)}”`:''}</span><div><label for="status" class="muted">Status </label><select id="status" data-filter="status"><option ${status==='All'?'selected':''}>All</option><option ${status==='Completed'?'selected':''}>Completed</option><option ${status==='Ongoing'?'selected':''}>Ongoing</option></select> <label for="sort" class="muted">Sort </label><select id="sort" data-filter="sort"><option value="latest" ${sort==='latest'?'selected':''}>Latest added</option><option value="title" ${sort==='title'?'selected':''}>Title A–Z</option></select></div></div>${results.length?`<div class="catalog-grid">${results.map(card).join('')}</div>`:`<div class="empty"><h2>No stories found</h2><p>Try a different title or genre, or clear your filters.</p><a class="button" href="./#/browse">Clear filters</a></div>`}<p class="sample-note">Sample stories can be read here. External reading links open the novel on the named website.</p>`}
function novelBreadcrumb(n,chapterNumber){
  const genre=String(n.genre||n.tags?.[0]||'Fiction');
  const homeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H15v-7H9v7H4.5A1.5 1.5 0 0 1 3 19.5Z"/></svg>';
  return `<nav class="breadcrumb novel-breadcrumb" aria-label="Breadcrumb"><a class="breadcrumb-home" href="./#/">${homeIcon}<span>Home</span></a><span class="breadcrumb-separator" aria-hidden="true">›</span><a href="./#/browse?genre=${encodeURIComponent(genre)}">${esc(genre)} Novels</a><span class="breadcrumb-separator" aria-hidden="true">›</span><a href="${bookUrl(n)}" ${chapterNumber?'':'aria-current="page"'}>${esc(n.title)}</a>${chapterNumber?`<span class="breadcrumb-separator" aria-hidden="true">›</span><span aria-current="page">Chapter ${chapterNumber}</span>`:''}</nav>`;
}
function detail(id){const n=novels.find(x=>x.id===id);if(!n)return missing();if(n.externalUrl)return externalDetail(n);const p=lastRead(n);return `${novelBreadcrumb(n)}<article class="detail">${image(n)}<div class="book-info"><span class="eyebrow">${n.tags.map(esc).join(' / ')}</span><h1>${esc(n.title)}</h1><p class="muted">by ${esc(n.author)}</p><span class="status-pill">${esc(n.status)}</span><p class="meta">${n.chapters.length} chapters · English · Licensed edition</p></div><div class="description" style="grid-column:1/-1"><h2>About the story</h2>${synopsisHtml(n)}<p class="meta">${esc(n.license?.note || "Licensed edition on NovelNest.")}</p></div><div class="actions" style="grid-column:1/-1"><a class="button" href="${chapterUrl(n,p?p.chapter:0)}">${p?'Continue reading':'Start reading'}</a><button class="button outline" data-save="${n.id}" aria-pressed="${saved.includes(n.id)}">${saved.includes(n.id)?'♥ Saved in library':'♡ Save to library'}</button></div></article><section><div class="section-head"><h2>Chapters <span class="muted">(${n.chapters.length})</span></h2><span class="meta">${n.status==='Completed'?'Complete story':'Ongoing · More chapters to come'}</span></div><div class="toc">${n.chapters.map((c,i)=>`<a href="${chapterUrl(n,i)}"><span>${String(i+1).padStart(2,'0')}</span>${esc(c.title)} ${p?.chapter===i?'<span>Last opened</span>':''}</a>`).join('')}</div></section>`}
function externalDetail(n){return `${novelBreadcrumb(n)}<article class="detail">${image(n)}<div class="book-info"><span class="eyebrow">${n.tags.map(esc).join(' / ')}</span><h1>${esc(n.title)}</h1><p class="muted">Credits on ${esc(n.externalSource)}: ${esc(n.author)}</p><span class="status-pill">${esc(n.status)}</span><p class="meta">External reading link</p></div><div class="description" style="grid-column:1/-1"><h2>About the story</h2>${synopsisHtml(n)}<p class="meta">This is a reading-list entry. Chapters are hosted on ${esc(n.externalSource)}, and opening the reading link takes you to that website.</p></div><div class="actions" style="grid-column:1/-1"><a class="button" href="${esc(n.externalUrl)}" target="_blank" rel="noopener noreferrer">Read on ${esc(n.externalSource)} <span class="meta external-tab-note">(new tab)</span></a><button class="button outline" data-save="${n.id}" aria-pressed="${saved.includes(n.id)}">${saved.includes(n.id)?'♥ Saved in library':'♡ Save to library'}</button></div></article>`}
function reader(id,number){const n=novels.find(x=>x.id===id),i=Number(number)-1;if(!n||!Number.isInteger(i)||i<0||i>=n.chapters.length)return missing();const c=n.chapters[i];progress[n.id]={chapter:i,at:Date.now()};persist('novelnest.progress',progress);return `<div class="reader-wrap">${novelBreadcrumb(n,i+1)}<div class="reader-tools"><div><label for="reader-theme">Appearance</label><select id="reader-theme"><option value="light" ${preferences.theme==='light'?'selected':''}>Light</option><option value="sepia" ${preferences.theme==='sepia'?'selected':''}>Sepia</option><option value="night" ${preferences.theme==='night'?'selected':''}>Night</option></select></div><div><button data-font="-2" aria-label="Decrease text size">A−</button><span id="font-size" class="meta">${preferences.size||20}px</span><button data-font="2" aria-label="Increase text size">A+</button></div><a class="text-link" href="${bookUrl(n)}">Chapters</a></div><article><div class="reader-heading"><span class="eyebrow">Chapter ${i+1} of ${n.chapters.length}</span><h1>${esc(c.title)}</h1><span class="meta">${esc(n.title)} · Licensed edition</span></div><div class="prose">${c.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}</div></article><div class="chapter-nav">${i>0?`<a class="button outline" href="${chapterUrl(n,i-1)}">Previous chapter</a>`:'<button class="button outline" disabled>Previous chapter</button>'}${i<n.chapters.length-1?`<a class="button" href="${chapterUrl(n,i+1)}">Next chapter</a>`:`<a class="button" href="${bookUrl(n)}">Back to novel</a>`}</div><div class="end-note">${i===n.chapters.length-1?(n.status==='Completed'?'The end. Thank you for reading.':'You’re caught up. More chapters will appear here when available.'):'Your last opened chapter is saved on this device.'}</div></div>`}
function library(params = new URLSearchParams()) {
  const history = params.get('tab') === 'history';
  const books = history ? novels.filter(n=>lastRead(n)).sort((a,b)=>lastRead(b).at-lastRead(a).at) : novels.filter(n=>saved.includes(n.id));
  const tabs = `<nav class="library-tabs" aria-label="Your library"><a href="./#/library" ${!history?'aria-current="page"':''}>Bookmarks <span>${saved.length}</span></a><a href="./#/library?tab=history" ${history?'aria-current="page"':''}>History</a></nav>`;
  const items = history ? `<div class="history-list">${books.map(n=>`<a class="history-row" href="${chapterUrl(n,lastRead(n).chapter)}">${image(n)}<div><h2>${esc(n.title)}</h2><p>Continue chapter ${lastRead(n).chapter+1}</p></div><span aria-hidden="true">›</span></a>`).join('')}</div>` : `<div class="catalog-grid">${books.map(card).join('')}</div>`;
  return `<section class="intro library-intro"><div><h1>My library</h1></div></section>${tabs}${!history?continueBox():''}${books.length?items:`<div class="empty"><h2>${history?'Your story starts here.':'A shelf waiting for stories.'}</h2><p>${history?'Chapters you open will appear here.':'Bookmark a novel to find it here and follow new chapters.'}</p><a class="button" href="./#/browse">Explore novels</a></div>`}`;
}
function missing(){return `<div class="empty"><h1>Page not found</h1><p>This story or chapter is not in the catalog.</p><a class="button" href="./#/browse">Browse novels</a></div>`}
function about(){return `<article class="about"><span class="eyebrow">A home for stories</span><h1>About NovelNest</h1><p>NovelNest is a place to discover novels and read them chapter by chapter. Browse by genre, save a story to your library, and choose the reading appearance that feels comfortable.</p><h2>Our current collection</h2><p>Our on-site stories are original demonstration stories, clearly marked as samples. Our catalog also includes external reading links, which take you to another website for the chapters. NovelNest has not imported novels or cover art from FreeWebNovel.</p><p>Book listings can be saved to your library whether they are on-site samples or external reads. Chapters may be added to NovelNest when the owner has the necessary publishing permission.</p><h2>Your reading data</h2><p>Bookmarks, reading preferences, and your last opened chapter are stored in your browser on this device. There is no account or cross-device sync. Clearing your browser data removes those saved settings.</p><h2>External services</h2><p>This site loads its display fonts from Google Fonts. Your browser may connect to that service when loading the page. If the font is unavailable, your device’s default font is used.</p></article>`}
function route(){window.dispatchEvent(new Event('novelnest:before-route'));let raw=location.hash.slice(1)||'/';let [path,query='']=raw.split('?');const parts=path.split('/').filter(Boolean),params=new URLSearchParams(query);applySettings();document.querySelector('#library-count').textContent=saved.length;document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===(parts[0]||'home');a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});let html,title='Find your next chapter';switch(parts[0]){case undefined:html=home();break;case 'browse':html=browse(params);title='Browse novels';break;case 'latest-releases':html=directoryPage('releases');title='Latest Release Novels';break;case 'latest-novels':html=directoryPage('novels');title='Latest Novels';break;case 'completed':html=directoryPage('completed');title='Completed Novels';break;case 'latest':html=`<section class="intro"><div><span class="eyebrow">Fresh from the shelf</span><h1>Latest chapters</h1><p class="muted">Every available chapter, with the latest additions first.</p></div></section><div class="chapter-list">${latestRows()}</div>`;title='Latest chapters';break;case 'novel':html=detail(parts[1]);title=novels.find(n=>n.id===parts[1])?.title||'Not found';break;case 'read':html=reader(parts[1],parts[2]);title=`${novels.find(n=>n.id===parts[1])?.title||'Not found'} · Chapter ${parts[2]}`;break;case 'library':html=library(params);title='My library';break;case 'about':html=about();title='About & content';break;default:html=missing();title='Not found'}main.innerHTML=html;document.title=`${title} — NovelNest`;window.scrollTo(0,0)}
main.addEventListener('submit',e=>{if(e.target.matches('.search-form')){e.preventDefault();location.hash='/browse?q='+encodeURIComponent(new FormData(e.target).get('q').trim())}});
main.addEventListener('click',e=>{const save=e.target.closest('[data-save]');if(save)toggleSave(save.dataset.save);const font=e.target.closest('[data-font]');if(font){preferences.size=Math.min(28,Math.max(16,(Number(preferences.size)||20)+Number(font.dataset.font)));persist('novelnest.preferences',preferences);applySettings();document.querySelector('#font-size').textContent=preferences.size+'px'}});
main.addEventListener('change',e=>{if(e.target.id==='reader-theme'){preferences.theme=e.target.value;persist('novelnest.preferences',preferences);applySettings()}if(e.target.dataset.filter){const p=new URLSearchParams(location.hash.split('?')[1]||'');p.set(e.target.dataset.filter,e.target.value);location.hash='/browse?'+p.toString()}});
window.addEventListener('hashchange',()=>{route();main.focus({preventScroll:true})});document.querySelector('#year').textContent=new Date().getFullYear();route();
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'search_novelnest_catalog',description:'Search the available NovelNest catalog without changing bookmarks.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input.query!=='string')throw new Error('query must be a string');return novels.filter(n=>`${n.title} ${n.author} ${n.tags.join(' ')}`.toLowerCase().includes(input.query.toLowerCase())).map(n=>({id:n.id,title:n.title,chapters:n.chapters.length,readingLocation:n.externalUrl?n.externalSource:"NovelNest",url:bookUrl(n)}))}})).catch(()=>{})}catch{}}

window.NovelNestApp = { reloadData() { saved=read("novelnest.saved",[]); progress=read("novelnest.progress",{}); document.querySelector("#library-count").textContent=saved.length; document.querySelectorAll("[data-save]").forEach(b=>{b.textContent=saved.includes(b.dataset.save)?"♥ Saved in library":"♡ Save to library";b.setAttribute("aria-pressed",String(saved.includes(b.dataset.save)))}); } };
