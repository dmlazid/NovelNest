# NovelNest Project Guide

This file contains the longer technical/project documentation moved out of the main repository README.

## Reading and discovery

- Browse latest novels, latest releases, completed novels, genre pages, or the Novel Finder.
- Search by title, author, or genre and filter the collection.
- Open a novel's summary and paginated chapter list, jump to a chapter, or use previous/next navigation.
- Adjust reading appearance, text size, spacing, and width. The reader supports scroll and page modes.
- Resume the saved paragraph and position within a chapter; use **Back to top** or disable **Auto resume** when preferred.
- Track chapters as **Unread**, **In progress**, or **Finished**. **Mark chapter finished** and **Mark as in progress** let readers change the status explicitly.
- Read original guides in the **Reading Desk**. About, contact, privacy, terms, editorial, licensing, and copyright pages are linked in the footer.

The original teal appearance is retained. Chapter text loads on demand, with a retry control for failed requests. Ongoing stories show a caught-up message; completed stories show an ending.

## Accounts, bookmarks, and notifications

Open the menu and choose **My account → Continue with Google**, or continue reading as a guest. Firebase Authentication handles Google sign-in; Firestore stores each signed-in reader's own reading data.

Signed-in accounts synchronize bookmarks, chapter progress, reading positions, and chapter status across devices. Guest reading data stays on the current device and remains separate from account data. After signing in, **Add guest reading data** can copy existing guest bookmarks and progress into the account. Signing out restores the guest library. Appearance preferences stay local.

**Your Library** contains bookmarks and reading history. The notification bell shows newly available chapters for bookmarked novels when readers visit or refresh the site. These are in-site alerts, not email or browser push notifications.

Offline changes stay on the device and can sync when connectivity returns. Recent exact reading positions are limited to 200 chapters. The former Backup & restore interface has been removed; `backup.js` remains an internal reading-data helper used by account synchronization.

## Project files

| Location | Purpose |
| --- | --- |
| `dist/index.html`, `dist/app.js`, `dist/styles.css` | Website shell, routes, catalog views, and base design |
| `dist/licensed-ui.js`, `dist/reader-enhancements.css` | Chapter pagination and reader controls |
| `dist/catalog.js`, `dist/licensed-*.js` | Novel metadata and chapter indexes |
| `dist/data/` | Chapter text chunks |
| `dist/assets/` | Locally hosted cover images |
| `dist/lazy-chapters.js` | On-demand chapter loading and retry handling |
| `dist/reading-position.js`, `dist/chapter-status.js` | Reading position and chapter labels |
| `dist/accounts.js`, `dist/account-sync.js`, `dist/firebase-config.js` | Google sign-in, library synchronization, and chapter alerts |
| `firebase/` | Firebase setup and access rules |
| `dist/*.html`, `dist/sitemap.xml`, `dist/robots.txt` | Standalone information pages and discovery metadata |
| `dist/CNAME` | Custom domain configuration |
| `scripts/import_*.py` | EPUB import and source update routines |
| `scripts/run_novel_catchup.sh` | Checkpointed catch-up runner |
| `.github/workflows/` | Checks, import schedules, and GitHub Pages deployment |

## Edit, check, and preview

The editable website is in `dist/`. GitHub Actions uses Node.js 22. No npm installation is required.

```sh
node scripts/check.mjs
node --test scripts/*.test.mjs
node scripts/build.mjs
python -m http.server 8000 --directory _site
```

Open http://localhost:8000/ for the local preview. The validator checks all registered catalogs, chapter sequences, metadata, text, and referenced assets. Reader and account regression tests cover navigation, chunk boundaries, retries, reading progress, and synchronization.

`scripts/build.mjs` generates `_site/`, fingerprints JavaScript and CSS, and supplies the chapter loader with the asset manifest. Do not edit or commit `_site/`; deployment rebuilds it from `dist/`.

For AkkNovel importer development:

```sh
python -m pip install requests beautifulsoup4 Pillow
python -m unittest discover -s scripts -p 'test_akknovel_covers.py'
```

AkkNovel covers are selected from the image matching the novel title, decoded and validated, then saved as real JPEG files. The site's generic social-sharing logo is not a book cover.

## Automatic chapter updates

Eight importer workflows cover the FreeWebNovel and AkkNovel series. They are scheduled approximately every six hours, subject to GitHub scheduling delays. To check a specific source, open **Actions**, select its importer, and choose **Run workflow** on `main`.

Large catch-up runs save progress in checkpoints. A checkpoint committed to GitHub is not necessarily live yet: the Pages deployment must finish. Importers may still be catching up even when the last published site is working. A failed updater can leave earlier successful checkpoints intact; inspect the failed step before retrying.

The EPUB importer accepts files supplied by the owner and validates chapter numbering before publication. Run `python scripts/import_epub.py --help` for its options. Preserve publication permission for both novel text and cover assets, and do not invent missing chapters or mark a partial import as a complete story.

## Publishing and troubleshooting

Pushes to `main` trigger **Check and package website** and **Publish to GitHub Pages**. Completed importer runs also trigger publication, including runs that saved checkpoints before failing or being cancelled. Pages checks out current `main`; all tests and the build must pass before deployment. An active deployment finishes while newer updates wait, preventing update jobs from repeatedly cancelling publication.

GitHub Pages uses **GitHub Actions** as its publishing source. The custom domain is `novelhaven.top`. The check workflow saves the built site as a downloadable artifact.

If an update is missing:

1. Check that the importer committed its changes.
2. Check **Publish to GitHub Pages** for a successful deployment after those changes.
3. Refresh the website to load its latest catalog.
4. For a chapter load error, use **Try again**; refresh if the open tab belongs to an older deployment.

For account errors, check the status message under **My account**. Firebase must authorize the website domain, and Firestore rules must restrict each reader to their own account data. Keep Google sign-in, existing advertising configuration, and the teal design intact when making unrelated updates.
