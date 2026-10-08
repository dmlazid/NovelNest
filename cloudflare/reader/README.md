# Cloudflare reader staging

Build with `NOVELNEST_CLOUDFLARE=1 node scripts/build.mjs`, then run `node scripts/check-cloudflare-build.mjs`.

The build retains the same public routes, application scripts, AdSense publisher code, Google verification, ads.txt and policy documents. Chapter pages are generated on request from the five existing D1 databases. The remaining static assets occupy about 36 MB rather than repeating the reader shell across more than 117,000 files. Missing or unavailable D1 chapters return a 503 without ad code.

No domain route is configured and no Worker is deployed by this commit. Do not cut over on row counts alone: finish copying, compare every source chapter title and paragraph array with its D1 row, confirm all novel-to-shard routes, then deploy this isolated `novelhaven-reader` Worker to workers.dev for a browser check. Only after those checks should novelhaven.top be assigned. Retain the existing GitHub Pages deployment until that succeeds.

`d1-fast-migration.yml` copies up to 4,000 chapters every 20 minutes, in batches of at most 25, subject to a persistent UTC daily write reservation and per-database capacity guards. Every inserted batch is read back. The daily ledger reserves 10,000 writes for preceding activity and caps total reservations at 80,000, leaving additional room below the free 100,000 account limit. Interrupted batches retain their reservation and resume without overwriting existing data. Actual account activity outside this importer can still consume the remaining allowance.

All source download workflows and the old D1 scheduler are paused. Remove their temporary `if: false` conditions only after verified migration/cutover and after ensuring the old D1 scheduler stays superseded. No paid plan, R2 bucket, or billing changes are introduced.
