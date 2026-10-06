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
    } catch { message = 'Browser storage is unavailable. Download a backup before closing this page.'; renderStatus(); }
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
  function renderStatus() {
    const node = document.querySelector('[data-account-status]');
    if (node) node.textContent = message;
    const link = document.querySelector('[data-account-link]');
    if (link) link.textContent = user ? 'My account' : 'Log in / Sign up';
    try {
      const updates = sync.updates(books, current());
      const bell = document.querySelector('[data-updates]');
      if (bell) { bell.textContent = `🔔 Updates${updates.length ? ' (' + updates.length + ')' : ''}`; bell.setAttribute('aria-label', `${updates.length} novels with new chapters`); }
    } catch {}
  }
  function render() {
    const main = document.querySelector('#main');
    if (location.hash === '#/library') {
      let section = document.querySelector('#account-panel');
      if (!section) { section = document.createElement('section'); section.id = 'account-panel'; section.className = 'account-panel'; main.querySelector('.intro')?.insertAdjacentElement('afterend', section); }
      let guest = false;
      try { const data = read(scopeKey(''), null)?.data; guest = !!data && (data.saved.length > 0 || Object.keys(data.progress).length > 0); } catch {}
      section.innerHTML = user
        ? `<h2>Your account</h2><p>Signed in as <strong>${escape(user.displayName || user.email || 'Reader')}</strong></p><p>Bookmarks, chapter labels, and reading positions sync across your devices. Appearance settings stay on this device.</p><div class="actions"><button class="button" data-sync-now ${busy ? 'disabled' : ''}>Sync now</button><button class="button outline" data-signout ${busy ? 'disabled' : ''}>Sign out</button>${guest ? '<button class="button outline" data-import-guest>Add guest reading data</button>' : ''}</div><p class="meta">Signing out returns to your separate guest library.</p><p data-account-status role="status" aria-live="polite"></p>`
        : `<h2>Take your library with you</h2><p>One Google button to sign up or log in. Save bookmarks and resume reading on another device.</p><button class="button google-signin" data-signin ${!ready || busy ? 'disabled' : ''}><span aria-hidden="true">G</span> Continue with Google</button>${!ready ? '<button class="button outline" data-account-retry>Retry connection</button>' : ''}<p class="meta">Guest reading works without an account. After signing in, choose “Add guest reading data” to copy this device’s guest library into your account.</p><p data-account-status role="status" aria-live="polite"></p>`;
    }
    renderStatus();
  }
  function showUpdates() {
    let dialog = document.querySelector('#updates-dialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'updates-dialog'; dialog.className = 'updates-dialog'; dialog.setAttribute('aria-labelledby', 'updates-title'); document.body.appendChild(dialog); }
    const entries = sync.updates(books, current());
    dialog.innerHTML = `<div class="section-head"><h2 id="updates-title">Chapter updates</h2><button class="button outline" data-close-updates aria-label="Close updates">Close</button></div><p>New chapters for novels in your library. Updates appear here when you revisit or refresh NovelNest.</p>${entries.length ? '<ul class="update-list">' + entries.map(n => `<li><a data-close-updates href="#/read/${escape(n.id)}/${n.first}"><strong>${escape(n.title)}</strong><span>${n.count} new chapter${n.count === 1 ? '' : 's'} · Start chapter ${n.first}</span></a></li>`).join('') + '</ul><button class="button" data-seen-updates>Mark all as seen</button>' : '<p class="empty-updates">You’re caught up. Save a novel to your library to follow future chapters.</p>'}<p class="meta">These are in-site alerts. No email or phone push notifications are sent.</p>`;
    dialog.showModal();
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
    if (target.closest('[data-close-updates]')) document.querySelector('#updates-dialog')?.close();
    if (target.closest('[data-seen-updates]')) {
      const state = current();
      for (const n of books) if (state.data.saved.includes(n.id)) state.seen[n.id] = n.chapters.length;
      localStorage.setItem(SEEN, JSON.stringify(state.seen)); changed();
      document.querySelector('#updates-dialog')?.close();
    }
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
