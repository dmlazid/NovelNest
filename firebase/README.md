# NovelNest accounts

The site stays on GitHub Pages. Firebase Google Authentication and the default
Cloud Firestore database provide optional account sync. No Analytics SDK,
Cloud Functions, messaging service, or paid backend is enabled by this code.

Firebase project: `novelnest-7d9ca`. The public browser configuration is in
`dist/firebase-config.js`. Google sign-in and the authorized domain
`dmlazid.github.io` must be enabled in Firebase Authentication. When adding a
custom domain, add its hostname to Authentication's authorized domains too.
The owner has published the rules in `firestore.rules` through Firebase Console.
GitHub Pages deployment does not publish Firebase rules.

Each authenticated user reads/writes only `/users/{uid}` with this schema:
`{ version: 1, data: { saved, progress, positions, chapterStatus }, seen }`.
The rules grant ownership by authenticated UID and deny other document paths.
The site stores no passwords or OAuth access tokens in its reading-data document.

Open **My library → Continue with Google**. Existing device-only reading data
remains in the guest library. Use **Add guest reading data** after signing in to
merge it into the account. Signing out restores the guest library. Local caches
and unsent changes remain separately scoped to each account on this browser.
The SDK manages persisted sign-in; use sign out on shared devices.

Sync runs after edits settle for five seconds, at sign-in, on reconnection, and
on window focus after one minute. **Sync now** forces a refresh. Transactions
apply this device's changes to the latest server state. Bookmark removals and
finished-label undo are preserved; newer timestamped reading positions win.
The site can read offline data already loaded in the browser. Unsent data is
retained locally for retry. Clearing browser storage before sync loses unsent
changes, so the JSON backup remains available. Appearance is device-only.

The Updates button reports chapters added to saved novels since their last
acknowledged count. The first use establishes a baseline, so existing chapters
are not reported as new. Chapter metadata refreshes on a new page load. These
are in-site alerts only, not email or phone/background push notifications.

Validation: `node --test scripts/*.test.mjs` and `node scripts/build.mjs`.
Account tests mock only the external Firebase SDK boundary; they cover account
isolation, guest import, offline retry, permission denial and in-flight changes.
A real Google sign-in and second-device sync must also be checked on the deployed
site by the account owner. Never commit service-account credentials.
