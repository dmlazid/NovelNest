(() => {
  const backup = window.NovelNestBackup, sync = window.NovelNestSync;
  const OWNER = 'novelnest.account-owner', SEEN = 'novelnest.update-seen';
  const scopeKey = uid => 'novelnest.account-cache.' + encodeURIComponent(uid || 'guest');
  const baseKey = uid => 'novelnest.account-base.' + encodeURIComponent(uid);
  const books = window.NOVELS || [];
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let owner = '', user = null, sdk = null, auth = null, db = null, ready = false;
  let applying = false, running = false, busy = false, generation = 0, timer = 0, lastSync = 0;
  let message = 'Connecting account service…', lastSaved = [], lastTracked = '', baseline = sync.empty();
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
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
    applying = true;
    try {
      write(state);
      window.NovelNestReading?.reload();
      window.NovelNestPositions?.reload();
      window.NovelNestApp?.reloadData();
      cache();
    } finally { applying = false; }
    if (!location.hash.startsWith('#/read/')) window.dispatchEvent(new Event('hashchange'));
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
    const target = normalize(read(scopeKey(next), sync.empty()));
    const previous = current();
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
        if (raw && raw.version !== 1) throw Error('Unsupported cloud data.');
        const remote = raw ? normalize(raw) : sync.empty();
        const merged = normalize(initializeSeen(sync.merge(base, sent, remote)));
        if (!raw || JSON.stringify(merged) !== JSON.stringify(remote)) transaction.set(ref, { version: 1, ...merged });
        return merged;
      });
      if (ticket !== generation || auth.currentUser?.uid !== uid) return;
      // Include edits made while the request was in flight.
      window.NovelNestPositions?.capture();
      const latest = current();
      const combined = normalize(sync.merge(sent, latest, result));
      localStorage.setItem(baseKey(uid), JSON.stringify(result));
      baseline = result;
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
      logout: '<path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  };
  function avatar() {
    const photo = typeof user?.photoURL === 'string' && user.photoURL.startsWith('https://') ? user.photoURL : '';
    const initials = (user?.displayName || user?.email || '').split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
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
      element.addEventListener('click', event => { if (event.target === element) { const rect = element.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right) element.close(); } });
    }
    return element;
  }
  function closeDrawers() { document.querySelectorAll('.site-drawer[open]').forEach(d => d.close()); }
  function openDrawer(element) { closeDrawers(); element.showModal(); }
  function drawerTop(title) {
    return `<div class="drawer-top"><a href="./#/" data-close-drawer class="drawer-brand"><span>N</span> NovelNest</a><button type="button" class="header-icon" data-close-drawer aria-label="Close ${title}">${icon('close')}</button></div>`;
  }
  function row(href, name, detail, symbol) {
    return `<a class="drawer-row" data-close-drawer href="${href}"><span class="row-icon">${icon(symbol)}</span><span><strong>${name}</strong><small>${detail}</small></span><span class="row-chevron" aria-hidden="true">›</span></a>`;
  }
  function googleButton() {
    return `<button class="button google-signin" data-signin ${!ready || busy ? 'disabled' : ''}><span aria-hidden="true">G</span> Continue with Google</button>${!ready ? '<button class="quiet-button" data-account-retry>Retry connection</button>' : ''}`;
  }
  function profileContent() {
    let guest = false;
    try { const data = read(scopeKey(''), null)?.data; guest = !!data && (data.saved.length > 0 || Object.keys(data.progress).length > 0); } catch {}
    return drawerTop('account') + `<section class="profile-summary"><div class="profile-avatar">${avatar()}</div><div><h2>${escape(user?.displayName || (user ? 'Reader' : 'Welcome, reader'))}</h2><p>${escape(user?.email || 'Your next chapter is waiting.')}</p></div></section>` +
      (!user ? `<div class="drawer-signin"><p>Sign in to keep your library across devices.</p>${googleButton()}</div>` : '') +
      `<div class="drawer-rows">${row('./#/library','Bookmarks','Your saved novels','bookmark')}${row('./#/library?tab=history','History','Pick up where you left off','history')}
      <details class="account-settings"><summary class="drawer-row"><span class="row-icon">${icon('settings')}</span><span><strong>Settings</strong><small>Your library &amp; account</small></span><span class="row-chevron" aria-hidden="true">›</span></summary><div class="settings-content">${user ? `<button class="button" data-sync-now ${busy ? 'disabled' : ''}>Sync now</button>${guest ? '<button class="button outline" data-import-guest>Add guest reading data</button><p>Copy this device’s guest bookmarks and progress into your account.</p>' : ''}<p>Signing out returns to your guest library.</p>` : '<p>Your guest library is saved on this device. Sign in to sync across devices.</p>'}</div></details></div>
      <div class="profile-bottom"><p data-account-status role="status" aria-live="polite"></p>${user ? `<button class="signout-button" data-signout ${busy ? 'disabled' : ''}>${icon('logout')} Sign out</button>` : ''}</div>`;
  }
  function showProfile() {
    const panel = drawer('account-drawer', 'My account'); panel.innerHTML = profileContent(); renderStatus(); openDrawer(panel);
  }
  function render() {
    const main = document.querySelector('#main');
    const profile = document.querySelector('[data-profile]');
    if (profile) { profile.innerHTML = avatar(); profile.setAttribute('aria-label', user ? 'My account' : 'Log in or sign up'); }
    if (location.hash.split('?')[0] === '#/library') {
      let section = document.querySelector('#account-panel');
      if (!section) { section = document.createElement('section'); section.id = 'account-panel'; main.querySelector('.intro')?.insertAdjacentElement('afterend', section); }
      section.className = user ? 'library-sync' : 'library-signin';
      section.innerHTML = user ? '<span class="sync-dot" aria-hidden="true"></span><p data-account-status role="status" aria-live="polite"></p>' : `<div><strong>Your library, everywhere.</strong><p>Sign in to sync your bookmarks.</p></div>${googleButton()}<p class="signin-status" data-account-status role="status" aria-live="polite"></p>`;
    }
    const panel = document.querySelector('#account-drawer');
    if (panel?.open) {
      const settingsOpen = !!panel.querySelector('details[open]');
      panel.innerHTML = profileContent();
      if (settingsOpen) panel.querySelector('details')?.setAttribute('open','');
    }
    renderStatus();
  }
  function showMenu() {
    const panel = drawer('navigation-drawer', 'Navigation');
    const genres = [...new Set(books.flatMap(n => n.tags || []))].sort((a,b) => a.localeCompare(b));
    const menuLink = (href, label, symbol) => `<a href="${href}" data-close-drawer><span class="catalog-menu-icon">${icon(symbol)}</span><span>${label}</span></a>`;
    const genreLinks = genres.map(genre => `<a href="./#/browse?genre=${encodeURIComponent(genre)}" data-close-drawer>${escape(genre)}</a>`).join('');
    panel.innerHTML = drawerTop('menu') + `<div class="menu-content">
      <form class="drawer-search" data-menu-search>
        <label class="sr-only" for="menu-search">Search novels</label>
        ${icon('search')}<input id="menu-search" name="q" placeholder="Search novels…" type="search">
        <button type="submit" aria-label="Search">${icon('search')}</button>
      </form>

      <div class="catalog-menu-tabs" role="tablist" aria-label="Browse NovelNest">
        <button type="button" role="tab" aria-selected="true" data-catalog-tab="novels">${icon('book')}<span>Novel list</span></button>
        <button type="button" role="tab" aria-selected="false" data-catalog-tab="genres">${icon('grid')}<span>Genres</span></button>
      </div>

      <section class="catalog-menu-panel" data-catalog-panel="novels">
        <nav class="catalog-menu-list" aria-label="Novel list">
          ${menuLink('./#/library','Your Library','bookmark')}
          ${menuLink('./#/latest-novels','Latest Novels','book')}
          ${menuLink('./#/latest-releases','Latest Release','bell')}
          ${menuLink('./#/latest-novels?sort=chapters','Most Chapters','grid')}
          ${menuLink('./#/completed','Completed Novels','bookmark')}
          ${menuLink('./#/browse','Novel Finder','search')}
        </nav>
      </section>

      <section class="catalog-menu-panel" data-catalog-panel="genres" hidden>
        <nav class="catalog-genre-grid" aria-label="Genres">${genreLinks}</nav>
      </section>

      <div class="menu-divider">ACCOUNT &amp; UPDATES</div>
      <div class="drawer-rows">
        <button type="button" class="drawer-row drawer-action-row" data-profile><span class="row-icon">${icon('user')}</span><span><strong>My account</strong><small>${user ? 'Profile, sync &amp; settings' : 'Sign in or continue as guest'}</small></span><span class="row-chevron" aria-hidden="true">›</span></button>
        <button type="button" class="drawer-row drawer-action-row" data-updates><span class="row-icon">${icon('bell')}</span><span><strong>Notifications</strong><small>Chapter updates from saved novels</small></span><span class="menu-update-dot notification-dot" data-notification-dot hidden></span><span class="row-chevron" aria-hidden="true">›</span></button>
      </div>
      <div class="menu-divider">YOUR READING</div>
      <div class="drawer-rows">${row('./#/latest','Latest chapters','Fresh from your favorite worlds','bell')}${row('./#/library?tab=history','History','Continue your reading journey','history')}${row('./#/about','About NovelNest','Stories &amp; reading information','info')}</div>
    </div>`;
    renderStatus();
    openDrawer(panel);
  }
  function showUpdates() {
    const dialog = drawer('updates-dialog', 'Notifications');
    const entries = sync.updates(books, current());
    dialog.innerHTML = drawerTop('notifications') + `<div class="notifications-heading"><h2>Notifications</h2><button class="quiet-button" data-seen-updates ${entries.length ? '' : 'disabled'}>Mark all read</button></div><div class="notification-tabs"><span>Chapters <b>${entries.length}</b></span></div>${entries.length ? '<ul class="update-list">' + entries.map(n => { const book = books.find(b => b.id === n.id); return `<li><a data-close-drawer href="./#/read/${escape(n.id)}/${n.first}"><img src="${escape(book.cover)}" alt=""><div><strong>${escape(n.title)}</strong><span><em>New</em> Chapter ${n.first}${n.count > 1 ? '–' + book.chapters.length : ''}</span></div></a></li>`; }).join('') + '</ul>' : `<div class="empty-notifications"><div>${icon('bell')}</div><h3>You’re all caught up</h3><p>New chapters from your bookmarked novels will appear here.</p><a class="button" href="./#/browse" data-close-drawer>Explore novels</a></div>`}<p class="notifications-footnote">Updates refresh when you visit NovelNest.</p>`;
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
        generation++; user = next; ready = true;
        try {
          if (owner !== (next?.uid || '')) { switchOwner(next?.uid || ''); return; }
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
    if (target.closest('[data-profile]')) showProfile();
    if (target.closest('[data-menu]')) showMenu();
    const catalogTab = target.closest('[data-catalog-tab]');
    if (catalogTab) {
      const drawer = catalogTab.closest('.site-drawer');
      drawer?.querySelectorAll('[data-catalog-tab]').forEach(button => button.setAttribute('aria-selected', String(button === catalogTab)));
      drawer?.querySelectorAll('[data-catalog-panel]').forEach(section => { section.hidden = section.dataset.catalogPanel !== catalogTab.dataset.catalogTab; });
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
      busy = true; window.NovelNestPositions?.capture(); cache();
      // Pending changes stay in this account's local cache even when offline.
      sdk.signOut(auth).catch(fail).finally(() => { busy = false; render(); });
    }
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
    if (!event.target.matches('[data-menu-search]')) return;
    event.preventDefault();
    const query = new FormData(event.target).get('q').trim();
    closeDrawers(); location.hash = '#/browse?q=' + encodeURIComponent(query);
  });
  window.NovelNestAccounts = { changed, synchronize };
  window.addEventListener('novelnest:view-ready', render);
  window.addEventListener('online', () => synchronize(true));
  window.addEventListener('focus', () => { if (Date.now() - lastSync > 60000) synchronize(true); });
  // Another tab may switch accounts or edit shared local data. Reload before
  // this tab can write using the previous account's in-memory state.
  window.addEventListener('storage', event => {
    if (event.key === OWNER) { generation++; clearTimeout(timer); user = null; window.NovelNestPositions?.stop(); applying = true; location.reload(); }
    else if (event.key?.startsWith('novelnest.') && !event.key.startsWith('novelnest.account-')) {
      window.NovelNestReading?.reload(); window.NovelNestPositions?.reload(); window.NovelNestApp?.reloadData(); renderStatus();
    }
  });
  try {
    owner = read(OWNER, '');
    if (typeof owner !== 'string') owner = '';
    write(initializeSeen(current())); cache();
    lastSaved = current().data.saved.slice();
  } catch { message = 'Browser storage is unavailable. Enable site storage to use accounts.'; }
  render();
  setTimeout(start, 0);
})();
