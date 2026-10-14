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
- Author Studio keeps **device-only recovery copies** of unsaved chapter text as the
  writer types. These are keyed by signed-in writer ID and story. After a crash,
  the writer chooses **Restore writing** or **Discard backup**. An account save
  still requires pressing **Save Chapter**. The recovery copy clears after
  Firestore confirms that the chapter was saved. Mobile browser storage can
  be deleted and is not a private encrypted vault on shared devices.
- Submitting a novel is blocked while that device contains unsaved chapter
  edits. This prevents accidentally submitting an earlier cloud draft.
- The editor can **unpublish an approved story** if a rights or content complaint
  arrives. The editor must record a reason, and the manuscript remains
  available privately to the author. The public reader has a reporting email.
- Chapter text renders as **text** (not trusted HTML); uploaded executable scripts,
  HTML markup or user-provided CSS are not executed.
- This uses Firestore, **not Cloudflare D1**. No Cloudflare paid plan or new Cloudflare
  database is needed. Firestore quota, Google sign-in setup and Firebase billing
  limits still apply. Monitor database usage and abuse.
- For production at scale, add automated reporting queues, removal requests, rate limits,
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

## Release 2 testing and deployment

- Writer A starts a chapter, types text, refreshes the tab and chooses
  **Restore writing**. Saving the chapter then clears the local backup.
  Writer B on the same device must never be offered Writer A's backup.
- Test that an unsaved local recovery copy prevents submission. Confirm that
  a failed Firestore save leaves the recovery copy intact.
- As the configured administrator, publish an approved test manuscript,
  then unpublish it with a clear reason. Anonymous visitors must no longer
  read it; the author can still access it privately.
- Run `node --test scripts/author-draft-recovery.test.mjs scripts/author-publishing.test.mjs`.
- Deploy the revised `firebase/firestore.rules` in Firebase Console yourself.
  **GitHub Actions and Cloudflare do not deploy those Firebase rules.**

All Author Studio pilot pages remain ad-free and noindex. The pilot does not
resolve publication rights for pre-existing imported novels or itself qualify
NovelHaven for AdSense approval.
