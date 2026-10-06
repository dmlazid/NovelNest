# NovelNest

NovelNest is a static novel library and chapter reader hosted on GitHub Pages.

- Website: https://dmlazid.github.io/NovelNest/
- Repository: https://github.com/dmlazid/NovelNest

## Current collection and reader

The current collection contains **Got a Gallery in the Wild** (ongoing) and **Astral Pet Store** (completed). Chapter counts come from the catalog; the reliability update was checked against 170 and 1,581 chapters respectively.

Readers can search by title, author or genre, filter by status, browse paginated chapter lists, jump between chapters, and adjust appearance, font size, spacing and reading width. Bookmarks, preferences and reading progress are saved in the browser on the current device. The reader also remembers the paragraph and position within each chapter, shows a reading-progress percentage, and provides a Back to top button. Turn off Auto resume in reader settings to start at the top. Positions are kept for the 200 most recently read chapters on this device. There are no accounts or cross-device synchronization.

Chapter lists label each chapter **Unread**, **In progress**, or **Finished**. Opening a successfully loaded chapter marks it in progress. Use **Mark chapter finished** below the chapter navigation to finish it, or **Mark as in progress** to undo that choice. Scrolling or reopening does not erase a finished label. These labels stay on this device even when older exact reading positions leave the 200-chapter position history.

Both novels load chapter text on demand. The homepage downloads chapter titles and metadata, not the full books. Failed chapter requests display a retry button. Ongoing novels show a caught-up message at the latest chapter; completed novels show an ending.

## Edit and check

The editable website is in `dist/`. Node.js 22 is used by GitHub Actions. No npm installation is required.

```sh
node scripts/check.mjs
node --test scripts/*.test.mjs
node scripts/build.mjs
python -m http.server 8000 --directory _site
```

The validator loads both licensed catalogs and all indexed chapter files. It rejects missing files, empty catalogs, missing or duplicate chapter numbers, metadata mismatches, empty text and missing covers. The regression tests cover direct chapter links, chunk boundaries, slow and failed requests, retries, ongoing/completed labels, and invalid chapter data.

`scripts/build.mjs` validates the source and creates `_site/` with content-fingerprinted JavaScript and CSS filenames. An asset manifest gives the chapter loader the matching versioned data URLs. Do not edit or commit `_site/`; it is generated during deployment. Relative URLs support the `/NovelNest/` GitHub Pages path and a future custom domain.

Main files:

| Location | Purpose |
| --- | --- |
| `dist/index.html`, `dist/app.js`, `dist/styles.css` | Page shell, routes and base styling |
| `dist/licensed-ui.js`, `dist/reader-enhancements.css` | Chapter list pagination and reader controls |
| `dist/catalog.js`, `dist/licensed-*.js` | Novel metadata and chapter title indexes |
| `dist/data/` | Chapter text chunks |
| `dist/lazy-chapters.js` | On-demand chapter loading and retry handling |
| `scripts/import_gallery.py`, `scripts/import_astral.py` | Existing authorized-content update routines |

## Automatic chapter checks

The two importer workflows run about every six hours, subject to GitHub scheduling delays. You can also open **Actions**, select an importer, and choose **Run workflow** on `main`.

They install Python dependencies (`requests` and `beautifulsoup4`), check existing data, compare the source chapter count, fetch new chapters if available, regenerate metadata, validate all chapter data again, and commit only successful updates. Requests respect server errors and rate-limit delays. A failed run does not mean new chapters are available; inspect its failed step and logs. Use **Re-run failed jobs** for a transient runner or connection failure.

To run an importer locally after installing its Python dependencies:

```sh
python scripts/import_gallery.py
python scripts/import_astral.py
node scripts/check.mjs
```

Run only the importer you need. Preserve the publishing authorization for all text and cover assets maintained in the repository.

## Publishing

Changes pushed to `main` run checks and the **Publish to GitHub Pages** workflow. Successful importer workflows also trigger publication, because commits made with GitHub's workflow token do not normally trigger another push workflow. GitHub Pages must use **GitHub Actions** as its publishing source.

Publication runs the regression tests, validates every chapter, builds `_site/`, and deploys that folder. The **Check and package website** workflow also saves the built website as a downloadable artifact. A failed check prevents the new build from being deployed.

After an update, refresh the page to load the new catalog. If an old open tab tries to fetch an asset from a previous deployment, its retry message explains when a refresh is needed.
