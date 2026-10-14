# NovelHaven Author Studio — setup and release safety

Authoring pages:
- `/author-studio.html`: Google sign-in, private novel metadata, chapters, submissions, revision
- `/author-admin.html`: owner-only submissions queue and publication decisions
- `/original-novels.html`: editor-approved original manuscripts
- `/original-story.html?id=STORYID`: chapter reader for published originals

**This is a security-gated publishing pilot, NOT a completed AdSense-readiness clearance.** 
No ads load on these routes. All four pages are noindex during the pilot;
dynamic Firebase manuscripts are not yet individually prerendered/crawlable for Google.
Create separate static, indexable versions of reviewed original stories before expecting
them to improve search or AdSense publisher quality.

## Owner activation — REQUIRED before accepting real submissions

1. Open [Firebase Console](https://console.firebase.google.com/) for existing project `novelnest-7d9ca`.
   Check that Google Authentication is enabled and `novelhaven.top` is an authorized domain.
2. Open **Firestore Database → Rules**. Back up the currently deployed rules privately.
   Deploy the reviewed combined rules from `firebase/firestore.rules` (this file).
   GitHub/Cloudflare deployment **does not deploy Firestore rules**.
   The existing `/users/{uid}` account-sync rule stays intact.
3. Open **Authentication → Users** and copy the UID for **your own verified Google account**.
   In **Firestore Database → Data**, create collection `authorAdmins`, document ID
   exactly equal to **your Firebase Auth UID**, and add a harmless field
   `role: "editor"`. Do not paste an API key or passwords into the UID field.
   Client code cannot make itself administrator.
4. Test with two different signed-in accounts:
   - Writer A makes a private draft and saves a chapter; Writer B must not read or alter it.
   - A submits: no edits permitted during review, and anonymous readers cannot see it.
   - Your editor account sees submitted stories and approves or rejects.
   - A rejected story becomes a private editable draft after the author clicks Revise.
   - A published story becomes visible on Original Novels.
5. Do not request an AdSense review based on this pilot alone. Confirm original rights,
   publication consent, age-appropriate content, moderation response and meaningful value
   of existing content. The 102 imported novels still need work-by-work rights reviews.

### Publishing safety

- New novels begin as **private drafts** in Firestore, with separate chapter documents.
- Only users authenticated with Google can create/edit their own stories. Other writers
  cannot read private drafts. Anonymous users can query **published only**.
- The author must attest to authorship or sufficient rights and accept the
  [author guidelines](/author-guidelines.html). The author keeps copyright and grants
  a non-exclusive permission to host and display the submitted work.
- No public posting is automatic: submissions freeze until an authorized editor
  explicitly approves or requests changes. The client refuses approval of manuscripts
  shorter than 300 words; editor must also screen for plagiarism, inappropriate
  material, deceptive titles and other policy issues.
- Drafts and approved stories are **ad-free** in this pilot, and all pilot pages
  are `noindex`. No publisher ID, `ads.txt`, Cloudflare domain, existing novel
  chapter data, or bookmarks are changed.
- Chapter text renders as **text** (not trusted HTML); uploaded executable scripts,
  HTML markup or user-provided CSS are not executed.
- This uses Firestore, **not Cloudflare D1**. No Cloudflare paid plan or new Cloudflare
  database is needed. Firestore quota, Google sign-in setup and Firebase billing
  limits still apply. Monitor database usage and abuse.
- For production at scale, add content reporting, removal requests, rate limits,
  plagiarism screening, abuse moderation, scalable storage, and server-side
  approved-story prerendering. These are not implemented in this first pilot.

## Publishing verification

```bash
node --test scripts/author-publishing.test.mjs
node --check dist/author-publishing.js
node --check dist/author-core.mjs
```

After manually deploying Firestore rules, check the live author routes on a
phone before inviting authors. If Firebase permission is denied, the site shows
a setup-required error instead of falsely claiming a chapter was saved.

For takedown or copyright inquiries, see the existing
`/copyright.html` and `/contact.html` policies.
