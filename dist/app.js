'use strict';
const novels=window.NOVELS;
// Keep curated stories accessible from direct links, history and bookmarks.
// Only discovery feeds, browse/search and public reading guides exclude them.
const publicNovels=novels.filter(n=>n.discoveryHidden!==true);
const chapterTitle=c=>window.NovelNestChapterLabels?.title(c?.title)||c?.title||'';
const main=document.querySelector('#main');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
let saved=read('novelnest.saved',[]); if(!Array.isArray(saved)) saved=[]; saved=[...new Set(saved.filter(id=>typeof id==='string'&&/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(id)&&!['__proto__','constructor','prototype'].includes(id)))];
let progress=read('novelnest.progress',{}); if(!progress||typeof progress!=='object'||Array.isArray(progress))progress={};
let preferences=read('novelnest.preferences',{}); if(!preferences||typeof preferences!=='object')preferences={};
let storageWarning=false;
let lastOpenedRoute='';
const LAST_READER_ROUTE='novelhaven.last-reader-route';
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));if(key!=='novelnest.preferences'&&key!=='novelnest.saved')window.NovelNestAccounts?.changed();return true}catch{if(!storageWarning){toast('Storage is unavailable. Your bookmark was not saved.');storageWarning=true}return false}}
function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200)}
function applySettings(){document.body.dataset.theme=['night','sepia'].includes(preferences.theme)?preferences.theme:'light';document.documentElement.style.setProperty('--reader-size',`${Math.min(28,Math.max(16,Number(preferences.size)||20))}px`)}
function toggleSave(id){
  if(!novels.some(n=>n.id===id))throw new Error('Unknown novel');
  // Read the latest device state before each tap. Another browser tab or an
  // account sync may have added books since this page was first opened.
  const latest=read('novelnest.saved',[]);
  if(Array.isArray(latest))saved=[...new Set(latest.filter(value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(value)&&!['__proto__','constructor','prototype'].includes(value)))];
  const original=saved.slice(), exists=saved.includes(id);
  const updated=exists?saved.filter(x=>x!==id):[...saved,id];
  if(!persist('novelnest.saved',updated)){saved=original;return {id,saved:exists};}
  saved=updated;
  window.NovelNestAccounts?.bookmarkAction?.(id,!exists);
  window.NovelNestAccounts?.changed?.();
  const count=document.querySelector('#library-count');if(count)count.textContent=saved.length;
  document.querySelectorAll('[data-save]').forEach(b=>{
    if(b.dataset.save===id){
      b.textContent=saved.includes(id)?'♥ Bookmarked':'♡ Bookmark';
      b.setAttribute('aria-pressed',String(saved.includes(id)));
    }
  });
  toast(exists?'Bookmark removed':'Bookmarked');
  return {id,saved:!exists};
}
const internalUrl=path=>`./#${path.startsWith('/')?path:'/'+path}`;
const bookUrl=n=>`/novel/${encodeURIComponent(n.id)}/`;
const isRemovedChapter=(n,i)=>n?.chapters?.[i]?.removedDuplicate===true;
function adjacentChapter(n,i,step=1){
  for(let index=i+step;index>=0&&index<n.chapters.length;index+=step){
    if(!isRemovedChapter(n,index))return index;
  }
  return -1;
}
const availableCount=n=>n.chapters.filter(c=>!c.removedDuplicate).length;
function readableChapter(n,i){
  if(!isRemovedChapter(n,i))return i;
  const next=adjacentChapter(n,i,1);
  return next>=0?next:adjacentChapter(n,i,-1);
}
const chapterUrl=(n,i)=>`/novel/${encodeURIComponent(n.id)}/chapter-${readableChapter(n,i)+1}/`;
const chapterPathMatch=pathname=>String(pathname||'').match(/^\/novel\/([^/]+)\/chapter-(\d+)\/?$/);
function navigate(url,replace=false){
  const u=new URL(url,location.href);
  const next=u.pathname+u.search+(u.hash.startsWith('#/')?'':u.hash);
  const current=location.pathname+location.search+(location.hash.startsWith('#/')?'':location.hash);
  if(next===current)return;
  // After an ad-tagged homepage, enter unreviewed novel and catalog pages
  // with one full load into their ad-free shell. Keep subsequent navigation
  // fast within those pages; never carry homepage ad code onto them.
  const goingToNovel=/^\/novel\/[^/]+\/(?:chapter-\d+\/?)?$/.test(u.pathname);
  const goingToUnreviewedCatalog=/^\/(?:browse|latest-releases|latest-novels|completed|finder|library)(?:\/|$)/.test(u.pathname)||
    /^\/genre\/[^/]+\/?$/.test(u.pathname);
  const publisherScript=document.querySelector?.('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
  if((goingToNovel||goingToUnreviewedCatalog)&&publisherScript?.tagName==='SCRIPT'){
    if(replace&&typeof location.replace==='function')location.replace(next);
    else location.href=next;
    return;
  }
  if(window.history?.pushState){
    window.history[replace?'replaceState':'pushState'](null,'',next);
    route({animate:false});main.focus({preventScroll:true});return;
  }
  location.href=next;
}
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
const image=n=>n.externalUrl?`<div class="cover external-cover" aria-hidden="true"><span>EXTERNAL<br>READ</span><strong>G</strong><span>NovelHaven<br>Reading list</span></div>`:`<img class="cover" src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy" width="200" height="300">`;
const genres=[...new Set(publicNovels.flatMap(n=>n.tags))].sort();
function searchForm(value=''){return `<form class="search-form" role="search"><span aria-hidden="true">⌕</span><input name="q" aria-label="Search novels by title or author" placeholder="Search titles, authors, genres…" value="${esc(value)}"><button aria-label="Search" type="submit">Search</button></form>`}
function chips(selected='All'){return `<div class="chips" aria-label="Filter by genre">${['All',...genres].map(g=>`<a class="chip ${selected===g?'selected':''}" ${selected===g?'aria-current="true"':''} href="./#/browse${g==='All'?'':'?genre='+encodeURIComponent(g)}">${g}</a>`).join('')}</div>`}
function card(n){return `<a class="book-card" href="${bookUrl(n)}">${image(n)}<div><span class="tag">${esc(n.genre)}</span><h3>${esc(n.title)}</h3><p>${esc(n.author)}</p><p>${n.externalUrl?"Read on "+esc(n.externalSource):availableCount(n)+" chapters"} · ${esc(n.status)}</p><span class="meta">${n.externalUrl?"External reading link":"NovelHaven reader"}</span></div></a>`}
function lastRead(n){
  // A different tab or account sync can update the last-opened chapter.
  // Never trust a reader tab's old in-memory progress for Continue Reading.
  const current=read('novelnest.progress',{});
  const p=current&&typeof current==='object'?current[n.id]:null;
  if(!p||!Number.isInteger(p.chapter)||p.chapter<0||p.chapter>=n.chapters.length)return null;
  const available=readableChapter(n,p.chapter);
  return available>=0?{...p,chapter:available}:null;
}
function latestRows(limit=9){return publicNovels.flatMap(n=>n.chapters.map((c,i)=>({n,c,i})).filter(({c})=>!c.removedDuplicate)).sort((a,b)=>b.n.updated.localeCompare(a.n.updated)||b.i-a.i).slice(0,limit).map(({n,c,i})=>`<a class="chapter-row" href="${chapterUrl(n,i)}">${image(n)}<div><strong>${esc(n.title)}</strong><p>${esc(chapterTitle(c))}</p></div></a>`).join('')}
function continueBox(){const recent=novels.filter(n=>lastRead(n)).sort((a,b)=>(lastRead(b).at||0)-(lastRead(a).at||0))[0];return recent?`<section class="continue-box"><div><span class="eyebrow">Continue reading</span><p><strong>${esc(recent.title)}</strong> · Chapter ${lastRead(recent).chapter+1}</p></div><a class="button" href="${chapterUrl(recent,lastRead(recent).chapter)}">Continue</a></section>`:''}
// Publication times are only displayed when the source supplies a verified
// timestamp for the exact chapter. Polling/import times are not publication times.
function sourcePublicationTime(n){
  const published=String(n.sourcePublishedAt||'').trim();
  const number=Number(n.sourcePublishedChapter);
  const valid=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(published)&&Number.isFinite(Date.parse(published));
  return valid&&number===Number(n.sourceReleaseNumber)&&n.sourcePublishedVerified===true?published:'';
}
// FreeWebNovel sometimes reports the latest chapter's age on its own page.
// A source-reported relative age is approximate; it is never an import time.
function sourceActivityTime(n){
  const observed=Date.parse(n.sourceActivityObservedAt||'');
  const age=Number(n.sourceActivityAgeSeconds),number=Number(n.sourceActivityChapter);
  if(n.sourceActivityVerified!==true||n.sourceActivityIsOngoing!==true||
     !Number.isFinite(observed)||!Number.isInteger(age)||age<0||
     !Number.isInteger(number)||number<1)return NaN;
  return observed-age*1000;
}
function releaseSortTime(n){
  const src=sourceActivityTime(n);
  if(Number.isFinite(src))return src;
  return Date.parse(sourcePublicationTime(n)||n.sourceReleaseAt||'');
}
// Render compact relative ages. The tooltip retains the provenance so
// source-reported, verified-published, and first-seen times are not confused.
function compactReleaseAge(timestamp,now=Date.now()){
  const age=Math.max(0,Number(now)-timestamp);
  if(age<60000)return 'Just now';
  if(age<3600000){const m=Math.floor(age/60000);return m+' min'+(m===1?'':'s')+' ago';}
  if(age<86400000){const h=Math.floor(age/3600000);return h+' hour'+(h===1?'':'s')+' ago';}
  const d=Math.floor(age/86400000);
  return d===1?'Yesterday':d+' days ago';
}
function releaseTimeLabel(n,now=Date.now()){
  const sourceAt=sourceActivityTime(n);
  if(Number.isFinite(sourceAt)){
    return {label:compactReleaseAge(sourceAt,now),dateTime:'',
      full:'Approximate age reported by the original source page, observed '+n.sourceActivityObservedAt+'. Original publication timestamp was not supplied.'};
  }
  const exact=sourcePublicationTime(n);
  if(exact){
    return {label:compactReleaseAge(Date.parse(exact),now),dateTime:exact,
      full:'Verified original source publication: '+exact};
  }
  const detected=String(n.sourceReleaseAt||'').trim();
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(detected)&&Number.isFinite(Date.parse(detected))){
    return {label:compactReleaseAge(Date.parse(detected),now),dateTime:detected,
      full:'NovelHaven first detected source chapter growth at '+detected+'. Original publication time unavailable.'};
  }
  return {label:'Time unavailable',dateTime:'',full:'Original publication time unavailable'};
}
function homeReleaseRow(n){
  const src=sourceActivityTime(n);
  const number=Number.isFinite(src)?Number(n.sourceActivityChapter):Number(n.sourceReleaseNumber)||0;
  const available=number>0&&number<=n.chapters.length&&!isRemovedChapter(n,number-1);
  const i=available?number-1:Math.max(0,n.chapters.length-1),c=available?n.chapters[i]:null;
  const newest=(Number.isFinite(src)?String(n.sourceActivityTitle||'').trim():'')||
    String(n.sourceReleaseTitle||'').trim()||chapterTitle(c)||('Chapter '+number);
  const href=available?chapterUrl(n,i):bookUrl(n);
  const time=releaseTimeLabel(n);
  const when=time.dateTime?`<time class="home-release-time" datetime="${esc(time.dateTime)}" title="${esc(time.full)}">${esc(time.label)}</time>`:`<span class="home-release-time" title="${esc(time.full)}">${esc(time.label)}</span>`;
  return `<a class="home-release-row" href="${href}">
    <img class="home-release-cover" src="${esc(n.cover)}" alt="" loading="lazy">
    <span class="home-release-copy">
      <strong>${esc(n.title)}</strong>
      <span class="home-release-details">
        <small class="home-release-genres">${esc(n.tags.slice(0,2).join(', ')||n.genre)}</small>
        <span class="home-release-chapter">${esc(newest)}${available?'':' · Syncing chapter to NovelHaven'}</span>
        ${when}
      </span>
    </span>
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
      <b class="home-chapter-badge">${availableCount(n)} Chapters</b>
    </span>
  </a>`;
}
// Genuine releases are SOURCE chapter-tip increases compared with prior
// observations. Uploading old chapters or changing an import date never counts.
const RELEASE_DAYS=5;
function latestOngoingReleases(all,now=Date.now()){
  const clock=Number(now);
  return all.filter(n=>{
    if(n.externalUrl||!n.chapters?.length)return false;
    const src=sourceActivityTime(n);
    const sourceRecent=n.sourceActivityIsOngoing===true&&Number.isFinite(src)&&src<=clock+60000&&clock-src<RELEASE_DAYS*86400000;
    const detected=Date.parse(n.sourceReleaseAt||'');
    const number=Number(n.sourceReleaseNumber);
    const observedRecent=n.sourceIsOngoing===true&&Number.isInteger(number)&&number>0&&
      Number.isFinite(detected)&&detected<=clock+60000&&clock-detected<RELEASE_DAYS*86400000;
    return sourceRecent||observedRecent;
  }).sort((a,b)=>releaseSortTime(b)-releaseSortTime(a)||
    Number(b.sourceActivityChapter||b.sourceReleaseNumber)-Number(a.sourceActivityChapter||a.sourceReleaseNumber)||
    a.title.localeCompare(b.title));
}
function shuffledNovels(items){
  const result=[...items];
  for(let i=result.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
// Shuffle the featured area on every page load, without source-based labels.
// Within the same tab, avoid repeating the previous seven highlighted books
// whenever the catalog has enough alternatives.
function featuredNovels(sorted){
  const candidates=shuffledNovels(sorted.filter(n=>n.chapters?.length&&!n.externalUrl&&n.cover));
  let previouslyShown=[];
  try{
    const stored=JSON.parse(window.sessionStorage?.getItem('novelhaven.previousFeatured')||'[]');
    if(Array.isArray(stored))previouslyShown=stored;
  }catch{}
  const previous=new Set(previouslyShown);
  const reordered=[...candidates.filter(n=>!previous.has(n.id)),...candidates.filter(n=>previous.has(n.id))];
  try{window.sessionStorage?.setItem('novelhaven.previousFeatured',JSON.stringify(reordered.slice(0,7).map(n=>n.id)))}catch{}
  return reordered;
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
    <span class="home-top-badge">${availableCount(n)} Chapters</span>
  </a>`;
}
function homeTopRow(n){
  return `<a class="home-top-row" href="${bookUrl(n)}">
    <img src="${esc(n.cover)}" alt="${esc(n.title)} cover" loading="lazy">
    <span class="home-top-row-copy">
      <strong>${esc(n.title)}</strong>
      <small>◉ English Novel</small>
      <small>▤ ${esc(n.tags.slice(0,2).join(', ')||n.genre)}</small>
      <b>${availableCount(n)} Chapters</b>
    </span>
  </a>`;
}
function home(){
  const sorted=[...publicNovels].sort((a,b)=>b.updated.localeCompare(a.updated)||b.chapters.length-a.chapters.length);
  const featured=featuredNovels(sorted);
  const topFeatures=featured.slice(0,4);
  const topRows=featured.slice(4,7);
  // Recent releases must remain chronological, unlike the discovery cards.
  const releases=latestOngoingReleases(publicNovels);
  // Latest Novels is a truthful, chronological source-release feed.
  // Do not hide genuine updates just because Featured already shows that book,
  // randomly shuffle release dates, or fill empty slots with old imports.
  const latestNovels=releases.filter(n=>n.chapters?.length&&!n.externalUrl);
  const displayed=new Set([...topFeatures,...topRows,...latestNovels].map(n=>n.id));
  const completed=shuffledNovels(sorted.filter(n=>n.status==='Completed'&&n.chapters?.length&&!n.externalUrl&&!displayed.has(n.id))).slice(0,6);
  return `<div class="home-feed">
    <section class="home-showcase" aria-label="Featured novels">
      <div class="home-top-grid">${topFeatures.map(homeTopFeature).join('')}</div>
      <div class="home-top-list">${topRows.map(homeTopRow).join('')}</div>
    </section>
    <section class="home-feed-section home-release-section">
      <div class="home-feed-head"><h1><span aria-hidden="true">↻</span> Latest Release Novels</h1><a href="./#/latest-releases">See more</a></div>
      ${releases.length?'<div class="home-release-list">'+releases.map(homeReleaseRow).join('')+'</div>':'<p class="home-empty">No verified new source chapters yet. Importing older chapters does not count as a new release.</p>'}
    </section>
    <section class="home-feed-section">
      <div class="home-feed-head"><h2><span aria-hidden="true">↻</span> Latest Novels</h2><a href="./#/latest-novels">See more</a></div>
      ${latestNovels.length?`<div class="home-cover-grid">${latestNovels.map(homeNovelTile).join('')}</div>`:'<p class="home-empty">No verified new source chapters yet.</p>'}
    </section>
    <section class="home-feed-section">
      <div class="home-feed-head"><h2><span aria-hidden="true">✓</span> Completed Novels</h2><a href="./#/completed">See more</a></div>
      ${completed.length?`<div class="home-cover-grid">${completed.map(homeNovelTile).join('')}</div>`:'<p class="home-empty">No completed novels yet.</p>'}
    </section>
    <section class="home-author-invite" aria-labelledby="original-author-title">
      <div><span class="home-author-kicker">✦ NOVELHAVEN · THE WRITERS’ CORNER</span>
        <h2 id="original-author-title">Your story could be their next favorite.</h2>
        <p>Build a world. Bring characters to life. Write your original novel, save each chapter and submit it for editorial review. Your copyright stays yours.</p></div>
      <div class="home-author-actions"><a class="button" href="/author-studio.html?compose=1">Start my novel ↗</a>
        <a class="button outline" href="/original-novels.html">Browse original novels</a></div>
    </section>
    <section class="home-feed-section editorial-home-section" aria-labelledby="reading-desk-title">
      <div class="home-feed-head"><h2 id="reading-desk-title"><span aria-hidden="true">✦</span> NovelHaven Reading Desk</h2><a href="/reading-desk.html">See all</a></div>
      <p class="editorial-home-intro">Original guides and recommendations written for NovelHaven readers — made to help you choose what to read next, understand popular web-novel genres, and decide between ongoing and completed stories.</p>
      <div class="editorial-card-grid">
        ${editorialCard('choosing-a-long-web-novel','How to choose a long web novel without burning out','A practical guide to chapter counts, pacing, reading goals, and when to take a break.')}
        ${editorialCard('ongoing-vs-completed','Ongoing or completed: which reading style fits you?','The trade-offs between following new releases and binge-reading a story that already has an ending.')}
        ${editorialCard('genre-guide','A simple guide to NovelHaven genres','What System, Cultivation, Fantasy, Romance, Reincarnation and related tags usually signal to a reader.')}
      </div>
    </section>
  </div>`;
}
function editorialCard(slug,title,summary){
  const pages = {'choosing-a-long-web-novel':'guide-long-web-novel.html','ongoing-vs-completed':'guide-ongoing-vs-completed.html','genre-guide':'guide-genres.html'};
  const href = pages[slug] ? '/' + pages[slug] : './#/editorial/' + encodeURIComponent(slug);
  return `<a class="editorial-card" href="${href}">
    <span class="editorial-kicker">Original NovelHaven guide</span>
    <strong>${esc(title)}</strong>
    <p>${esc(summary)}</p>
    <span class="editorial-read-link">Read guide →</span>
  </a>`;
}
const EDITORIALS={
  'choosing-a-long-web-novel':{
    title:'How to choose a long web novel without burning out',
    dek:'A long chapter count can be exciting, but it helps to know what kind of reading commitment you actually want.',
    body:`
      <p>Web novels can range from a few dozen chapters to several thousand. A huge number is not automatically better or worse; it simply creates a different kind of reading experience. Before starting, decide whether you want a short burst of entertainment, a medium-length story you can finish in a few weeks, or a world you can return to for months.</p>
      <h2>Start with the reading rhythm, not the number</h2>
      <p>If you usually read in short sessions, a long-running novel can work well because there is always another chapter waiting. If you prefer finishing one story before moving to the next, a completed novel may feel more satisfying. The important part is matching the story to your routine instead of choosing only by popularity or chapter count.</p>
      <h2>Use the first chapters as a test</h2>
      <p>Give a new story enough time to establish its main character, conflict, and tone, but do not force yourself through hundreds of chapters just because the novel is long. After the opening arc, ask whether you are still curious about the next problem the characters will face. Curiosity is a better signal than completion pressure.</p>
      <h2>Break very long stories into arcs</h2>
      <p>Instead of treating a 2,000-chapter novel as one enormous task, read it as a series of smaller arcs. When an arc ends, switch to another genre for a while. Returning after a break often makes a long story feel fresh again and helps prevent repetitive reading from becoming tiring.</p>
      <h2>Use NovelHaven tools to reduce friction</h2>
      <p>Bookmark stories you genuinely plan to continue, use reading history to return to your last chapter, and browse by genre when you want a change of mood. A smaller personal library is usually more useful than saving every interesting title you see.</p>
      <p class="editorial-note"><strong>NovelHaven tip:</strong> If you are unsure where to start, compare <a href="./#/completed">completed novels</a> with the <a href="./#/latest-releases">latest ongoing releases</a> before choosing.</p>
    `
  },
  'ongoing-vs-completed':{
    title:'Ongoing or completed: which reading style fits you?',
    dek:'Both can be enjoyable, but they reward different reading habits.',
    body:`
      <p>An ongoing novel turns reading into a routine. You catch up, wait for new chapters, and experience the story in smaller pieces. A completed novel gives you control over the pace because the ending is already available. Neither format is automatically better; the best choice depends on what you enjoy about reading.</p>
      <h2>Choose ongoing when you like anticipation</h2>
      <p>Ongoing stories work well for readers who enjoy following a world over time. New chapters can become something to check during breaks, and a slower pace gives you time to think about characters and possible outcomes. The downside is uncertainty: release schedules can change, and a story may still be far from its ending.</p>
      <h2>Choose completed when you like momentum</h2>
      <p>Completed stories are better for readers who dislike waiting or forgetting details between updates. You can read several chapters in one sitting and know that the full story is available. They are also easier to plan around when you want a clear beginning-to-end reading project.</p>
      <h2>Mix both for a healthier library</h2>
      <p>A useful approach is to keep one or two ongoing novels in your bookmarks while reading a completed story in between updates. That gives you the excitement of new releases without leaving your entire reading list dependent on update schedules.</p>
      <p class="editorial-note"><strong>Try it:</strong> Browse <a href="./#/completed">completed novels</a> for binge reading, then visit <a href="./#/latest-releases">latest releases</a> for stories that are still growing.</p>
    `
  },
  'genre-guide':{
    title:'A simple guide to common NovelHaven genres',
    dek:'Genre tags are shortcuts. They tell you what kind of experience a story is likely to emphasize, but many novels mix several tags together.',
    body:`
      <p><strong>Fantasy</strong> is the broadest label in the catalog. It usually points to worlds with magic, supernatural rules, unusual creatures, or powers that do not exist in ordinary life. Fantasy often overlaps with Action, Adventure, Romance, and Reincarnation.</p>
      <p><strong>Cultivation</strong> stories usually focus on characters improving their bodies, energy, skills, or spiritual power through structured stages. Progress is a major part of the appeal, so readers who enjoy training arcs and visible growth often gravitate toward this tag.</p>
      <p><strong>System</strong> novels give the protagonist some form of structured interface, reward mechanism, mission list, statistics, or progression rules. The system can be central to the plot or simply a tool that pushes the character toward new goals.</p>
      <p><strong>Reincarnation</strong> commonly begins with a second life, rebirth, or transfer into another body or world. These stories often use memories from a previous life to create an advantage, a mystery, or a chance to make different choices.</p>
      <p><strong>Romance</strong> highlights emotional and relationship development. It can be the main plot or a major subplot inside Fantasy, Drama, Historical, or Action stories. If you want relationship-focused reading, combine Romance with another genre that matches the setting you enjoy.</p>
      <p><strong>Action and Adventure</strong> emphasize movement, conflict, exploration, danger, or quests. They are useful tags when you want a faster pace and frequent changes of setting or challenge.</p>
      <p class="editorial-note"><strong>Browse by mood:</strong> Use the <a href="./#/finder">Novel Finder</a> to combine genres instead of relying on a single tag.</p>
    `
  }
};
function readingDesk(){
  return `<div class="policy-page editorial-index">
    <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">Reading Desk</span></nav>
    <header class="policy-hero"><span class="eyebrow">Original NovelHaven content</span><h1>NovelHaven Reading Desk</h1><p>Practical reading guides, genre explainers, and recommendations created for NovelHaven readers.</p></header>
    <div class="editorial-card-grid editorial-index-grid">
      ${Object.entries(EDITORIALS).map(([slug,item])=>editorialCard(slug,item.title,item.dek)).join('')}
    </div>
  </div>`;
}
function editorial(slug){
  const item=EDITORIALS[slug];
  if(!item)return missing();
  return `<article class="policy-page editorial-article">
    <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><a href="/reading-desk.html">Reading Desk</a><span aria-hidden="true">›</span><span aria-current="page">${esc(item.title)}</span></nav>
    <header class="policy-hero"><span class="eyebrow">Original NovelHaven guide</span><h1>${esc(item.title)}</h1><p>${esc(item.dek)}</p></header>
    <div class="policy-copy">${item.body}</div>
  </article>`;
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
        <b class="directory-chapter-badge">${availableCount(n)} Chapters</b>
      </span>
    </span>
  </a>`;
}
function directoryPage(kind){
  const settings={
    releases:{title:'Latest Novels',icon:'↻',eyebrow:'',description:''},
    novels:{title:'Latest Novels',icon:'↻',eyebrow:'New on NovelHaven',description:'Browse the latest novels available in the NovelHaven catalog.'},
    completed:{title:'Completed Novels',icon:'✓',eyebrow:'',description:''}
  };
  const cfg=settings[kind]||settings.novels;
  const simple=kind==='releases'||kind==='completed';
  let results=[...publicNovels];
  if(kind==='releases') results=latestOngoingReleases(publicNovels);
  else if(kind==='completed') results=results.filter(n=>n.status==='Completed');
  if(kind==='novels') results=latestOngoingReleases(publicNovels);
  else if(kind!=='releases') results.sort((a,b)=>b.updated.localeCompare(a.updated)||b.chapters.length-a.chapters.length);
  return `<div class="directory-page">
    <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">${esc(cfg.title)}</span></nav>
    <section class="directory-shell">
      ${simple?`<h1 class="directory-visually-hidden">${esc(cfg.title)}</h1>`:`<header class="directory-heading"><span class="eyebrow">${esc(cfg.eyebrow)}</span><h1><span aria-hidden="true">${cfg.icon}</span> ${esc(cfg.title)}</h1><p>${esc(cfg.description)}</p></header>`}
      ${simple?`<nav class="directory-switch" aria-label="Novel status"><a href="./#/latest-releases"${kind==='releases'?' aria-current="page"':''}>Latest Novels</a><a href="./#/completed"${kind==='completed'?' aria-current="page"':''}>Completed Novels</a></nav>`:''}
      ${results.length?`<div class="directory-novel-list">${(kind==='releases'?results.map(homeReleaseRow):results.map(directoryRow)).join('')}</div>`:'<div class="empty"><h2>No novels available.</h2></div>'}
    </section>
  </div>`;
}
function genreDirectory(name,params=new URLSearchParams()){
  const genre=decodeURIComponent(name||'').trim();
  if(!genre||!genres.includes(genre)) return missing();
  const completed=params.get('status')==='Completed';
  const sort=params.get('sort')||'latest';
  let results=publicNovels.filter(n=>n.tags.includes(genre)&&(completed?n.status==='Completed':true));
  if(sort==='title') results.sort((a,b)=>a.title.localeCompare(b.title));
  else if(sort==='chapters') results.sort((a,b)=>b.chapters.length-a.chapters.length||b.updated.localeCompare(a.updated));
  else results.sort((a,b)=>b.updated.localeCompare(a.updated)||b.chapters.length-a.chapters.length);
  return `<div class="directory-page genre-directory-page">
    <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">${esc(genre)} Novels</span></nav>
    <section class="directory-shell">
      <header class="genre-directory-heading">
        <h1><span aria-hidden="true">▦</span> ${esc(genre.toUpperCase())} NOVELS</h1>
        <a class="genre-completed-toggle ${completed?'active':''}" href="./#/genre/${encodeURIComponent(genre)}${completed?'':'?status=Completed'}"><span aria-hidden="true">${completed?'☑':'□'}</span> COMPLETED</a>
      </header>
      <div class="genre-sort-row">
        <span><strong>${results.length}</strong> ${results.length===1?'novel':'novels'}</span>
        <label>Sort
          <select data-genre-sort="${esc(genre)}">
            <option value="latest" ${sort==='latest'?'selected':''}>Latest updated</option>
            <option value="title" ${sort==='title'?'selected':''}>Title A–Z</option>
            <option value="chapters" ${sort==='chapters'?'selected':''}>Most chapters</option>
          </select>
        </label>
      </div>
      ${results.length?`<div class="directory-novel-list">${results.map(directoryRow).join('')}</div>`:`<div class="empty"><h2>No ${esc(genre)} novels found</h2><p>Try showing all ${esc(genre)} novels instead.</p><a class="button" href="./#/genre/${encodeURIComponent(genre)}">Show all</a></div>`}
    </section>
  </div>`;
}
function finderPage(params=new URLSearchParams()){
  const selected=params.getAll('genre').filter(g=>genres.includes(g));
  const match=params.get('match')==='all'?'all':'any';
  const status=params.get('status')||'All';
  const chapters=params.get('chapters')||'All';
  const sort=params.get('sort')||'latest';
  const q=(params.get('q')||'').trim();
  const threshold=chapters==='100+'?100:chapters==='500+'?500:chapters==='1000+'?1000:chapters==='2000+'?2000:0;
  let results=publicNovels.filter(n=>{
    const genreMatch=!selected.length||(match==='all'?selected.every(g=>n.tags.includes(g)):selected.some(g=>n.tags.includes(g)));
    const statusMatch=status==='All'||n.status===status;
    const chapterMatch=!threshold||n.chapters.length>=threshold;
    const textMatch=!q||`${n.title} ${n.author} ${n.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase());
    return genreMatch&&statusMatch&&chapterMatch&&textMatch;
  });
  if(sort==='title') results.sort((a,b)=>a.title.localeCompare(b.title));
  else if(sort==='chapters') results.sort((a,b)=>b.chapters.length-a.chapters.length||b.updated.localeCompare(a.updated));
  else results.sort((a,b)=>b.updated.localeCompare(a.updated)||b.chapters.length-a.chapters.length);
  return `<div class="finder-page">
    <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">Novel Finder</span></nav>
    <header class="finder-heading"><h1><span aria-hidden="true">▽</span> NOVEL FINDER</h1><p>Choose the filters you want, then apply them to the NovelHaven catalog.</p></header>
    <form class="finder-form">
      <section class="finder-section">
        <h2>⌕ Search</h2>
        <input type="search" name="q" value="${esc(q)}" placeholder="Title, author, or genre">
      </section>
      <section class="finder-section">
        <div class="finder-section-title"><h2>▦ Genres</h2><label>Match <select name="match"><option value="any" ${match==='any'?'selected':''}>Any selected</option><option value="all" ${match==='all'?'selected':''}>All selected</option></select></label></div>
        <div class="finder-check-grid">${genres.map(g=>`<label><input type="checkbox" name="genre" value="${esc(g)}" ${selected.includes(g)?'checked':''}> <span>${esc(g)}</span></label>`).join('')}</div>
      </section>
      <section class="finder-section finder-select-grid">
        <label><strong>Chapters</strong><select name="chapters"><option ${chapters==='All'?'selected':''}>All</option><option value="100+" ${chapters==='100+'?'selected':''}>100+</option><option value="500+" ${chapters==='500+'?'selected':''}>500+</option><option value="1000+" ${chapters==='1000+'?'selected':''}>1000+</option><option value="2000+" ${chapters==='2000+'?'selected':''}>2000+</option></select></label>
        <label><strong>Status</strong><select name="status"><option ${status==='All'?'selected':''}>All</option><option ${status==='Ongoing'?'selected':''}>Ongoing</option><option ${status==='Completed'?'selected':''}>Completed</option></select></label>
        <label><strong>Sort Results</strong><select name="sort"><option value="latest" ${sort==='latest'?'selected':''}>Latest Updated</option><option value="title" ${sort==='title'?'selected':''}>Title A–Z</option><option value="chapters" ${sort==='chapters'?'selected':''}>Most Chapters</option></select></label>
      </section>
      <div class="finder-actions"><a class="button outline" href="./#/finder">↻ Reset</a><button class="button" type="submit">▽ Apply Filters</button></div>
    </form>
    <section class="finder-results"><div class="finder-results-head"><h2>▣ FILTER RESULTS</h2><span>${results.length} ${results.length===1?'novel':'novels'}</span></div>${results.length?`<div class="directory-novel-list">${results.map(directoryRow).join('')}</div>`:`<div class="empty"><h2>No novels found</h2><p>Try removing one or more filters.</p></div>`}</section>
  </div>`;
}

function browse(params){const q=params.get('q')||'',genre=params.get('genre')||'All',status=params.get('status')||'All',sort=params.get('sort')||'latest';let results=publicNovels.filter(n=>(genre==='All'||n.tags.includes(genre))&&(status==='All'||n.status===status)&&`${n.title} ${n.author} ${n.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));results.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title):(a,b)=>b.updated.localeCompare(a.updated));return `<section class="intro"><div><span class="eyebrow">Your next escape</span><h1>Browse novels</h1><p class="muted">Find a story that feels like your kind of world.</p></div>${searchForm(q)}</section>${chips(genre)}<div class="toolbar"><span class="muted">${results.length} ${results.length===1?'story':'stories'}${q?` matching “${esc(q)}”`:''}</span><div><label for="status" class="muted">Status </label><select id="status" data-filter="status"><option ${status==='All'?'selected':''}>All</option><option ${status==='Completed'?'selected':''}>Completed</option><option ${status==='Ongoing'?'selected':''}>Ongoing</option></select> <label for="sort" class="muted">Sort </label><select id="sort" data-filter="sort"><option value="latest" ${sort==='latest'?'selected':''}>Latest added</option><option value="title" ${sort==='title'?'selected':''}>Title A–Z</option></select></div></div>${results.length?`<div class="catalog-grid">${results.map(card).join('')}</div>`:`<div class="empty"><h2>No stories found</h2><p>Try a different title or genre, or clear your filters.</p><a class="button" href="./#/browse">Clear filters</a></div>`}<p class="sample-note">Sample stories can be read here. External reading links open the novel on the named website.</p>`}
function novelBreadcrumb(n,chapterNumber){
  const genre=String(n.genre||n.tags?.[0]||'Fiction');
  const homeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H15v-7H9v7H4.5A1.5 1.5 0 0 1 3 19.5Z"/></svg>';
  return `<nav class="breadcrumb novel-breadcrumb" aria-label="Breadcrumb"><a class="breadcrumb-home" href="./#/">${homeIcon}<span>Home</span></a><span class="breadcrumb-separator" aria-hidden="true">›</span><a href="./#/genre/${encodeURIComponent(genre)}">${esc(genre)} Novels</a><span class="breadcrumb-separator" aria-hidden="true">›</span><a href="${bookUrl(n)}" ${chapterNumber?'':'aria-current="page"'}>${esc(n.title)}</a>${chapterNumber?`<span class="breadcrumb-separator" aria-hidden="true">›</span><span aria-current="page">Chapter ${chapterNumber}</span>`:''}</nav>`;
}
function detail(id){
  const n=novels.find(x=>x.id===id);
  if(!n)return missing();
  if(n.externalUrl)return externalDetail(n);
  const p=lastRead(n),first=readableChapter(n,0),count=availableCount(n);
  return `${novelBreadcrumb(n)}<article class="detail">${image(n)}<div class="book-info"><span class="eyebrow">${n.tags.map(esc).join(' / ')}</span><h1>${esc(n.title)}</h1><p class="muted">by ${esc(n.author)}</p><span class="status-pill">${esc(n.status)}</span><p class="meta">${count} chapters · English · NovelHaven reader</p></div><div class="description" style="grid-column:1/-1"><h2>About the story</h2>${synopsisHtml(n)}</div><div class="actions" style="grid-column:1/-1"><a class="button" href="${chapterUrl(n,p?p.chapter:first)}">${p?'Continue reading':'Start reading'}</a><button class="button outline" data-save="${n.id}" aria-pressed="${saved.includes(n.id)}">${saved.includes(n.id)?'♥ Bookmarked':'♡ Bookmark'}</button></div></article><section><div class="section-head"><h2>Chapters <span class="muted">(${count})</span></h2><span class="meta">${n.status==='Completed'?'Complete story':'Ongoing · More chapters to come'}</span></div><div class="toc">${n.chapters.map((c,i)=>c.removedDuplicate?'':`<a href="${chapterUrl(n,i)}"><span>${window.NovelNestChapterLabels?.number(c,i+1)||String(i+1).padStart(2,'0')}</span>${esc(chapterTitle(c))} ${p?.chapter===i?'<span>Last opened</span>':''}</a>`).join('')}</div></section>`;
}
function externalDetail(n){return `${novelBreadcrumb(n)}<article class="detail">${image(n)}<div class="book-info"><span class="eyebrow">${n.tags.map(esc).join(' / ')}</span><h1>${esc(n.title)}</h1><p class="muted">Credits on ${esc(n.externalSource)}: ${esc(n.author)}</p><span class="status-pill">${esc(n.status)}</span><p class="meta">External reading link</p></div><div class="description" style="grid-column:1/-1"><h2>About the story</h2>${synopsisHtml(n)}<p class="meta">This is a reading-list entry. Chapters are hosted on ${esc(n.externalSource)}, and opening the reading link takes you to that website.</p></div><div class="actions" style="grid-column:1/-1"><a class="button" href="${esc(n.externalUrl)}" target="_blank" rel="noopener noreferrer">Read on ${esc(n.externalSource)} <span class="meta external-tab-note">(new tab)</span></a><button class="button outline" data-save="${n.id}" aria-pressed="${saved.includes(n.id)}">${saved.includes(n.id)?'♥ Bookmarked':'♡ Bookmark'}</button></div></article>`}
function reader(id,number){
  const n=novels.find(x=>x.id===id),i=Number(number)-1;
  if(!n||!Number.isInteger(i)||i<0||i>=n.chapters.length)return missing();
  const c=n.chapters[i],previous=adjacentChapter(n,i,-1),next=adjacentChapter(n,i,1);
  if(c.removedDuplicate){
    // Deleted chapter numbers are kept as addressable tombstones so old links
    // explain the deletion and provide a safe path to the real next chapter.
    return `<div class="reader-wrap"><article class="empty"><h1>Duplicate chapter removed</h1><p>Chapter ${i+1} was a repeated copy and has been deleted from NovelHaven.</p><div class="chapter-nav">${previous>=0?`<a class="button outline" href="${chapterUrl(n,previous)}">Previous chapter</a>`:''}${next>=0?`<a class="button" href="${chapterUrl(n,next)}">Continue to Chapter ${next+1}</a>`:`<a class="button" href="${bookUrl(n)}">Back to chapters</a>`}</div></article></div>`;
  }
  const readerRoute=n.id+':'+(i+1);
  if(!c.lazy && lastOpenedRoute!==readerRoute){
    // A failed/unfinished lazy load is not proof a chapter was read.
    lastOpenedRoute=readerRoute;
    const latest=read('novelnest.progress',{});
    if(latest&&typeof latest==='object'&&!Array.isArray(latest))progress=latest;
    // Last opened is the chapter actually chosen, not the highest number.
    const previous=progress[n.id];
    const at=Math.max(Date.now(),(Number(previous?.at)||0)+1);
    progress={...progress,[n.id]:{chapter:i,at}};
    persist('novelnest.progress',progress);
  }
  try{sessionStorage.setItem(LAST_READER_ROUTE,chapterUrl(n,i));}catch{}
  return `<div class="reader-wrap">${novelBreadcrumb(n,window.NovelNestChapterLabels?.number(c,i+1)||i+1)}<div class="reader-tools"><div><label for="reader-theme">Appearance</label><select id="reader-theme"><option value="light" ${preferences.theme==='light'?'selected':''}>Light</option><option value="sepia" ${preferences.theme==='sepia'?'selected':''}>Sepia</option><option value="night" ${preferences.theme==='night'?'selected':''}>Night</option></select></div><div><button data-font="-2" aria-label="Decrease text size">A−</button><span id="font-size" class="meta">${preferences.size||20}px</span><button data-font="2" aria-label="Increase text size">A+</button></div><a class="text-link" href="${bookUrl(n)}">Chapters</a></div><article><div class="reader-heading"><span class="eyebrow">Chapter ${i+1}</span><h1>${esc(chapterTitle(c))}</h1><span class="meta">${esc(n.title)} · NovelHaven reader</span></div><div class="prose">${c.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}</div></article><div class="chapter-nav">${previous>=0?`<a class="button outline" href="${chapterUrl(n,previous)}">Previous chapter</a>`:'<button class="button outline" disabled>Previous chapter</button>'}${next>=0?`<a class="button" href="${chapterUrl(n,next)}">Next chapter</a>`:`<a class="button" href="${bookUrl(n)}">Back to novel</a>`}</div><div class="end-note">${next<0?(n.status==='Completed'?'The end. Thank you for reading.':'You’re caught up. More chapters will appear here when available.'):'Your last opened chapter is saved on this device.'}</div></div>`;
}
// Background account/storage changes must not replace the whole Library page.
// Update only the Continue Reading card so scroll and open controls stay put.
function refreshLibraryProgress(){
  if(!(/^#\/library(?:\?|$)/.test(location.hash||'') || /^\/library\/?$/.test(location.pathname||'')))return;
  if((location.hash||'').includes('tab=history') || (location.search||'').includes('tab=history'))return;
  const card=main.querySelector?.('.continue-box');
  const next=continueBox();
  if(card){if(!next)card.remove();else if(card.outerHTML!==next)card.outerHTML=next;}
  else if(next)main.querySelector?.('.library-tabs')?.insertAdjacentHTML('afterend',next);
}
// Replace only the shelf when another tab/account sync adds bookmarks.
 // Rebuilding the entire route changes image heights and jumps the page.
function bookmarkShelf(){
  const books=novels.filter(n=>saved.includes(n.id));
  const missing=saved.filter(id=>!novels.some(n=>n.id===id));
  const pending=missing.length?`<div class="bookmark-pending-list">${missing.map(id=>`<div class="bookmark-pending"><span>♥</span><strong>${esc(id.replace(/[-_]+/g,' ').split(' ').map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' '))}</strong><small>Bookmarked · temporarily unavailable</small></div>`).join('')}</div>`:'';
  return books.length||missing.length?`<div class="catalog-grid">${books.map(card).join('')}</div>`+pending:
    '<div class="empty"><h2>A shelf waiting for stories.</h2><p>Bookmark a novel to find it here and follow new chapters.</p><a class="button" href="./#/browse">Explore novels</a></div>';
}
function refreshLibraryBookmarks(){
  if(!(/^#\/library(?:\?|$)/.test(location.hash||'')||/^\/library\/?$/.test(location.pathname||'')))return;
  if((location.hash||'').includes('tab=history')||(location.search||'').includes('tab=history'))return;
  const storedBookmarks=read('novelnest.saved',[]);
  if(Array.isArray(storedBookmarks))saved=[...new Set(storedBookmarks)];
  const tally=main.querySelector?.('.library-tabs span');
  if(tally)tally.textContent=String(saved.length);
  const shelf=main.querySelector?.('[data-library-shelf]');
  if(shelf){const html=bookmarkShelf();if(shelf.innerHTML!==html)shelf.innerHTML=html;}
  refreshLibraryProgress();
}
function library(params = new URLSearchParams()) {
  const storedBookmarks=read('novelnest.saved',[]);
  if(Array.isArray(storedBookmarks))saved=[...new Set(storedBookmarks)];
  const history=params.get('tab')==='history';
  const books=history?novels.filter(n=>lastRead(n)).sort((a,b)=>lastRead(b).at-lastRead(a).at):[];
  const tabs=`<nav class="library-tabs" aria-label="Your library"><a href="./#/library" ${!history?'aria-current="page"':''}>Bookmarks <span>${saved.length}</span></a><a href="./#/library?tab=history" ${history?'aria-current="page"':''}>History</a></nav>`;
  const shelf=history?(books.length?`<div class="history-list">${books.map(n=>`<a class="history-row" href="${chapterUrl(n,lastRead(n).chapter)}">${image(n)}<div><h2>${esc(n.title)}</h2><p>Continue chapter ${lastRead(n).chapter+1}</p></div><span aria-hidden="true">›</span></a>`).join('')}</div>`:'<div class="empty"><h2>Your story starts here.</h2><p>Chapters you open will appear here.</p><a class="button" href="./#/browse">Explore novels</a></div>'):
    `<div data-library-shelf>${bookmarkShelf()}</div>`;
  // Keep the account row IN the first Library paint. Async Firebase state
  // changes must never insert or remove content above bookmarked novels.
  const accountRow='<div id="account-panel" class="library-account-status" role="group" aria-label="Reading account status"><span class="sync-dot" aria-hidden="true"></span><p data-account-status title="Reading data status">Checking saved reading data…</p><button type="button" data-open-library-account aria-label="Open My Account">My Account</button></div>';
  return `<section class="intro library-intro"><div><h1>My Bookmarks</h1></div></section>${accountRow}${tabs}${!history?continueBox():''}${shelf}`;
}
function missing(){return `<div class="empty"><h1>Page not found</h1><p>This story or chapter is not in the catalog.</p><a class="button" href="./#/browse">Browse novels</a></div>`}
function about(){return `<article class="policy-page">
  <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">About</span></nav>
  <header class="policy-hero"><span class="eyebrow">A home for long-form reading</span><h1>About NovelHaven</h1><p>NovelHaven is an independent web-novel library and reading site built to make long stories easier to discover, organize, and read chapter by chapter.</p></header>
  <div class="policy-copy">
    <h2>What NovelHaven offers</h2>
    <p>Readers can browse novels by genre, follow ongoing releases, find completed stories, save bookmarks, continue from reading history, and adjust the reader for a more comfortable experience. The Reading Desk also publishes original guides and recommendations written specifically for NovelHaven.</p>
    <h2>Publishing and rights</h2>
    <p>NovelHaven only intends to publish full chapter text when the site owner has confirmed permission or another valid right to publish that material. Copyright in individual novels, cover art, characters, and other third-party works remains with the applicable authors, artists, publishers, or rights holders unless explicitly stated otherwise.</p>
    <p>If you are a rights holder and believe something on NovelHaven should not be available, please use the <a href="./#/copyright">Copyright &amp; Takedown</a> page so the material can be reviewed promptly.</p>
    <h2>Accounts and reading data</h2>
    <p>Guest reading data such as bookmarks, preferences, and recent reading progress can be stored in the browser. Signed-in readers may use Google sign-in through Firebase Authentication, with supported library and reading information synchronized through Firebase services.</p>
    <h2>Independent editorial content</h2>
    <p>NovelHaven’s editorial guides are original site content. They are written to help readers compare reading styles, understand genre labels, and make better choices about what to read next. Editorial pages are separate from the text of licensed novels.</p>
  </div>
</article>`}
function privacy(){return `<article class="policy-page">
  <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">Privacy Policy</span></nav>
  <header class="policy-hero"><span class="eyebrow">Your data and choices</span><h1>Privacy Policy</h1><p>This policy explains what NovelHaven stores, which third-party services the site uses, and what may change if advertising is enabled.</p></header>
  <div class="policy-copy">
    <h2>Information stored on your device</h2>
    <p>NovelHaven may use browser storage to remember bookmarks, reading history, reader appearance preferences, notification state, and the last chapter you opened. Guest data generally stays on the device unless you sign in and use a supported synchronization feature.</p>
    <h2>Account information</h2>
    <p>If you choose Google sign-in, authentication is handled through Firebase Authentication. NovelHaven may receive basic account identifiers needed to sign you in and associate supported library data with your account. Synchronized reading data may be stored using Firebase/Google services.</p>
    <h2>Technical and third-party services</h2>
    <p>The site may connect to third-party services needed for features such as authentication, cloud synchronization, fonts, hosting, and security. Google Fonts may be requested by your browser to display the site’s typography. GitHub Pages currently hosts the public website.</p>
    <h2>Advertising and cookies</h2>
    <p>NovelHaven does not need advertising cookies to provide its basic reading features. If advertising services such as Google AdSense are enabled, Google and its partners may use cookies, device identifiers, or similar technologies to deliver, measure, and personalize ads where permitted. This policy will be updated if the advertising setup changes.</p>
    <h2>Your choices</h2>
    <p>You can clear local NovelHaven data using your browser controls. If you use a signed-in account, sign-out and account controls are available from the site menu. Browser privacy settings can also restrict cookies or local storage, although doing so may limit bookmarks, history, or sign-in features.</p>
    <h2>Children</h2>
    <p>NovelHaven is intended for a general audience and is not designed to knowingly collect personal information from children in violation of applicable law. Readers should follow the age requirements of any account or advertising service they use.</p>
    <h2>Contact</h2>
    <p>Questions about this policy can be sent through the <a href="./#/contact">Contact</a> page.</p>
  </div>
</article>`}
function terms(){return `<article class="policy-page">
  <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">Terms of Use</span></nav>
  <header class="policy-hero"><span class="eyebrow">Rules for using NovelHaven</span><h1>Terms of Use</h1><p>By using NovelHaven, you agree to use the site responsibly and respect the rights of authors, artists, publishers, and other users.</p></header>
  <div class="policy-copy">
    <h2>Reading access</h2>
    <p>NovelHaven provides browsing, bookmarking, account, and reading features for personal use. You may not use the site to scrape, mass-copy, resell, republish, or redistribute chapter text, images, or other protected material without permission from the relevant rights holder.</p>
    <h2>Accounts</h2>
    <p>You are responsible for activity performed through your account and for maintaining control of the Google account used to sign in. NovelHaven may change, suspend, or discontinue account features when necessary for security, reliability, or service maintenance.</p>
    <h2>Intellectual property</h2>
    <p>NovelHaven branding, original editorial writing, interface text, and original site code or design elements are protected by their applicable rights. Individual novels, covers, and third-party materials remain the property of their respective rights holders unless otherwise stated.</p>
    <h2>External services and links</h2>
    <p>NovelHaven may rely on or link to services operated by other companies. Those services have their own terms and privacy practices. NovelHaven is not responsible for content, availability, or changes on third-party sites.</p>
    <h2>Availability and accuracy</h2>
    <p>Novel information, chapter counts, status labels, and availability can change. NovelHaven aims to keep listings accurate but does not guarantee uninterrupted access or that every catalog detail will always be error-free.</p>
    <h2>Changes to these terms</h2>
    <p>These terms may be revised as NovelHaven adds new features, advertising, or account services. Continued use after an update means you accept the revised terms.</p>
  </div>
</article>`}
function contact(){return `<article class="policy-page">
  <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">Contact</span></nav>
  <header class="policy-hero"><span class="eyebrow">Questions, corrections, and business inquiries</span><h1>Contact NovelHaven</h1><p>Use the appropriate channel below so requests can be reviewed clearly.</p></header>
  <div class="policy-copy contact-grid">
    <section><h2>General questions &amp; site issues</h2><p>For broken links, incorrect chapter information, feature problems, or general feedback, open an issue in the NovelHaven GitHub repository.</p><p><a class="button" href="https://github.com/dmlazid/NovelNest/issues/new" target="_blank" rel="noopener noreferrer">Open a GitHub issue</a></p></section>
    <section><h2>Copyright or removal request</h2><p>If you are an author, artist, publisher, or other rights holder requesting review or removal of material, use the dedicated copyright instructions.</p><p><a class="button outline" href="./#/copyright">Copyright &amp; Takedown</a></p></section>
    <section><h2>Repository</h2><p>Technical source and public change history are available in the NovelHaven GitHub repository.</p><p><a class="text-link" href="https://github.com/dmlazid/NovelNest" target="_blank" rel="noopener noreferrer">Visit the NovelHaven repository</a></p></section>
  </div>
</article>`}
function copyrightPage(){return `<article class="policy-page">
  <nav class="directory-breadcrumb" aria-label="Breadcrumb"><a href="./#/">⌂ Home</a><span aria-hidden="true">›</span><span aria-current="page">Copyright &amp; Takedown</span></nav>
  <header class="policy-hero"><span class="eyebrow">Rights-holder requests</span><h1>Copyright &amp; Takedown Requests</h1><p>NovelHaven respects authors, artists, publishers, and other rights holders.</p></header>
  <div class="policy-copy">
    <h2>NovelHaven publishing policy</h2>
    <p>NovelHaven only intends to host full novel text where the site owner has confirmed permission or another valid right to publish it. Copyright ownership is not transferred to NovelHaven merely because a work appears in the catalog.</p>
    <h2>How to request review or removal</h2>
    <p>If you believe content on NovelHaven infringes your copyright or is being used outside the permission granted, submit a request through the public contact channel below. To help the request be reviewed quickly, include:</p>
    <ul><li>Your name and relationship to the copyrighted work.</li><li>The work you believe is affected.</li><li>The exact NovelHaven URL or novel title involved.</li><li>A description of the rights you own or represent.</li><li>The action you are requesting, such as correction, attribution change, or removal.</li><li>A reliable way to contact you for follow-up.</li></ul>
    <p><a class="button" href="https://github.com/dmlazid/NovelNest/issues/new" target="_blank" rel="noopener noreferrer">Submit a rights request</a></p>
    <h2>Good-faith handling</h2>
    <p>Credible rights-holder requests should be reviewed promptly. Material may be temporarily restricted while ownership or authorization is being clarified. False or abusive claims may be rejected.</p>
    <p class="policy-small">This page provides a practical takedown process for NovelHaven and is not a substitute for legal advice or any formal statutory notice procedure that may apply in a particular country.</p>
  </div>
</article>`}

function renderRoute({preserveScroll=false}={}){
  // Recovery if a mobile refresh reveals the internal ad-free reader shell.
  if(/^\/restricted-reader(?:\.html)?\/?$/.test(location.pathname||'')&&window.history?.replaceState){
    let remembered='';
    try{remembered=sessionStorage.getItem(LAST_READER_ROUTE)||'';}catch{}
    const m=remembered.match(/^\/novel\/([^/]+)\/chapter-(\d+)\/$/);
    const novel=m?novels.find(n=>n.id===decodeURIComponent(m[1])):null;
    const valid=novel&&Number(m[2])>0&&Number(m[2])<=novel.chapters.length;
    window.history.replaceState(null,'',valid?remembered:'/library/');
  }
  if(!preserveScroll)window.dispatchEvent(new Event('novelnest:before-route'));
  const oldScrollY=preserveScroll?(window.scrollY||0):0;
  let pathname=location.pathname||'/',search=location.search||'';
  let cleanNovelPath=/^\/novel\/[^/]+\/?$/.test(pathname);
  let cleanChapter=chapterPathMatch(pathname);
  const legacyRead=location.hash.match(/^#\/read\/([^/?#]+)\/(\d+)\/?$/);
  const legacyNovel=location.hash.match(/^#\/novel\/([^/?#]+)\/?$/);
  const oldReadPath=pathname.match(/^\/read\/([^/]+)\/?$/);
  if(window.history?.replaceState){
    if(legacyRead)window.history.replaceState(null,'',`/novel/${encodeURIComponent(decodeURIComponent(legacyRead[1]))}/chapter-${legacyRead[2]}/`);
    else if(legacyNovel)window.history.replaceState(null,'',`/novel/${encodeURIComponent(decodeURIComponent(legacyNovel[1]))}/`);
    else if(oldReadPath){const chapter=new URLSearchParams(search).get('chapter')||'1';window.history.replaceState(null,'',`/novel/${encodeURIComponent(decodeURIComponent(oldReadPath[1]))}/chapter-${chapter}/`)}
    else if(location.hash==='#/'||location.hash==='#')window.history.replaceState(null,'',pathname+search);
    pathname=location.pathname||'/';search=location.search||'';
    cleanNovelPath=/^\/novel\/[^/]+\/?$/.test(pathname);cleanChapter=chapterPathMatch(pathname);
  }
  let raw=(cleanNovelPath||cleanChapter||oldReadPath)?'':(location.hash.startsWith('#/')?location.hash.slice(1):pathname+search);
  if(!raw&&cleanChapter)raw=`/read/${decodeURIComponent(cleanChapter[1])}/${cleanChapter[2]}`;
  if(!raw&&cleanNovelPath){const match=pathname.match(/^\/novel\/([^/]+)\/?$/);raw=match?`/novel/${decodeURIComponent(match[1])}`:'/'}
  if(!raw&&oldReadPath){const chapter=new URLSearchParams(search).get('chapter')||'1';raw=`/read/${decodeURIComponent(oldReadPath[1])}/${chapter}`}
  if(!raw)raw='/';
  // Some mobile tabs retain the ad-free restricted-reader shell URL.
  // When the remembered chapter is unavailable, send readers to Library
  // rather than showing a misleading missing-novel error.
  if(pathname==='/restricted-reader'||pathname==='/restricted-reader/'||pathname==='/restricted-reader.html')raw='/library';
  let [path,query='']=raw.split('?');const parts=path.split('/').filter(Boolean),params=new URLSearchParams(query);
  if(parts[0]!=='read')lastOpenedRoute='';
  applySettings();document.querySelector('#library-count').textContent=saved.length;
  document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===(parts[0]||'home');a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  let html,title='Find your next chapter';
  switch(parts[0]){case undefined:html=home();break;case 'browse':html=browse(params);title='Browse novels';break;case 'genre':{const genreName=decodeURIComponent(parts.slice(1).join('/')||'');html=genreDirectory(genreName,params);title=genreName?genreName+' Novels':'Genres';break;}case 'finder':html=finderPage(params);title='Novel Finder';break;case 'latest-releases':html=directoryPage('releases');title='Latest Novels';break;case 'latest-novels':html=directoryPage('novels');title='Latest Novels';break;case 'completed':html=directoryPage('completed');title='Completed Novels';break;case 'latest':html=`<section class="intro"><div><span class="eyebrow">Fresh from the shelf</span><h1>Latest chapters</h1><p class="muted">Every available chapter, with the latest additions first.</p></div></section><div class="chapter-list">${latestRows()}</div>`;title='Latest chapters';break;case 'novel':html=detail(parts[1]);title=novels.find(n=>n.id===parts[1])?.title||'Not found';break;case 'read':html=reader(parts[1],parts[2]);title=`${novels.find(n=>n.id===parts[1])?.title||'Not found'} · ${chapterTitle(novels.find(n=>n.id===parts[1])?.chapters[Number(parts[2])-1])}`;break;case 'library':html=library(params);title='My library';break;case 'reading-desk':html=readingDesk();title='Reading Desk';break;case 'editorial':html=editorial(parts[1]);title=EDITORIALS[parts[1]]?.title||'Reading Desk';break;case 'about':html=about();title='About NovelHaven';break;case 'privacy':html=privacy();title='Privacy Policy';break;case 'terms':html=terms();title='Terms of Use';break;case 'contact':html=contact();title='Contact';break;case 'copyright':html=copyrightPage();title='Copyright & Takedown';break;default:html=missing();title='Not found'}
  if(preserveScroll && main.innerHTML===html)return;
  main.innerHTML=html;main.querySelectorAll?.('a[href]')?.forEach(a=>{const h=a.getAttribute('href')||'';if(h.startsWith('./#/'))a.setAttribute('href',h.slice(3));else if(h.startsWith('#/'))a.setAttribute('href',h.slice(1))});document.title=`${title} — NovelHaven`;if(!preserveScroll)window.scrollTo(0,0);
  else if((window.scrollY||0)!==oldScrollY)window.scrollTo(0,oldScrollY);
  window.dispatchEvent(new Event('novelnest:route-rendered'));
}
// Keep the current page visible until the next page is ready to paint.
// Reduced-motion and older browsers keep the original immediate navigation.
function route({animate=false,preserveScroll=false}={}){
  const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if(animate&&!preserveScroll&&!reduceMotion&&typeof document.startViewTransition==='function'){
    try{const transition=document.startViewTransition(()=>renderRoute());transition.finished.catch(()=>{});return}catch(_){/* Native transition unavailable; render normally. */}
  }
  renderRoute({preserveScroll});
}
main.addEventListener('submit',e=>{
  if(e.target.matches('.search-form')){
    e.preventDefault();
    navigate('/browse?q='+encodeURIComponent(new FormData(e.target).get('q').trim()));
    return;
  }
  if(e.target.matches('.directory-search')){
    e.preventDefault();
    const route=e.target.dataset.directoryRoute;
    const p=new URLSearchParams(location.search.slice(1));
    const q=String(new FormData(e.target).get('q')||'').trim();
    if(q)p.set('q',q);else p.delete('q');
    navigate('/'+route+(p.toString()?'?'+p.toString():''));
    return;
  }
  if(e.target.matches('.finder-form')){
    e.preventDefault();
    const p=new URLSearchParams(new FormData(e.target));
    for(const [key,value] of [...p.entries()]) if(!String(value).trim()||value==='All') p.delete(key);
    navigate('/finder'+(p.toString()?'?'+p.toString():''));
  }
});
main.addEventListener('click',e=>{
  const anchor=e.target.closest?.('a[href]'),href=anchor?.getAttribute?.('href')||'';
  if(anchor&&!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&(!anchor.target||anchor.target==='_self')){const u=new URL(href,location.href);if(u.origin===location.origin&&(/^\/(?:novel\/|browse|genre|finder|library|latest|completed|reading-desk|editorial|about|privacy|terms|contact|copyright)/.test(u.pathname)||u.pathname==='/')){e.preventDefault();navigate(u.pathname+u.search);return}}
  const save=e.target.closest('[data-save]');if(save)toggleSave(save.dataset.save);
  const font=e.target.closest('[data-font]');if(font){preferences.size=Math.min(28,Math.max(16,(Number(preferences.size)||20)+Number(font.dataset.font)));persist('novelnest.preferences',preferences);applySettings();document.querySelector('#font-size').textContent=preferences.size+'px'}
});
main.addEventListener('change',e=>{
  if(e.target.id==='reader-theme'){
    preferences.theme=e.target.value;
    persist('novelnest.preferences',preferences);
    applySettings();
  }
  if(e.target.dataset.filter){
    const p=new URLSearchParams(location.search.slice(1));
    p.set(e.target.dataset.filter,e.target.value);
    navigate('/browse?'+p.toString());
    return;
  }
  if(e.target.dataset.directoryFilter){
    const p=new URLSearchParams(location.search.slice(1));
    const key=e.target.dataset.directoryFilter;
    const value=e.target.value;
    if(value==='All'||!value)p.delete(key);else p.set(key,value);
    const route=e.target.dataset.directoryRoute;
    navigate('/'+route+(p.toString()?'?'+p.toString():''));
    return;
  }
  if(e.target.dataset.genreSort){
    const p=new URLSearchParams(location.search.slice(1));
    if(e.target.value==='latest')p.delete('sort');else p.set('sort',e.target.value);
    navigate('/genre/'+encodeURIComponent(e.target.dataset.genreSort)+(p.toString()?'?'+p.toString():''));
  }
});
window.addEventListener('hashchange',()=>{route({animate:false});main.focus({preventScroll:true})});
window.addEventListener('popstate',()=>{route({animate:false});main.focus({preventScroll:true})});
document.querySelector('#year').textContent=new Date().getFullYear();route();
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'search_novelnest_catalog',description:'Search the available NovelHaven catalog without changing bookmarks.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input.query!=='string')throw new Error('query must be a string');return novels.filter(n=>`${n.title} ${n.author} ${n.tags.join(' ')}`.toLowerCase().includes(input.query.toLowerCase())).map(n=>({id:n.id,title:n.title,chapters:n.chapters.length,readingLocation:n.externalUrl?n.externalSource:"NovelHaven",url:bookUrl(n)}))}})).catch(()=>{})}catch{}}

window.NovelNestApp = { navigate, refresh: route, refreshLibraryProgress, refreshLibraryBookmarks, reloadData() { saved=read("novelnest.saved",[]); progress=read("novelnest.progress",{}); document.querySelector("#library-count").textContent=saved.length; document.querySelectorAll("[data-save]").forEach(b=>{b.textContent=saved.includes(b.dataset.save)?"♥ Bookmarked":"♡ Bookmark";b.setAttribute("aria-pressed",String(saved.includes(b.dataset.save)))}); } };
