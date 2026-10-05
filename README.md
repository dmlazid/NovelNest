# NovelNest

A responsive novel catalog and chapter reader. Plain HTML, CSS, and JavaScript; no build process or paid service is required to serve the website.

## Included

- Search by title, author, or genre; genre and completion filters; sorting.
- Novel details and chapter lists.
- Previous/next chapter navigation and valid shareable hash links.
- Device-local bookmarks, last-opened chapters, and continue reading.
- Light, sepia, and night appearance; adjustable reader text size.
- Three original sample stories (nine complete short chapters) and original generated cover artwork.
- A clearly marked external listing for Got a Gallery in the Wild, with an original brief summary and a link to read on FreeWebNovel. No chapters or cover art from that website are stored here.
- Catalog checks and downloadable website artifact on every main-branch push.

## Content and limitations

The on-site chapters are **demonstration content**, not licensed novels imported from another service. External listings have zero hosted chapters and show a labeled outbound reading button. No FreeWebNovel story text, branding, or covers were copied. Add only titles you own or are authorized to publish. Record the permission in each novel's `license` object, and do not commit confidential agreements into a public repository.

This first version has no accounts, author submissions, ratings, payment system, or admin dashboard. Reader data stays in the browser and does not sync between devices. Google Fonts is the only external font dependency; system fallbacks work without it. All cover images are local.

## Preview locally

From the repository root:

```sh
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080` in your browser.

Check the catalog and JavaScript before publishing:

```sh
node scripts/check.mjs
```

## Add licensed novels

Edit `dist/catalog.js`. Each novel has a stable URL-friendly `id`, a title, author, main `genre`, a `tags` list, `status` (`Completed` or `Ongoing`), a local `cover`, an ISO `updated` date, a `synopsis`, a `license` record, and a `chapters` array. Each chapter contains a title and plain-text paragraphs. Counts come from the real chapter array.

For an external listing, provide `externalUrl` (HTTPS, approved host), `externalSource`, a brief original summary, and an empty `chapters` array. It uses a neutral typographic placeholder instead of the external work’s cover. External entries support browsing, search, and bookmarks but never report local reading progress or provide local chapter links.

The homepage and about text distinguish sample stories from external reading links. When replacing the samples with licensed titles, update those descriptions in `dist/app.js`, the featured picks, and the `sample` labels to match the actual catalog. Keep the first two featured records until those homepage selections are updated. Never insert raw HTML from content sources.

## GitHub Pages

1. Put this project in a new repository.
2. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
3. In **Actions**, open **Publish to GitHub Pages** and select **Run workflow**.
4. Future pushes to `main` publish automatically after validation. You can also run the workflow manually.

The separate **Check and package website** workflow runs on each push to `main`. Its `NovelNest-website` artifact contains the complete static website. Relative asset links and hash routes work under a repository subdirectory without a custom domain.

The `.openai/hosting.json` file is for the private Sites preview; GitHub Pages publishes only `dist/` and does not need that file.

## Project structure

- `dist/index.html`: page shell and metadata
- `dist/styles.css`: responsive design
- `dist/app.js`: catalog browsing, routing, and reader
- `dist/catalog.js`: original sample catalog and chapters
- `dist/assets/`: original generated cover artwork
- `scripts/check.mjs`: catalog/asset checks
- `.github/workflows/`: validation, artifact packaging, and optional Pages publication

## Verification

Catalog structure, local cover paths, chapter data, and JavaScript syntax are checked by `scripts/check.mjs`. Route rendering, search/filter outcomes, bookmark persistence, reading progress, settings, malformed routes, and escaped search text were also checked in a JavaScript harness during creation. Interactive browser/visual QA was unavailable in the creation environment. The optional browser WebMCP catalog-search registration is feature-detected and was not verified in a supported browser context.
