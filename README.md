# NovelNest

NovelNest is a responsive static novel reader built with plain HTML, CSS, and JavaScript and published through GitHub Pages.

## Current catalog

The site currently contains one authorized on-site novel:

- **Got a Gallery in the Wild** — 170 chapters, ongoing.

The novel is presented with its local cover, chapter list, latest chapters, chapter reader, previous/next navigation, local bookmarks, reading progress, and light/sepia/night reading modes. The published website does not provide an EPUB download.

## Content permission

The site owner has confirmed permission to publish the hosted novel. The catalog records that publication as an authorized edition. Keep permission records private when they contain confidential information; the public repository only stores the publication note.

## Project structure

- `dist/index.html` — page shell and script loading
- `dist/styles.css` — responsive site and reader styles
- `dist/app.js` — routing, catalog UI, library, and reader
- `dist/licensed-gallery.js` — licensed novel metadata
- `dist/data/gallery-chapters-*.js` — 170 chapter data split into 10 files
- `dist/assets/got-a-gallery-in-the-wild.jpg` — local cover
- `scripts/check.mjs` — catalog and asset validation
- `scripts/import_gallery.py` — manual authorized chapter refresh tool
- `.github/workflows/pages.yml` — GitHub Pages publishing
- `.github/workflows/import-gallery.yml` — manual chapter refresh workflow

## Preview locally

```sh
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`.

## Validate

```sh
node scripts/check.mjs
```

## GitHub Pages

In **Settings → Pages**, use **GitHub Actions** as the source. Updates pushed to `main` are published automatically by the Pages workflow.
