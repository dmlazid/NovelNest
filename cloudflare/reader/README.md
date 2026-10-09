# Cloudflare reader staging

Build with `NOVELNEST_CLOUDFLARE=1 node scripts/build.mjs`, then run `node scripts/check-cloudflare-build.mjs`.

The build retains the same public routes, application scripts, AdSense publisher code, Google verification, ads.txt and policy documents. Chapter pages are generated on request from the five existing D1 databases. The remaining static assets occupy about 36 MB rather than repeating the reader shell across more than 117,000 files. Missing or unavailable D1 chapters return a 503 without ad code.

No domain route is configured and no Worker is deployed by this commit. Do not cut over on row counts alone: finish copying, compare every source chapter title and paragraph array with its D1 row, confirm all novel-to-shard routes, then deploy this isolated `novelhaven-reader` Worker to workers.dev for a browser check. Only after those checks should novelhaven.top be assigned. Retain the existing GitHub Pages deployment until that succeeds.

`d1-fast-migration.yml` copies up to 4,000 chapters every 20 minutes, in batches of at most 25, subject to a persistent UTC daily write reservation and per-database capacity guards. Every inserted batch is read back. The daily ledger reserves 10,000 writes for preceding activity and caps total reservations at 80,000, leaving additional room below the free 100,000 account limit. Interrupted batches retain their reservation and resume without overwriting existing data. Actual account activity outside this importer can still consume the remaining allowance.

All source download workflows and the old D1 scheduler are paused. Remove their temporary `if: false` conditions only after verified migration/cutover and after ensuring the old D1 scheduler stays superseded. No paid plan, R2 bucket, or billing changes are introduced.

## Automatic completion check

After the last copy batch, GitHub automatically runs `scripts/audit-d1-content.mjs`. It checks every source title and paragraph array, chapter number, and persisted reader route across all five databases. Missing, extra, corrupt or incorrectly routed chapters block success. It writes no chapter data. The report includes a content digest and verification time, and still leaves `cutover_ready: false` until deployment checks are complete.

A successful report is cached against the exact source files and audit code so later scheduled runs stop scanning the entire database. Changing source chapters invalidates the cache. This cache records a past verification; it is never accepted as current database proof for deployment. Redundant count scans have been removed to conserve the daily free read allowance.

## Preview deployment from GitHub

Run **Verify and deploy Cloudflare reader preview** in Actions once copying is finished and Worker access works. It performs a fresh full audit, builds and checks the advertising/policy files, then deploys only the isolated `novelhaven-reader` workers.dev address. It does not configure domain routes or move novelhaven.top. Browser verification and a separate reviewed domain change are still required before resuming source downloads.

The existing API token currently accesses D1, but Worker settings return HTTP 403 and novelhaven.top is not visible in its zone results. Repository code cannot grant Cloudflare permissions. In Cloudflare, update the existing token or create a token for the correct account with **Workers Scripts: Edit**, retain **D1: Edit**, and use **Zone: Read** and **Workers Routes: Edit** scoped to novelhaven.top when preparing domain cutover. Verify the domain belongs to the selected account. Update the `CLOUDFLARE_API_TOKEN` Actions secret in GitHub if the token value changes; never commit or paste the token into an issue/chat. Keep `CLOUDFLARE_ACCOUNT_ID` aligned with the five existing databases. Cloudflare's official GitHub Actions guide: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ .
