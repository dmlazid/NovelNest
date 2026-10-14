# NovelHaven — Smart Moderation v1 (2026-10-14)

Repository: https://github.com/dmlazid/NovelNest
Site: https://novelhaven.top/
Firebase project: `novelnest-7d9ca`

## Shipped in GitHub

- `moderation-bot/scan.mjs`: deterministic private draft, chapter, submission and published-story screening (word counts, completeness, obvious duplicate chapters, unusual external-link volume).
- `moderation-bot/run.mjs`: server-side Firebase Admin job. Processes up to 100 stories per scheduled run, up to 300 chapters per story. Rotating cursor covers the remainder on subsequent runs. Keeps fingerprinted, editor-only `moderationReviews/{storyId}` reports without persisting manuscript text.
- `.github/workflows/author-moderation.yml`: scheduled on GitHub Actions twice an hour and manually runnable. Does nothing with a visible activation note until the service-account secret exists.
- `moderation-bot/scan.test.mjs`: offline deterministic screening tests.
- `dist/moderation-dashboard.js` and `dist/author-moderation.css`: teal/cream Smart Moderation Center in the existing verified editor dashboard with results, warnings and automatic decision history.
- `dist/author-publishing.js`: read-only private draft inspection (without approve/reject controls) alongside submitted and published queues. Existing human approval, rejection, takedown, protected edits, account sync, bookmarks and published reading remain intact.
- `firebase/firestore.rules`: only verified `authorAdmins` editors may read reports/history; web users cannot create, change or erase bot reports or credentials. Existing `users` / original publishing permissions preserved.
- Author Studio and Privacy page now disclose that saved private manuscripts may be screened by a restricted moderation service or an authorized editor.

## Automatic decisions

1. Private drafts: **screen only**. They remain private and unmodified. The bot cannot publish a draft.
2. Submitted stories with objective missing requirements (e.g. no saved chapters, insufficient chapter words, missing rights confirmation): **automatically return for revision**, with an explanatory editor note and an audit event.
3. Submitted stories that pass basic checks: **remain in the human-review queue** unless the owner explicitly preapproved their author UID in the GitHub Actions variable `NOVELHAVEN_TRUSTED_AUTHOR_UIDS`. Only then is eligible automatic publication permitted. Default is **no trusted author UIDs**.
4. Published stories: re-screen and **flag potential problems** for the owner. No automatic takedown on uncertain keyword/link heuristics.
5. The owner keeps approval, rejection, takedown and review controls. The scanner cannot determine whether text is original, licensed or safe in context. A basic pass is **not** a rights or policy certification.

## Required owner activation (NOT yet completed by repository commits)

1. **Publish the new Firestore rules**: Firebase Console → `novelnest-7d9ca` → Firestore Database → Rules. Replace with the reviewed repository file `firebase/firestore.rules`, then Publish. Do not remove the existing `users` rules.
2. **Enable unattended access**: Firebase Console → Project settings → Service accounts → Generate new private key. In GitHub repository → Settings → Secrets and variables → Actions → New repository secret, create `NOVELHAVEN_FIREBASE_SERVICE_ACCOUNT` and paste the entire JSON file content as its value. **Never commit or send this private key in a chat, issue or public file.** Keep the JSON only in GitHub's private encrypted secret.
3. GitHub → Actions → **NovelHaven author moderation** → Run workflow. Confirm the job completes and reports appear in the Owner Dashboard. Without the secret, the workflow safely skips database access and reports the missing setup.
4. Optional: If the owner later wants certain author UIDs to publish automatically, add **Actions variable** `NOVELHAVEN_TRUSTED_AUTHOR_UIDS` with their comma-separated exact Firebase UIDs. Leave this unset until author rights and quality have been personally verified.

This setup can use GitHub Actions and existing Firebase Firestore without a Cloud Functions deployment. GitHub schedules are best-effort, so runs are not guaranteed to start precisely at the cron minute. Firebase service-account credentials grant powerful database access and must stay secret.

## Verification status

GitHub source updates and regression-test files committed. Database activation, actual Actions execution, live authenticated owner screen, and production rule publication **have not yet been verified**. Do not mark the bot active until steps 1–3 are completed and verified.
