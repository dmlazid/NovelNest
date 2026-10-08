# NovelHaven D1 migration — safe first stage

**Status:** The user created the D1 database `novelhaven-chapters-01`, its `chapters` table, and the independently deployed Worker `novelhaven-chapters-api` with the `DB` binding. The Worker returned `{"error":"Chapter not found"}` for an empty database. As of the user's 2026-10-08 console screenshot, `SELECT COUNT(*) FROM chapters;` returned **0**.

This directory and the `Plan or import D1 chapter pilot` GitHub Actions workflow prepare a **small, non-destructive pilot**. GitHub remains the source of truth for both novel text and the existing static, crawlable chapter pages. **No live-site reader, publisher ID, verification tag, ads.txt, domain, or automatic-novel publication setting is changed.**

## Safety controls

- The workflow defaults to **plan**, never imports by itself, and only executes remote SQL when manually dispatched with **mode = import**.
- Chapter selection is limited to **25 at a time**. Start with **5 chapters** and verify their content first.
- Every selected chapter must match its published novel ID, catalog metadata, chapter number, and source chunk. Broken source data fails closed.
- Exported SQL uses escaped, idempotent `INSERT ... ON CONFLICT ... DO UPDATE`. Repeating a batch cannot duplicate chapter rows.
- Every SQL statement must remain at or below **95,000 bytes** (conservative vs. D1's 100 KB maximum), and JSON row data must remain below 1.9 MB (conservative vs. D1's 2 MB row maximum).
- The workflow tests the SQL with a disposable local SQLite database twice before any possible remote write.
- Generated chapter text is **never uploaded as a GitHub Actions artifact**; only a small count/size summary is uploaded.
- The Cloudflare API token is read exclusively from encrypted GitHub Actions secrets. **Never paste it into an issue, commit, chat, or website.**
- Importing D1 content does **not** change the existing Cloudflare Worker code or route NovelHaven traffic to it.

## Start with plan (no Cloudflare token needed)

1. Open [Plan or import D1 chapter pilot](https://github.com/dmlazid/NovelNest/actions/workflows/d1-chapter-pilot.yml).
2. Choose **Run workflow** on `main`.
3. Keep the defaults: novel ID `farming-cultivating-immortality`, start `1`, count `5`, mode `plan`.
4. Check that the test, SQL generation and local SQLite verification steps all pass. Inspect the `novelhaven-d1-pilot-report` summary artifact.

## Before any remote import (one-time private setup)

Cloudflare CI needs a **scoped Cloudflare API token and the account ID**. Obtain the account ID from the Cloudflare dashboard, and create a token with **Account → D1 → Edit** permission limited to the correct Cloudflare account. Do not grant global Worker or DNS permissions for this import.

In GitHub, open the repository's **Settings → Secrets and variables → Actions → New repository secret**, then save:

- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN` — scoped token from Cloudflare.

No token is needed for the plan workflow. Once these secrets are saved, manually run the workflow with the same small batch, but choose **mode = import**. It will use Wrangler's official remote D1 SQL import and will not deploy or modify the Worker.

## Verify after an import

Run this in the [D1 SQL Console](https://dash.cloudflare.com/) (under `novelhaven-chapters-01`):

```sql
SELECT COUNT(*) AS total_chapters FROM chapters;
SELECT chapter_number, title FROM chapters
WHERE novel_id = 'farming-cultivating-immortality'
ORDER BY chapter_number LIMIT 5;
```

The pilot should add **5 chapters** (unless the database already contained those rows). Test the published API independently:

https://novelhaven-chapters-api.dmlarquillano.workers.dev/chapter?novel=farming-cultivating-immortality&number=1

It should return Chapter 1 text; compare with the existing NovelHaven reader before importing more or switching traffic.

## Free-tier limitations

Cloudflare D1 Free has **500 MB per database**, **5 GB total across up to 10 databases**, and limits on SQL statement and row sizes. Existing source chapter JavaScript files were previously measured at substantially more than one database's capacity. **Do not bulk import all novels into this single database.** Plan partitioning and capacity monitoring before expanding beyond a pilot. Some individual chapters may exceed SQL limits and will be intentionally rejected rather than silently truncated.

After verification, a separate release may add database partitioning, automated resumption, storage monitoring, and a tested live-reader fallback. **No AdSense approval can be guaranteed from this storage migration.**

Documentation:
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
