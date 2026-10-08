# NovelHaven Firebase security: public web API key

The client configuration in `dist/firebase-config.js` belongs to Firebase project
`novelnest-7d9ca`. The `apiKey` is a **Firebase Web API key**, which identifies
the Firebase project; it is not a server/admin credential and must be present in
the browser for Google sign-in and reading-list sync. Do not remove it, substitute
a dummy string, or just move the same value into a frontend build secret to silence
GitHub secret scanning: the browser still needs it.

Firebase's official guidance:
https://firebase.google.com/docs/projects/api-keys

## Required owner checks in the consoles

1. In [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials),
   select project `novelnest-7d9ca` and open the browser API key corresponding
   to `dist/firebase-config.js`. **Do not paste the key into support chats.**
2. Verify that **API restrictions** limit the key to Firebase-related APIs
   required for Authentication, not arbitrary Google Cloud APIs or any
   Gemini/Generative Language API, Maps, or other billable API.
   See Firebase's linked required-API guidance above. Take care not to disable
   Authentication's required endpoints.
3. Review **application restrictions** for `novelhaven.top` and any actual
   alternative website origins that need Google sign-in, including an active
   GitHub Pages domain, if applicable. Changing referrer restrictions can
   disrupt sign-in; verify with a test account after adjusting.
4. In [Firebase Console](https://console.firebase.google.com/), verify Google
   sign-in is enabled and `novelhaven.top` is listed under **Authentication →
   Settings → Authorized domains**. These domains are a separate setting from
   the Google Cloud API key restrictions.
5. Under **Firestore Database → Rules**, verify that the rules actually
   deployed are as restrictive as `firebase/firestore.rules`: authenticated
   users should read/write only their own `/users/{uid}` document.
   GitHub Pages deployment **does not deploy** Firebase security rules.
   Review Firebase App Check for abuse protection where supported, and monitor
   usage/quota and suspicious authentication activity.
6. Test Google sign-in, sign-out and two-device saved-book sync after any
   restriction or key rotation. Do not delete the old key until the new
   browser configuration is live and verified.

If the key is actually unrestricted, shared with a non-Firebase service, or
shows suspicious usage, restrict it immediately and rotate it through Google
Cloud if necessary, updating `dist/firebase-config.js` and verifying the
live build. Removing a previously committed value does not erase Git history.

## GitHub secret-scanning alert

GitHub can flag this public-by-design Firebase Web API key as a `Google API Key`.
That alert alone does not establish a breach. **Only after** the console checks
above confirm this is a properly restricted Firebase client key, review the
alert in **Security and quality → Secret scanning → alert #1** and dismiss it
with the truthful reason offered by GitHub (typically a false-positive/
not-a-secret category). Do not mark an actually exposed server key safe.

The regression test in `scripts/firebase-security.test.mjs` checks the checked-in
rules and the browser config for obvious regressions. It cannot audit real
Google Cloud key restrictions or currently deployed Firestore rules.

No AdSense, advertising disclosure, chapter content, publication, or Pages
deployment settings are changed by this documentation.
