# Adding a new novel to NovelHaven

**For the site owner (phone-friendly):** Upload the EPUB to your ChatGPT project conversation, preferably with its original source URL and whether the book is complete or still being updated. You do **not** need to create a Cloudflare D1 database, manually write SQL, or trigger a D1 import for each book.

## Publication flow (keep AdSense and readers safe)

1. **Intake:** Receive EPUB and original source URL (if any). Confirm the uploader has republication rights for the novel and cover; record the title, author, source, and attribution. Do not publicly assert rights or publisher endorsement based solely on having a source URL.
2. **Audit before publication:** Check all EPUB chapter numbers, ordering, chapter bodies, duplicates, weird `#` heading artifacts, missing chapters, metadata, malformed XHTML, and cover availability. If an EPUB is incomplete, verify/obtain additional chapters only where the site owner has publishing rights. Never quietly invent missing novel text.
3. **Cover:** Use an authorized cover if available. If there is no permitted cover image, create an **original** cover matching the title and story, rather than copying another site's cover.
4. **Create novel assets:** Prepare a unique novel ID and collision-free filenames, the catalog metadata, cover, and lazy-loaded chapter chunks. Keep the original teal brand and existing layout. Existing novel catalog and chapter data must never be deleted or overwritten as a side effect of adding another title.
5. **Editorial/quality review:** Confirm the rights record, attribution, accurate descriptions, reader usability, and real reader-facing value. Publication rights alone do not guarantee AdSense approval. Check privacy/policy pages, canonical links, internal navigation and chapter content. Keep newly discovered books from automatic publication until reviewed.
6. **Verify and publish:** Register the novel in `dist/index.html` in the correct script order, run `node --test scripts/*.test.mjs`, `node scripts/build.mjs`, and `node scripts/check-built.mjs` before merging to `main`. Deploy using the existing GitHub Pages workflow and verify the live novel page and chapters.
7. **D1 auto-sync:** Only **after** the novel is included in the published catalog, `.github/workflows/d1-auto-sync.yml` will discover the novel and its chapters during its next scheduled run. No separate manual D1 import per novel is required. This sync is an **independent copy**; the live reader currently serves chapter pages through GitHub Pages.
8. **Future chapter updates:** A source-linked scheduled chapter updater may add missing chapters with resumable checkpoints, but it must not overwrite earlier chapters, re-publish unreviewed titles, or bypass the publication gate. Uploaded static EPUBs do not automatically receive new chapters from the internet without a configured, permitted source updater.

## D1 safety and capacity

- Background sync is scheduled every 6 hours and currently caps each run at 200 chapters.
- Storage is checked before each database write. Import pauses near **380 MiB** to keep well below D1 Free's 500 MB per-database ceiling.
- If the database reaches this limit, the newly published book **still stays readable on GitHub Pages**; the migration is what pauses. Do not delete existing novel data or remove chapter pages to free D1 capacity.
- A multi-database storage plan will be required for the full growing library. Never claim all chapters have been moved into D1 until confirmed.
- The GitHub Actions D1 token is an encrypted repository secret and expires on January 7, 2027. Renew it securely before it expires.

## What the owner should send

**For a new EPUB:** The EPUB file, the original source URL if available, and whether its chapters are complete or ongoing. Existing permission claims can be noted, but a verified record of the right to republish is still required before publishing.

**For a new source-linked novel:** The original story/series URL, confirmation of republication rights, and a status (ongoing/completed). A dedicated, source-respecting updater may need to be configured.

**For updating a novel already published:** Send the EPUB containing new chapters or the permitted original source URL. Ensure novel IDs and chapter numbers are preserved and that new chapters are appended without replacing the existing library.

**Important:** Do not change AdSense publisher IDs, ads.txt, Google verification tags, site policy pages, or Cloudflare Worker bindings merely to add a novel.
