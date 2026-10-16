(() => {
  const backup = window.NovelNestBackup, sync = window.NovelNestSync;
  const OWNER = 'novelnest.account-owner', SEEN = 'novelnest.update-seen';
  const intentKey = (kind, uid) => 'novelnest.pending-'+kind+'.'+encodeURIComponent(uid || 'guest');
  const scopeKey = uid => 'novelnest.account-cache.' + encodeURIComponent(uid || 'guest');
  const baseKey = uid => 'novelnest.account-base.' + encodeURIComponent(uid);
  // Keep an account-scoped recovery copy of the last confirmed profile.
  // This prevents a temporary Firestore read failure from hiding its avatar.
  const profileKey = uid => 'novelhaven.profile-backup.' + encodeURIComponent(uid);
  const books = window.NOVELS || [];
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let owner = '', user = null, sdk = null, auth = null, db = null, ready = false;
  let applying = false, running = false, busy = false, generation = 0, timer = 0, lastSync = 0;
  let editorAccess = false, profileData = {}, profileSaving = false, profileRevision = 0;
  const FOUNDER_UID = 'vJaubaSEoDbqt9HXekVzWBM08Tj1';
  const isFounder = () => editorAccess && user?.uid === FOUNDER_UID;
  const profileName = () => profileData.displayName || user?.displayName || 'Reader';
  let requestedSignOut=false;
  let message = 'Connecting account service…', lastSaved = [], lastTracked = '', baseline = sync.empty();
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  function safeProfile(value) {
    if(!value || typeof value!=='object')return {};
    const displayName=typeof value.displayName==='string'?value.displayName.slice(0,60):'';
    const candidate=typeof value.photoURL==='string'?value.photoURL:'';
    const photoURL=candidate==='initials'||/^(https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/.test(candidate)?candidate:'';
    return {displayName,photoURL};
  }
  const savedProfile = uid => uid ? safeProfile(read(profileKey(uid),{})) : {};
  function rememberProfile(uid,value) {
    if(!uid)return;
    try { localStorage.setItem(profileKey(uid),JSON.stringify(safeProfile(value))); }
    catch { /* Firestore remains authoritative if browser storage is disabled. */ }
  }
  function normalize(value) {
    if (!value || typeof value !== 'object') throw Error('Invalid cloud reading data.');
    const data = backup.parse(JSON.stringify({ format: 'novelnest-backup', version: 1, data: value.data }));
    const seen = {};
    for (const n of books) {
      const count = value.seen?.[n.id];
      if (Number.isInteger(count) && count >= 0) seen[n.id] = count;
    }
    return { data, seen };
  }
  function current() { return normalize({ data: backup.readCurrent(), seen: read(SEEN, {}) }); }
  function cache() { localStorage.setItem(scopeKey(owner), JSON.stringify(current())); }
  function pendingIntents(uid) {
    const safeList = value => Array.isArray(value) ? value.filter(x=>typeof x==='string') : [];
    return {
      savedRemovals: safeList(read(intentKey('saved-removals',uid),[])),
      unfinishedChapters: safeList(read(intentKey('chapter-unfinish',uid),[]))
    };
  }
  function recordIntent(kind, token, removed) {
    // Firebase loads after the page, so preserve intentional clicks made
    // before the auth SDK finishes restoring this account.
    if(!owner || (user && owner!==user.uid)) return;
    const key=intentKey(kind,owner);
    const current=new Set(read(key,[]));
    if(removed)current.add(token);else current.delete(token);
    localStorage.setItem(key,JSON.stringify([...current]));
  }
  function bookmarkAction(id,isSaved) { recordIntent('saved-removals',id,!isSaved); }
  function chapterFinishAction(id,number,isFinished) {
    recordIntent('chapter-unfinish',id+':'+number,!isFinished);
  }
  function acknowledgeIntents(uid,cloud) {
    const savedKey=intentKey('saved-removals',uid),finishedKey=intentKey('chapter-unfinish',uid);
    const pending=pendingIntents(uid);
    localStorage.setItem(savedKey,JSON.stringify(pending.savedRemovals.filter(id=>cloud.data.saved.includes(id))));
    localStorage.setItem(finishedKey,JSON.stringify(pending.unfinishedChapters.filter(token=>{
      const index=token.lastIndexOf(':'),id=token.slice(0,index),num=Number(token.slice(index+1));
      return cloud.data.chapterStatus[id]?.finished?.includes(num);
    })));
  }
  function initializeSeen(state) {
    for (const n of books) if (state.data.saved.includes(n.id) && state.seen[n.id] === undefined) state.seen[n.id] = n.chapters.length;
    return state;
  }
  function write(state) {
    state = normalize(state);
    backup.write(state.data);
    localStorage.setItem(SEEN, JSON.stringify(state.seen));
    lastSaved = state.data.saved.slice();
    lastTracked = JSON.stringify(state);
  }
  function apply(state) {
    const previous = current();
    // A deliberately opened earlier chapter is still "last opened"
    // when it has a more recent timestamp than the cloud snapshot.
    for(const [id,progress] of Object.entries(previous.data.progress)){
      const incoming=state.data.progress?.[id];
      if(Number.isInteger(progress?.chapter)&&(!incoming||progress.at>incoming.at))
        state.data.progress[id]=progress;
    }
    const savedChanged = JSON.stringify(previous.data.saved) !== JSON.stringify(state.data.saved);
    const progressChanged = JSON.stringify(previous.data.progress) !== JSON.stringify(state.data.progress);
    applying = true;
    try {
      write(state);
      window.NovelNestReading?.reload();
      window.NovelNestPositions?.reload();
      window.NovelNestApp?.reloadData();
      cache();
    } finally { applying = false; }
    const isLibrary = location.hash.startsWith('#/library') || /^\/library\/?$/.test(location.pathname || '');
    if (isLibrary) {
      // Synchronization is NOT navigation. Never animate a page transition,
      // throw the user to the top, or discard the existing Library DOM.
      if (savedChanged) window.NovelNestApp?.refreshLibraryBookmarks?.();
      else if (progressChanged) window.NovelNestApp?.refreshLibraryProgress?.();
    }
    render();
  }
  function fail(error) {
    const code = error?.code || '';
    if (code.includes('popup-closed') || code.includes('cancelled-popup')) message = 'Sign-in cancelled. You can continue reading as a guest.';
    else if (code.includes('popup-blocked')) message = 'Your browser blocked Google sign-in. Allow pop-ups for this site, then try again.';
    else if (code.includes('unauthorized-domain')) message = 'Google sign-in is not enabled for this website address yet.';
    else if (code.includes('permission-denied')) message = 'Cloud access was denied. Your reading data is still saved on this device. Please contact the site owner.';
    else if (code.includes('resource-exhausted')) message = 'Cloud sync has reached its limit. Your reading data is saved on this device; try again later.';
    else message = 'Could not connect. Your reading data stays on this device. Check your connection and try again.';
    render();
  }
  function changed() {
    if (applying) return;
    try {
      const state = current();
      for (const n of books) if (state.data.saved.includes(n.id) && (!lastSaved.includes(n.id) || state.seen[n.id] === undefined)) state.seen[n.id] = n.chapters.length;
      const tracked = JSON.stringify(state);
      if (tracked === lastTracked) return;
      localStorage.setItem(SEEN, JSON.stringify(state.seen));
      lastSaved = state.data.saved.slice();
      cache(); lastTracked = tracked;
      if (user && owner === user.uid) {
        message = 'Changes saved on this device. Sync pending…';
        clearTimeout(timer); timer = setTimeout(() => synchronize(), 5000);
      }
      renderStatus();
    } catch { message = 'Browser storage is unavailable. Enable site storage to save your reading progress.'; renderStatus(); }
  }
  // Stored data belongs to a scope, never to whichever Google account signs in next.
  function switchOwner(next) {
    window.dispatchEvent(new Event('novelnest:before-route'));
    cache();
    const previous = current();
    const accountCache = read(scopeKey(next), null);
    const target = normalize(accountCache || sync.empty());
    // A first sign-in must not make guest bookmarks appear to vanish.
    // Bring this device's guest reads into its FIRST signed-in library only.
    // Never leak account A's private saved books into account B.
    if(next && !owner && !accountCache){
      target.data = backup.combine(target.data, previous.data);
      for(const [id,count] of Object.entries(previous.seen||{}))
        target.seen[id]=Math.max(target.seen[id]||0,count);
    }
    // If the account's local cache was lost, an old persisted sync baseline
    // could incorrectly interpret every cloud bookmark as a local deletion.
    if(next && !accountCache)
      localStorage.setItem(baseKey(next),JSON.stringify(sync.empty()));
    applying = true;
    try {
      write(target);
      localStorage.setItem(OWNER, JSON.stringify(next));
    } catch (error) {
      write(previous); applying = false; throw error;
    }
    owner = next;
    // Old reader timers were stopped before replacing data. Reload all closures.
    location.hash = '#/library';
    location.reload();
  }
  async function synchronize(force = false) {
    clearTimeout(timer);
    if (!ready || !user || owner !== user.uid || running) return;
    if (navigator.onLine === false) { message = 'Offline. Changes are saved on this device and will sync when you reconnect.'; renderStatus(); return; }
    const uid = user.uid, ticket = generation;
    let sent;
    try {
      window.NovelNestPositions?.capture();
      sent = current();
      if (!force && JSON.stringify(sent) === JSON.stringify(baseline) && Date.now() - lastSync < 60000) return;
      running = true; message = 'Syncing your library…'; renderStatus();
      const base = baseline;
      const ref = sdk.doc(db, 'users', uid);
      const result = await sdk.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        if (ticket !== generation || auth.currentUser?.uid !== uid) throw Error('Account changed.');
        const raw = snapshot.exists() ? snapshot.data() : null;
        if (raw && raw.version !== undefined && raw.version !== 1) throw Error('Unsupported cloud data.');
        const remote = raw?.version === 1 ? normalize(raw) : sync.empty();
        const merged = normalize(initializeSeen(sync.merge(base, sent, remote, pendingIntents(uid))));
        // Merge only reading fields. Replacing the entire user document can
        // accidentally overwrite a newly uploaded photo in a concurrent tab.
        if (!raw || JSON.stringify(merged) !== JSON.stringify(remote))
          transaction.set(ref, {version:1,...merged},{merge:true});
        return merged;
      });
      if (ticket !== generation || auth.currentUser?.uid !== uid) return;
      // Include edits made while the request was in flight.
      window.NovelNestPositions?.capture();
      const latest = current();
      const combined = normalize(sync.merge(sent, latest, result, pendingIntents(uid)));
      localStorage.setItem(baseKey(uid), JSON.stringify(result));
      baseline = result;
      acknowledgeIntents(uid,result);
      if (JSON.stringify(latest) !== JSON.stringify(combined)) apply(combined);
      else cache();
      lastSync = Date.now();
      const pending = JSON.stringify(current()) !== JSON.stringify(baseline);
      message = pending ? 'Latest changes saved. Finishing sync…' : 'Synced with your Google account.';
      if (pending) timer = setTimeout(() => synchronize(), 5000);
      renderStatus();
    } catch (error) { if (ticket === generation) fail(error); }
    finally { running = false; }
  }
  const icon = name => {
    const paths = {
      book: '<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v15"/>',
      bookmark: '<path d="M6 3h12v19l-6-4-6 4Z"/>',
      history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
      search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
      shield: '<path d="M12 2 21 6v6c0 6-3.6 9-9 10-5.4-1-9-4-9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
      logout: '<path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  };
  function avatar() {
    const candidate = profileData.photoURL || user?.photoURL || '';
    const photo = /^(https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/.test(candidate) ? candidate : '';
    const initials = (profileName() || user?.email || '').split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
    return photo ? `<img src="${escape(photo)}" alt="" referrerpolicy="no-referrer">` : user ? `<span>${escape(initials || 'N')}</span>` : icon('user');
  }
  function statusText() {
    return message === 'Synced with your Google account.' ? 'All changes synced' : message === 'Reading as a guest. Saved on this device.' ? 'Saved on this device' : message;
  }
  function renderStatus() {
    document.querySelectorAll('[data-account-status]').forEach(node => { node.textContent = statusText(); });
    try {
      const updates = sync.updates(books, current());
      const bell = document.querySelector('[data-updates]');
      if (bell) bell.setAttribute('aria-label', updates.length ? `Notifications: ${updates.length} novels with new chapters` : 'Notifications');
      document.querySelectorAll('[data-notification-dot]').forEach(dot => { dot.hidden = !updates.length; });
    } catch {}
  }
  function drawer(id, title) {
    let element = document.querySelector('#' + id);
    if (!element) {
      element = document.createElement('dialog'); element.id = id; element.className = 'site-drawer';
      element.setAttribute('aria-label', title); document.body.appendChild(element);
      // Keep the site mounted when navigating from the mobile menu.
      // The former location.assign() caused a full document reload and a white flash.
      if (['navigation-drawer','account-drawer','updates-dialog'].includes(id)) {
        element.addEventListener('click', event => {
          const link = event.target.closest('a[href]');
          if (!link || !element.contains(link)) return;
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
          const destination = new URL(link.href, location.href);
          if (destination.origin !== location.origin) return;
          // Separate author pages intentionally require a normal page load.
          // Never feed them to the existing novel SPA router.
          if (/^\/(?:author-studio|author-guidelines|author-admin|original-novels|original-story)\.html$/.test(destination.pathname)) {
            try { element.close(); } catch {}
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          try { element.close(); } catch {}
          // Keep the drawer mounted; reopening must not restore an old scroll offset.
          if (window.NovelNestApp?.navigate) {
            window.NovelNestApp.navigate(destination.pathname + destination.search + destination.hash);
          } else {
            window.location.assign(destination.href);
          }
        }, true);
      }
      element.addEventListener('click', event => { if (event.target === element) { const rect = element.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right) element.close(); } });
    }
    return element;
  }
  function closeDrawers() { document.querySelectorAll('.site-drawer[open]').forEach(d => { try { d.close(); } catch {} }); }
  function openDrawer(element) { closeDrawers(); element.showModal(); element.scrollTop=0; element.querySelector('[data-close-drawer]')?.focus?.({preventScroll:true}); }
  // Native full-document navigation avoids leaving the modal above routed pages.
  function menuHref(href) {
    if (!href.startsWith('./#/')) return href;
    // "./#/" already includes the leading slash at index 3.
    // Adding another slash creates a protocol-relative URL ("//library")
    // that the browser interprets as a hostname instead of a site route.
    const route = href.slice(3);
    return route;
  }
  function drawerTop(title) {
    return `<div class="drawer-top"><a href="/" data-close-drawer class="drawer-brand"><span>N</span> NovelHaven</a><button type="button" class="header-icon" data-close-drawer aria-label="Close ${title}">${icon('close')}</button></div>`;
  }
  function row(href, name, detail, symbol) {
    return `<a class="drawer-row" data-close-drawer href="${menuHref(href)}"><span class="row-icon">${icon(symbol)}</span><span><strong>${name}</strong><small>${detail}</small></span><span class="row-chevron" aria-hidden="true">›</span></a>`;
  }
  function googleButton() {
    return `<button class="button google-signin" data-signin ${!ready || busy ? 'disabled' : ''}><span aria-hidden="true">G</span> Continue with Google</button>${!ready ? '<button class="quiet-button" data-account-retry>Retry connection</button>' : ''}`;
  }
  async function verifyEditor(account,expectedGeneration) {
    if(!account?.uid||!sdk?.getDoc)return;
    let allowed=false;
    try {
      const badge=await sdk.getDoc(sdk.doc(db,'authorAdmins',account.uid));
      allowed=badge.exists()&&badge.data()?.role==='editor';
    }catch(error){console.warn('Editor access unavailable:',error?.code||'offline');}
    if(expectedGeneration!==generation||user?.uid!==account.uid)return;
    editorAccess=allowed;render();
  }
  function ownerStatistics(){
    try {
      const data=backup.readCurrent();
      const finished=Object.values(data.chapterStatus||{}).reduce((total,item)=>total+(item.finished?.length||0),0);
      const currentlyReading=Object.keys(data.progress||{}).length;
      return {saved:data.saved.length,finished,currentlyReading};
    }catch{return {saved:0,finished:0,currentlyReading:0};}
  }
  function adminCard(which) {
    if(!editorAccess||!user)return '';
    // The main menu is intentionally COMPACT. The owner chooses when to
    // expand tools, instead of pushing Search / Genres far off-screen.
    if(which==='owner-menu-card')return `<details class="owner-menu-dropdown owner-menu-card" data-owner-dropdown>
      <summary class="owner-menu-summary">
        <span class="owner-menu-crown" aria-hidden="true">${icon('shield')}</span>
        <span class="owner-menu-label"><strong>${isFounder()?'Owner':'Administrator'} tools</strong><small>Verified administrator</small></span>
        <span class="owner-menu-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="owner-menu-tools">
        <a href="/author-admin.html" data-close-drawer>${icon('shield')} <span>Admin Dashboard<small>Review new submissions</small></span></a>
        <a href="/author-studio.html" data-close-drawer>${icon('book')} <span>Author Studio<small>Write and manage drafts</small></span></a>
        <a href="/original-novels.html" data-close-drawer>${icon('bookmark')} <span>Published originals<small>Visit the public library</small></span></a>
        <a href="/author-guidelines.html" data-close-drawer>${icon('info')} <span>Editorial guidelines<small>Review publishing requirements</small></span></a>
      </div>
    </details>`;
    const stats=ownerStatistics();
    return `<section class="owner-priority-card owner-account-card" aria-label="Founder command center">
      <div class="owner-member-top">
        <span class="owner-eyebrow">${icon('shield')} VERIFIED NOVELHAVEN ADMIN</span>
        <span class="owner-member-mark" aria-hidden="true">✦</span>
      </div>
      <h3>${isFounder()?'Founder Command Center':'Administrator Dashboard'}</h3>
      <p class="owner-intro">Your private space to guide NovelHaven, review new authors, and keep your reading library safe.</p>
      <div class="owner-stats" aria-label="Your saved reading activity">
        <div><strong>${stats.saved}</strong><span>Bookmarks</span></div>
        <div><strong>${stats.finished}</strong><span>Chapters finished</span></div>
        <div><strong>${stats.currentlyReading}</strong><span>Stories opened</span></div>
      </div>
      <a class="owner-primary-link" data-close-drawer href="/author-admin.html">Admin Dashboard <span aria-hidden="true">↗</span></a>
      <div class="owner-tools-title">${isFounder()?'FOUNDER PRIVILEGES':'ADMINISTRATOR TOOLS'}</div>
      <div class="owner-action-grid">
        <a href="/author-admin.html" data-close-drawer>${icon('shield')} <span>Moderation</span></a>
        <a href="/author-studio.html" data-close-drawer>${icon('book')} <span>My manuscripts</span></a>
        <a href="/original-novels.html" data-close-drawer>${icon('bookmark')} <span>Published stories</span></a>
        <a href="/author-guidelines.html" data-close-drawer>${icon('info')} <span>Author policy</span></a>
        <button type="button" data-sync-now ${busy?'disabled':''}>${icon('settings')} <span>Sync reading</span></button>
        <button type="button" data-founder-backup>${icon('history')} <span>Export backup</span></button>
      </div>
      <p class="owner-privacy-note">Your backup downloads to this device. Keep it private; it includes your reading history.</p>
    </section>`;
  }
  function writerCard(which) {
    return `<section class="writer-invite-card ${which}" aria-label="Become a NovelHaven author">
      <span class="writer-kicker">✦ YOUR WRITING JOURNEY</span><span class="writer-feather" aria-hidden="true">✒</span>
      <h3>Your story could be their next favorite.</h3>
      <p>Turn your imagination into a novel. Save chapters, develop characters and share your original story after editorial review.</p>
      <div class="writer-actions"><a href="/author-studio.html?compose=1" class="writer-primary-link" data-close-drawer>Start Writing <span aria-hidden="true">↗</span></a>
      <a href="/author-guidelines.html" class="writer-help-link" data-close-drawer>How it works</a></div>
    </section>`;
  }
  function readerCard() {
    const stats=ownerStatistics();
    return `<section class="reader-account-card"><h3>Your reading space</h3><div class="owner-stats"><div><strong>${stats.saved}</strong><span>Bookmarks</span></div><div><strong>${stats.finished}</strong><span>Chapters finished</span></div><div><strong>${stats.currentlyReading}</strong><span>Stories opened</span></div></div></section>`;
  }
  function profileEditor() {
    if(!user)return '';
    return `<details class="profile-editor"><summary>Edit photo &amp; username <span aria-hidden="true">⌄</span></summary><form data-profile-form>
      <label>Username<input name="displayName" required minlength="2" maxlength="60" value="${escape(profileName())}" autocomplete="nickname"></label>
      <label>Choose profile photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
      <p>JPG, PNG or WebP, up to 5 MB. Your photo is resized for fast loading.</p>
      <label class="profile-remove"><input type="checkbox" name="removePhoto"> Use initials instead</label>
      <button class="button" type="submit">Save profile</button><p data-profile-message role="status"></p>
    </form></details>`;
  }
  async function loadProfile(account,ticket) {
    const revision=profileRevision;
    try {
      // The server, not an old offline snapshot, is the source of truth.
      const ref=sdk.doc(db,'users',account.uid);
      const snapshot=await (sdk.getDocFromServer||sdk.getDoc)(ref);
      if(ticket!==generation||user?.uid!==account.uid||revision!==profileRevision)return;
      const remote=snapshot.data()?.profile;
      if(remote && typeof remote==='object') {
        profileData=safeProfile(remote);
        rememberProfile(account.uid,profileData);
      } else {
        // Restore a previously confirmed upload only if the server has no
        // profile. Explicit photo removal uses 'initials' and is never undone.
        const cached=savedProfile(account.uid);
        if(cached.photoURL||cached.displayName) {
          await sdk.setDoc(ref,{profile:cached},{merge:true});
          if(ticket!==generation||user?.uid!==account.uid||revision!==profileRevision)return;
          profileData=cached;
        }
      }
      render();
    }catch{
      // Keep the uid-scoped last confirmed image visible while offline.
      if(ticket===generation&&user?.uid===account.uid&&revision===profileRevision)render();
    }
  }
  async function resizePhoto(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP smaller than 5 MB.');
    const bitmap=await createImageBitmap(file);
    try {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=192;
      const context=canvas.getContext('2d'),side=Math.min(bitmap.width,bitmap.height);
      context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,192,192);
      return canvas.toDataURL('image/jpeg',0.8);
    }finally{bitmap.close();}
  }
  async function saveProfile(form) {
    if(!user||profileSaving)return;
    const account=user,ticket=generation,button=form.querySelector('[type="submit"]'),label=form.querySelector('[data-profile-message]');
    profileSaving=true;profileRevision++;button.disabled=true;label.textContent='Saving profile…';
    try {
      const fields=new FormData(form),displayName=String(fields.get('displayName')||'').trim();
      if(displayName.length<2||displayName.length>60)throw Error('Use 2–60 characters for your username.');
      const file=fields.get('photo');
      const photoURL=fields.has('removePhoto')?'initials':file?.size?await resizePhoto(file):(profileData.photoURL||account.photoURL||'');
      if(ticket!==generation||auth.currentUser?.uid!==account.uid)return;
      const next={displayName,photoURL};
      await sdk.setDoc(sdk.doc(db,'users',account.uid),{profile:next},{merge:true});
      if(ticket!==generation||user?.uid!==account.uid)return;
      profileData=safeProfile(next);
      rememberProfile(account.uid,profileData);
      // Firebase Auth keeps the author pen-name suggestion consistent, too.
      try {await sdk.updateProfile(account,{displayName});}catch{}
      render();
      const status=document.querySelector('#account-drawer [data-account-status]');
      if(status)status.textContent='Profile saved.';
    }catch(error){label.textContent=error?.message?.startsWith('Choose ')||error?.message?.startsWith('Use ')?error.message:'Could not save your profile. Please try again.';}
    finally{profileSaving=false;button.disabled=false;}
  }
  function profileContent() {
    let guest = false;
    try { const data = read(scopeKey(''), null)?.data; guest = !!data && (data.saved.length > 0 || Object.keys(data.progress).length > 0); } catch {}
    return drawerTop('account') + `<section class="profile-summary ${editorAccess&&user?'founder-profile-summary':''}"><div class="profile-avatar">${avatar()}${editorAccess&&user?'<span class="founder-avatar-crown" aria-label="Verified administrator">✦</span>':''}</div><div><h2>${escape(user ? profileName() : 'Welcome, reader')}</h2>${editorAccess&&user?'<span class="founder-profile-badge">'+(isFounder()?'✦ FOUNDER / OWNER · VERIFIED ADMIN':'VERIFIED ADMINISTRATOR')+'</span>':user?'<span class="reader-profile-badge">NOVELHAVEN READER</span>':''}<p>${escape(user?.email || 'Your next chapter is waiting.')}</p></div></section>` +
      profileEditor() + adminCard('owner-account-card') + (!editorAccess ? readerCard() + writerCard('writer-account-card') : '') +
      (!user ? `<div class="drawer-signin"><p>Sign in to keep your library across devices.</p>${googleButton()}</div>` : '') +
      `<div class="drawer-rows">${row('./#/library','Bookmarks','Your saved novels','bookmark')}${row('./#/library?tab=history','History','Pick up where you left off','history')}
      <details class="account-settings"><summary class="drawer-row"><span class="row-icon">${icon('settings')}</span><span><strong>Settings</strong><small>Your library &amp; account</small></span><span class="row-chevron" aria-hidden="true">›</span></summary><div class="settings-content">${user ? `<button class="button" data-sync-now ${busy ? 'disabled' : ''}>Sync now</button>${guest ? '<button class="button outline" data-import-guest>Add guest reading data</button><p>Copy this device’s guest bookmarks and progress into your account.</p>' : ''}<p>Signing out returns to your guest library.</p>` : '<p>Your guest library is saved on this device. Sign in to sync across devices.</p>'}</div></details></div>
      <div class="profile-bottom"><p data-account-status role="status" aria-live="polite"></p>${user ? `<button class="signout-button" data-signout ${busy ? 'disabled' : ''}>${icon('logout')} Sign out</button>` : ''}</div>`;
  }
  function showProfile() {
    const panel = drawer('account-drawer', 'My account'); panel.innerHTML = profileContent(); panel.dataset.profileState=(user?.uid||'guest')+':'+String(editorAccess)+':'+JSON.stringify(profileData); renderStatus(); openDrawer(panel);
  }
  function render() {
    const main = document.querySelector('#main');
    const headerAdmin=document.querySelector('[data-admin-shortcut]');
    if(headerAdmin)headerAdmin.hidden=!(editorAccess&&user);
    const adminSlot=document.querySelector('#navigation-drawer [data-admin-slot]');
    if(adminSlot){
      const shouldHave=!!(editorAccess&&user),existing=adminSlot.querySelector?.('[data-owner-dropdown]');
      if(shouldHave&&!existing){
        const scrollParent=adminSlot.closest?.('.site-drawer');
        const before=scrollParent?.scrollTop||0;
        adminSlot.innerHTML=adminCard('owner-menu-card');
        if(scrollParent?.open)scrollParent.scrollTop=before;
      }else if(!shouldHave&&existing){
        const scrollParent=adminSlot.closest?.('.site-drawer');
        const before=scrollParent?.scrollTop||0;
        adminSlot.innerHTML='';
        if(scrollParent?.open)scrollParent.scrollTop=before;
      }
    }
    const profile = document.querySelector('.profile-button[data-profile]');
    if (profile) { profile.innerHTML = avatar(); profile.setAttribute('aria-label', user ? 'My account' : 'Log in or sign up'); }
    // The Library paints a fixed account-status row itself. Updating auth
    // should change ONLY its text, never append a panel or replace its HTML.
    // This avoids jumping on delayed Firebase sign-in / mobile refresh.
    const panel = document.querySelector('#account-drawer');
    if (panel?.open) {
      // Background bookmark sync must not remount My Account or jump its scroll.
      const key=(user?.uid||'guest')+':'+String(editorAccess)+':'+JSON.stringify(profileData);
      if(panel.dataset.profileState!==key){
        const settingsOpen=!!panel.querySelector('details[open]'),top=panel.scrollTop;
        panel.innerHTML=profileContent();panel.dataset.profileState=key;
        if(settingsOpen)panel.querySelector('details')?.setAttribute('open','');
        panel.scrollTop=top;
      }
    }
    renderStatus();
  }
  function showMenu() {
    const panel = drawer('navigation-drawer', 'Navigation');
    // Keep mounted menu nodes intact across openings. Rebuilding this large menu
    // on every tap discards scroll/focus and makes mobile navigation jump.
    if(panel.dataset.menuReady==='true'){
      render();
      openDrawer(panel);
      return;
    }
    const genres = [...new Set(books.flatMap(n => n.tags || []))].sort((a,b) => a.localeCompare(b));
    const menuLink = (href, label, symbol) => `<a href="${menuHref(href)}" data-close-drawer><span class="catalog-menu-icon">${icon(symbol)}</span><span>${label}</span></a>`;
    const genreLinks = genres.map(genre => `<a href="${menuHref(`./#/genre/${encodeURIComponent(genre)}`)}" data-close-drawer>${escape(genre)}</a>`).join('');
    panel.innerHTML = drawerTop('menu') + `<div class="menu-content">
      <form class="drawer-search" data-menu-search>
        <label class="sr-only" for="menu-search">Search novels</label>
        ${icon('search')}<input id="menu-search" name="q" placeholder="Search novels…" type="search">
        <button type="submit" aria-label="Search">${icon('search')}</button>
      </form>
      <div data-admin-slot>${adminCard('owner-menu-card')}</div>

      <div class="catalog-menu-tabs" aria-label="Browse NovelHaven">
        <button type="button" aria-expanded="false" aria-controls="catalog-novels-panel" data-catalog-tab="novels">${icon('book')}<span>Novel list</span><span class="catalog-tab-chevron" aria-hidden="true">⌄</span></button>
        <button type="button" aria-expanded="false" aria-controls="catalog-genres-panel" data-catalog-tab="genres">${icon('grid')}<span>Genres</span><span class="catalog-tab-chevron" aria-hidden="true">⌄</span></button>
      </div>

      <section class="catalog-menu-panel" id="catalog-novels-panel" data-catalog-panel="novels" hidden>
        <nav class="catalog-menu-list" aria-label="Novel list">
          ${menuLink('/original-novels.html','Original Novels','book')}
          ${menuLink('./#/library','Bookmarks','bookmark')}
          ${menuLink('./#/latest-novels','Latest Novels','book')}
          ${menuLink('./#/latest-releases','Latest Release','bell')}
          ${menuLink('./#/latest-novels?sort=chapters','Most Chapters','grid')}
          ${menuLink('./#/completed','Completed Novels','bookmark')}
          ${menuLink('./#/finder','Novel Finder','search')}
        </nav>
      </section>

      <section class="catalog-menu-panel" id="catalog-genres-panel" data-catalog-panel="genres" hidden>
        <nav class="catalog-genre-grid" aria-label="Genres">${genreLinks}</nav>
      </section>

      <div class="menu-divider">ACCOUNT &amp; UPDATES</div>
      <div class="drawer-rows">
        <button type="button" class="drawer-row drawer-action-row" data-profile><span class="row-icon">${icon('user')}</span><span><strong>My account</strong><small>${user ? 'Profile, sync &amp; settings' : 'Sign in or continue as guest'}</small></span><span class="row-chevron" aria-hidden="true">›</span></button>
        ${writerCard('writer-menu-card')}
        <button type="button" class="drawer-row drawer-action-row" data-updates><span class="row-icon">${icon('bell')}</span><span><strong>Notifications</strong><small>Chapter updates from saved novels</small></span><span class="menu-update-dot notification-dot" data-notification-dot hidden></span><span class="row-chevron" aria-hidden="true">›</span></button>
      </div>
      <div class="menu-divider">YOUR READING</div>
      <div class="drawer-rows">${row('./#/latest','Latest chapters','Fresh from your favorite worlds','bell')}${row('./#/library?tab=history','History','Continue your reading journey','history')}${row('./#/about','About NovelHaven','Stories &amp; reading information','info')}</div>
    </div>`;
    panel.dataset.menuReady='true';
    renderStatus();
    openDrawer(panel);
  }
  function downloadFounderReadingBackup() {
    if(!editorAccess||!user)return;
    let objectUrl='';
    try {
      const data=backup.readCurrent();
      const json=JSON.stringify({format:'novelnest-backup',version:1,data,exportedAt:new Date().toISOString()},null,2);
      // Use the same validated format as NovelNestBackup.parse().
      backup.parse(json);
      objectUrl=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const link=document.createElement('a');
      link.href=objectUrl;link.download='novelhaven-reading-backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
    }catch(error){
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      message='Could not export reading backup. Please keep this browser’s saved data.';
      renderStatus();
    }
  }
  function showUpdates() {
    const dialog = drawer('updates-dialog', 'Notifications');
    const entries = sync.updates(books, current());
    dialog.innerHTML = drawerTop('notifications') + `<div class="notifications-heading"><h2>Notifications</h2><button class="quiet-button" data-seen-updates ${entries.length ? '' : 'disabled'}>Mark all read</button></div><div class="notification-tabs"><span>Chapters <b>${entries.length}</b></span></div>${entries.length ? '<ul class="update-list">' + entries.map(n => { const book = books.find(b => b.id === n.id); return `<li><a data-close-drawer href="/novel/${encodeURIComponent(n.id)}/chapter-${n.first}/"><img src="${escape(book.cover)}" alt=""><div><strong>${escape(n.title)}</strong><span><em>New</em> Chapter ${n.first}${n.count > 1 ? '–' + book.chapters.length : ''}</span></div></a></li>`; }).join('') + '</ul>' : `<div class="empty-notifications"><div>${icon('bell')}</div><h3>You’re all caught up</h3><p>New chapters from your bookmarked novels will appear here.</p><a class="button" href="./#/browse" data-close-drawer>Explore novels</a></div>`}<p class="notifications-footnote">Updates refresh when you visit NovelHaven.</p>`;
    openDrawer(dialog);
  }
  async function start() {
    if (busy || ready) return;
    busy = true; message = 'Connecting account service…'; render();
    try {
      const [appSDK, authSDK, storeSDK] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')
      ]);
      sdk = { ...appSDK, ...authSDK, ...storeSDK };
      const app = sdk.initializeApp(window.NOVELNEST_FIREBASE);
      auth = sdk.getAuth(app); db = sdk.getFirestore(app);
      await sdk.setPersistence(auth, sdk.browserLocalPersistence);
      sdk.onAuthStateChanged(auth, next => {
        generation++;profileRevision++;user = next; ready = true; editorAccess=false;
        profileData=next?.uid?savedProfile(next.uid):{};
        if(next?.uid)void loadProfile(next,generation);
        // An editor link appears ONLY after checking this signed-in user's
        // Firebase authorAdmins document. Firestore rules enforce permissions.
        if(next?.uid)void verifyEditor(next,generation);
        try {
          // An expired Firebase session must not erase the local shelf merely
          // because a mobile tab was suspended or lost its sign-in state.
          if(!next&&owner&&!requestedSignOut){
            message='Sign-in unavailable. Your bookmarks remain saved on this device.';
            busy=false;render();return;
          }
          if (owner !== (next?.uid || '')) {requestedSignOut=false;switchOwner(next?.uid || '');return;}
          requestedSignOut=false;
          baseline = normalize(read(baseKey(owner), sync.empty()));
          message = user ? 'Loading your cloud library…' : 'Reading as a guest. Saved on this device.';
          busy = false; render();
          if (user) synchronize(true);
        } catch (error) { busy = false; fail(error); }
      }, fail);
    } catch (error) { busy = false; fail(error); }
  }
  document.addEventListener('click', event => {
    const target = event.target;
    if (target.closest('[data-profile]') || target.closest('[data-open-library-account]')) showProfile();
    if (target.closest('[data-menu]')) showMenu();
    const catalogTab = target.closest('[data-catalog-tab]');
    if (catalogTab) {
      const drawer = catalogTab.closest('.site-drawer');
      const show=catalogTab.getAttribute('aria-expanded')!=='true';
      drawer?.querySelectorAll('[data-catalog-tab]').forEach(button=>{
        button.setAttribute('aria-expanded',String(show && button===catalogTab));
      });
      drawer?.querySelectorAll('[data-catalog-panel]').forEach(section=>{
        section.hidden=!(show && section.dataset.catalogPanel===catalogTab.dataset.catalogTab);
      });
    }
    const cleanNovelLink = target.closest('a[href^="/novel/"]');
    // Respect Ctrl/Shift/middle-click and target=_blank. Otherwise opening
    // a novel in a new tab unexpectedly navigated the CURRENT tab as well.
    const normalLinkTap=event.button===0 && !event.metaKey && !event.ctrlKey &&
      !event.shiftKey && !event.altKey && (!cleanNovelLink?.target || cleanNovelLink.target==='_self');
    if (cleanNovelLink && normalLinkTap && window.NovelNestApp?.navigate) {
      event.preventDefault();
      closeDrawers();
      window.NovelNestApp.navigate(cleanNovelLink.getAttribute('href'));
      return;
    }
    if (target.closest('[data-close-drawer]')) closeDrawers();
    if (target.closest('[data-account-retry]')) start();
    if (target.closest('[data-signin]') && ready && !busy) {
      busy = true;
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // SDK is preloaded: open the popup directly in the user's click event.
      sdk.signInWithPopup(auth, provider).catch(fail).finally(() => { busy = false; render(); });
      render();
    }
    if (target.closest('[data-signout]') && !busy) {
      busy = true; requestedSignOut=true; window.NovelNestPositions?.capture(); cache();
      // Pending changes stay in this account's local cache even when offline.
      sdk.signOut(auth).catch(error=>{requestedSignOut=false;fail(error);}).finally(() => { busy = false; render(); });
    }
    if (target.closest('[data-founder-backup]')) downloadFounderReadingBackup();
    if (target.closest('[data-sync-now]')) synchronize(true);
    if (target.closest('[data-import-guest]') && user && owner === user.uid) {
      try {
        const guest = normalize(read(scopeKey(''), sync.empty())), state = current();
        state.data = backup.combine(state.data, guest.data);
        for (const [id, count] of Object.entries(guest.seen)) state.seen[id] = Math.max(state.seen[id] || 0, count);
        apply(initializeSeen(state)); changed(); synchronize(true);
      } catch (error) { fail(error); }
    }
    if (target.closest('[data-updates]')) showUpdates();
    if (target.closest('[data-seen-updates]')) {
      const state = current();
      for (const n of books) if (state.data.saved.includes(n.id)) state.seen[n.id] = n.chapters.length;
      localStorage.setItem(SEEN, JSON.stringify(state.seen)); changed();
      showUpdates();
    }
  });
  document.addEventListener('submit', event => {
    if(event.target.matches('[data-profile-form]')){event.preventDefault();void saveProfile(event.target);return;}
    if (!event.target.matches('[data-menu-search]')) return;
    event.preventDefault();
    const query = new FormData(event.target).get('q').trim();
    closeDrawers();
    const destination = '/browse?q=' + encodeURIComponent(query);
    if (window.NovelNestApp?.navigate) window.NovelNestApp.navigate(destination);
    else location.assign(destination);
  });
  window.NovelNestAccounts = { changed, synchronize, bookmarkAction, chapterFinishAction };
  window.addEventListener('novelnest:view-ready', render);
  window.addEventListener('online', () => synchronize(true));
  window.addEventListener('focus', () => { if (Date.now() - lastSync > 60000) synchronize(true); });
  // Another tab may switch accounts or edit shared local data. Reload before
  // this tab can write using the previous account's in-memory state.
  window.addEventListener('storage', event => {
    if (event.key === OWNER) { generation++; clearTimeout(timer); user = null; window.NovelNestPositions?.stop(); applying = true; location.reload(); }
    else if (event.key?.startsWith('novelnest.') && !event.key.startsWith('novelnest.account-')) {
      window.NovelNestReading?.reload(); window.NovelNestPositions?.reload(); window.NovelNestApp?.reloadData(); renderStatus();
      // Only relevant changes touch the visible Library. Position autosaves,
      // seen acknowledgements and preferences must not flash/rebuild the page.
      if (event.key === 'novelnest.progress') window.NovelNestApp?.refreshLibraryProgress?.();
      else if (event.key === 'novelnest.saved' &&
               (location.hash.startsWith('#/library') || /^\/library\/?$/.test(location.pathname || '')))
        window.NovelNestApp?.refreshLibraryBookmarks?.();
    }
  });
  try {
    owner = read(OWNER, '');
    if (typeof owner !== 'string') owner = '';
    // A new browser tab should not rewrite every reading-data key.
    const initial=current();
    lastSaved=initial.data.saved.slice();
    lastTracked=JSON.stringify(initial);
    cache();
  } catch { message = 'Browser storage is unavailable. Enable site storage to use accounts.'; }
  render();
  setTimeout(start, 0);
  if(new URLSearchParams(location.search||'').get('account')==='1')showProfile();
})();
