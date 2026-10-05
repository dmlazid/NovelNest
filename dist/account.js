(() => {
  const settings = globalThis.NOVELNEST_FIREBASE;
  if (!settings?.enabled || !settings.config?.apiKey || !settings.config?.projectId) return;

  const state = { user: null, db: null, auth: null, app: null, lastLocal: '', syncing: false };
  const keys = ['novelnest.saved','novelnest.progress','novelnest.preferences'];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const localPayload = () => ({
    saved: Array.isArray(read('novelnest.saved', [])) ? read('novelnest.saved', []) : [],
    progress: read('novelnest.progress', {}) || {},
    preferences: read('novelnest.preferences', {}) || {}
  });
  const signature = () => JSON.stringify(localPayload());
  const rerender = () => window.dispatchEvent(new Event('hashchange'));
  const toast = text => {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.textContent = text; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
  };
  const friendlyError = error => {
    const code = error?.code || '';
    if (code.includes('invalid-credential')) return 'Wrong email or password.';
    if (code.includes('email-already-in-use')) return 'That email already has an account.';
    if (code.includes('weak-password')) return 'Use a stronger password with at least 6 characters.';
    if (code.includes('invalid-email')) return 'Enter a valid email address.';
    if (code.includes('too-many-requests')) return 'Too many attempts. Try again later.';
    return error?.message?.replace(/^Firebase:\s*/,'') || 'Something went wrong. Please try again.';
  };

  function addUI() {
    const topbar = document.querySelector('.topbar');
    const library = document.querySelector('.library-link');
    if (!topbar || !library || document.querySelector('#account-link')) return;
    const button = document.createElement('button');
    button.id = 'account-link'; button.className = 'account-link ready'; button.type = 'button';
    button.innerHTML = '<span class="account-dot"></span><span data-account-label>Sign in</span>';
    topbar.insertBefore(button, library);

    const backdrop = document.createElement('div');
    backdrop.className = 'account-backdrop'; backdrop.id = 'account-backdrop'; backdrop.hidden = true;
    backdrop.innerHTML = `<section class="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title">
      <div class="account-modal-head"><h2 id="account-title">NovelNest account</h2><button class="account-close" type="button" aria-label="Close">×</button></div>
      <div id="account-body"></div>
    </section>`;
    document.body.appendChild(backdrop);
    button.addEventListener('click', openModal);
    backdrop.querySelector('.account-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  }

  function openModal() { document.querySelector('#account-backdrop').hidden = false; renderModal(); }
  function closeModal() { document.querySelector('#account-backdrop').hidden = true; }

  function renderModal(mode='signin') {
    const body = document.querySelector('#account-body');
    const btn = document.querySelector('#account-link');
    if (!body || !btn) return;
    if (state.user) {
      btn.classList.add('signed-in');
      btn.querySelector('[data-account-label]').textContent = state.user.email?.split('@')[0] || 'Account';
      const notifyReady = Boolean(settings.vapidKey);
      body.innerHTML = `<div class="account-profile">
        <div><div class="account-email">${escapeHtml(state.user.email || 'Signed in')}</div><p class="account-helper">Your library, bookmarks, reading progress, and reader settings sync to this account.</p></div>
        <div class="account-sync-card"><strong>☁ Synced reading data</strong><span>Changes made on this device are saved to your NovelNest account.</span></div>
        <div class="account-actions">
          <button class="button" type="button" data-enable-notifications>🔔 Enable chapter notifications</button>
          <div class="account-notify-status">${notifyReady ? 'Get a browser notification when a novel you follow receives a new chapter.' : 'Notification sending will activate after the Firebase Web Push key is connected.'}</div>
          <button class="button outline" type="button" data-account-signout>Sign out</button>
        </div>
      </div>`;
      body.querySelector('[data-account-signout]').addEventListener('click', async () => {
        await state.auth.signOut();
        localStorage.setItem('novelnest.saved','[]');
        localStorage.setItem('novelnest.progress','{}');
        state.lastLocal = signature();
        closeModal(); rerender(); toast('Signed out. Your synced data remains in your account.');
      });
      body.querySelector('[data-enable-notifications]').addEventListener('click', enableNotifications);
      return;
    }

    btn.classList.remove('signed-in');
    btn.querySelector('[data-account-label]').textContent = 'Sign in';
    const signup = mode === 'signup';
    body.innerHTML = `<div class="account-tabs"><button class="${!signup?'active':''}" type="button" data-mode="signin">Sign in</button><button class="${signup?'active':''}" type="button" data-mode="signup">Sign up</button></div>
      <form class="account-form" id="account-form">
        <label>Email<input type="email" name="email" autocomplete="email" required></label>
        <label>Password<input type="password" name="password" autocomplete="${signup?'new-password':'current-password'}" minlength="6" required></label>
        <div class="account-error" role="alert"></div>
        <button class="button" type="submit">${signup?'Create account':'Sign in'}</button>
      </form>
      ${signup ? '<p class="account-login-note">Your current local library and reading progress will be copied into your new account after sign-up.</p>' : '<button class="text-link" type="button" data-reset-password>Forgot password?</button><p class="account-login-note">Sign in on another phone or computer to continue from your saved chapter.</p>'}`;
    body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => renderModal(b.dataset.mode)));
    body.querySelector('#account-form').addEventListener('submit', e => submitAuth(e, signup));
    body.querySelector('[data-reset-password]')?.addEventListener('click', resetPassword);
  }

  function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function submitAuth(event, signup) {
    event.preventDefault();
    const form = event.currentTarget; const errorBox = form.querySelector('.account-error');
    const email = form.email.value.trim(); const password = form.password.value;
    errorBox.textContent = '';
    try {
      if (signup) {
        const cred = await state.authApi.createUserWithEmailAndPassword(state.auth, email, password);
        await state.authApi.sendEmailVerification(cred.user).catch(() => {});
        toast('Account created. Verification email sent.');
      } else {
        await state.authApi.signInWithEmailAndPassword(state.auth, email, password);
      }
    } catch (error) { errorBox.textContent = friendlyError(error); }
  }

  async function resetPassword() {
    const email = document.querySelector('#account-form input[name="email"]')?.value.trim();
    if (!email) { toast('Enter your email first.'); return; }
    try { await state.authApi.sendPasswordResetEmail(state.auth, email); toast('Password reset email sent.'); }
    catch (error) { toast(friendlyError(error)); }
  }

  function mergeProgress(local={}, cloud={}) {
    const out = {...local};
    for (const [id, value] of Object.entries(cloud || {})) {
      const existing = out[id];
      if (!existing || Number(value?.at || 0) >= Number(existing?.at || 0)) out[id] = value;
    }
    return out;
  }

  async function loadAndMergeCloud(user) {
    const ref = state.fsApi.doc(state.db, 'users', user.uid);
    const snap = await state.fsApi.getDoc(ref);
    const local = localPayload(); const cloud = snap.exists() ? snap.data() : {};
    const merged = {
      saved: [...new Set([...(cloud.saved || []), ...local.saved])],
      progress: mergeProgress(local.progress, cloud.progress),
      preferences: {...local.preferences, ...(cloud.preferences || {})}
    };
    localStorage.setItem('novelnest.saved', JSON.stringify(merged.saved));
    localStorage.setItem('novelnest.progress', JSON.stringify(merged.progress));
    localStorage.setItem('novelnest.preferences', JSON.stringify(merged.preferences));
    await state.fsApi.setDoc(ref, {
      email: user.email || '', saved: merged.saved, progress: merged.progress, preferences: merged.preferences,
      updatedAt: state.fsApi.serverTimestamp()
    }, {merge:true});
    state.lastLocal = signature(); rerender();
  }

  async function syncToCloud() {
    if (!state.user || !state.db || state.syncing) return;
    const current = signature(); if (current === state.lastLocal) return;
    state.syncing = true;
    try {
      const data = localPayload();
      await state.fsApi.setDoc(state.fsApi.doc(state.db,'users',state.user.uid), {
        email: state.user.email || '', ...data, updatedAt: state.fsApi.serverTimestamp()
      }, {merge:true});
      state.lastLocal = current;
    } catch (error) { console.warn('NovelNest sync failed', error); }
    finally { state.syncing = false; }
  }

  async function enableNotifications() {
    if (!settings.vapidKey) { toast('Web Push key is not connected yet.'); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('Notifications are not supported in this browser.'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { toast('Notification permission was not granted.'); return; }
      const messagingApi = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js');
      const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
      const messaging = messagingApi.getMessaging(state.app);
      const token = await messagingApi.getToken(messaging, {vapidKey: settings.vapidKey, serviceWorkerRegistration: reg});
      if (!token) throw new Error('No notification token was returned.');
      await state.fsApi.setDoc(state.fsApi.doc(state.db,'users',state.user.uid), {
        notificationsEnabled: true,
        fcmTokens: state.fsApi.arrayUnion(token),
        updatedAt: state.fsApi.serverTimestamp()
      }, {merge:true});
      toast('Chapter notifications enabled.');
    } catch (error) { toast(friendlyError(error)); }
  }

  async function init() {
    addUI();
    try {
      const appApi = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js');
      const authApi = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
      const fsApi = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
      state.app = appApi.initializeApp(settings.config);
      state.auth = authApi.getAuth(state.app); state.authApi = authApi;
      state.db = fsApi.getFirestore(state.app); state.fsApi = fsApi;
      authApi.onAuthStateChanged(state.auth, async user => {
        state.user = user;
        if (user) {
          try { await loadAndMergeCloud(user); toast('Signed in. Your reading data is synced.'); }
          catch (error) { console.error(error); toast('Signed in, but cloud sync could not load yet.'); }
        }
        renderModal();
      });
      setInterval(syncToCloud, 2500);
      window.addEventListener('hashchange', () => setTimeout(syncToCloud, 400));
      document.addEventListener('change', () => setTimeout(syncToCloud, 400));
      document.addEventListener('click', () => setTimeout(syncToCloud, 600));
    } catch (error) {
      console.error('NovelNest account setup failed', error);
      document.querySelector('#account-link')?.classList.remove('ready');
    }
  }

  init();
})();
