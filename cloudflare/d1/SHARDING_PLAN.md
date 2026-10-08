# NovelHaven D1 free-tier expansion plan

**Status: assessed, not provisioned.** This plan does not change the live website, AdSense, Worker routes or existing database bindings.

## Verified baseline — October 8, 2026

- Published library: **90 novels, 88,858 chapters** at the audit time.
- Existing published chapter source files: **724,874,273 bytes**.
- Conservative projected D1 footprint: **1,349,405,793 bytes**. Estimated from source bytes with a 1.7 multiplier, 256 bytes/chapter and 1 MiB/novel. **This is not actual D1 storage.**
- Simulation using **300 MiB per database** suggests **five D1 databases** for the published library (subject to actual SQL storage overhead and continued chapter growth).
- Live Cloudflare API inventory found **one existing database**, with **163,840 bytes** stored. Under a hypothetical Free plan, that leaves **nine database slots**, enough for four additional NovelHaven databases.
- Original database contains **nine verified chapter rows**. The existing reader still uses GitHub Pages.
- Audit passed all tests and completed both Cloudflare read-only inventory requests and source size estimation: https://github.com/dmlazid/NovelNest/actions/runs/37768574387.

Cloudflare Free currently allows **10 D1 databases, at most 500 MB each and 5 GB across the account**. The existing importer stops at **380 MiB** per database. Official reference: https://developers.cloudflare.com/d1/platform/limits/.

## One-click GitHub preparation (default: no changes)

[Prepare extra NovelHaven D1 databases](https://github.com/dmlazid/NovelNest/actions/workflows/d1-shard-setup.yml) is installed. On a code push it runs a **read-only plan**. To create the four empty extra D1 databases, the owner must explicitly open the GitHub workflow, choose **Run workflow**, branch **main**, and set **mode = provision**. A fresh D1 account inventory and Free-slot check run first, and repeated runs do not create duplicate databases. It initializes the standard chapters table in each newly created database and saves their UUIDs as a short-lived GitHub Actions artifact.

**This has NOT yet been run in provision mode.** Creating empty databases does not move existing chapters or change the public reader. The multi-database importer and safe Worker routing must be tested in a separate follow-up before any public chapter fetching changes.

## Safe rollout stages

1. **Preserve the original system.** Continue using the original D1 database for existing capped imports; keep GitHub chapters, static pages and their URLs untouched.
2. **Add four more databases safely, later.** Intended names: novelhaven-chapters-02, -03, -04 and -05. Before provisioning, check available account slots and name collisions again. Create the same chapters schema on each new database. Creating empty databases alone does not migrate data.
3. **Create stable import routing.** Existing chapters have already been copied to database 01. Do not blindly hash existing titles to a new shard. Use versioned per-novel/chapter-range assignments or a verified index, preserving the ability to find original rows and allowing new novels to be added later.
4. **Test cross-database imports.** Keep caps on batch sizes, physical database usage and Cloudflare quotas, and provide retries and clear reports for skipped or oversized chapters. Import a pilot to the new databases before scheduling bulk migration.
5. **Test multi-database Worker reads privately.** Only after reliable lookup and fallbacks are proven should a carefully controlled live reader switch be considered. Do not redirect the domain or remove the original GitHub chapter pages.
6. **Preserve website and AdSense.** No changes to the teal design, URLs, AdSense publisher code, ads.txt, Google verification, or privacy/policy pages. Keep existing source files for safe rollback.

## Monitoring

The [automatic D1 GitHub Actions workflow](https://github.com/dmlazid/NovelNest/actions/workflows/d1-auto-sync.yml) now records read-only Free-capacity estimates, current account database count, remote D1 chapter totals and import status. Code-push runs are plan-only; scheduled imports are capped. The current Cloudflare API token is expected to expire on **January 7, 2027**, and must be renewed securely beforehand.

New novels still require the editorial publication check, and only published authorized chapters are eligible for background D1 migration.

**No extra databases have been created yet.** Public NovelHaven remains on GitHub Pages.
