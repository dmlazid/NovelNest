# NovelNest · NovelHaven

**NovelHaven** is a web-novel library and chapter reader at **https://novelhaven.top/**, hosted on GitHub Pages. The existing teal design and public reading URLs are kept.

**Quick access:** [Visit NovelHaven](https://novelhaven.top/) · [GitHub Actions](https://github.com/dmlazid/NovelNest/actions) · [Latest updates](./updates/2026-10-08/README.md) · [Project guide](./docs/project-guide.md)

## Project status

| Area | Latest verified status |
| --- | --- |
| Website hosting | **GitHub Pages** on `novelhaven.top` — no host or URL redirect |
| Site build and deployment | **Passed** in latest checked runs on October 8, 2026 |
| Published novels | **90** at the October 8 migration audit |
| Published chapters | **88,858** at the October 8 migration audit; updates continue |
| Automatic chapter updates | Existing authorized novels continue in resumable GitHub Actions checkpoints |
| New novel discovery | Candidates may be discovered automatically; **new-title publication is held for quality review** |
| Cloudflare D1 | **9 chapters stored in 1 database**, as last verified; independent of the public reader |
| Automatic D1 imports | Scheduled, limited to **200 chapters per run**, with safety checks and reports |
| Extra D1 databases | **4 additional databases planned, not created yet** — manual approval required |
| AdSense | Application/settings/publisher files deliberately **untouched** by migration work |

*Counts are snapshots, not live counters. Open the GitHub Actions run summaries for updated database totals.*

## Important workflows

| Task | Where to check |
| --- | --- |
| Website builds and publishing | [Check all deployments](https://github.com/dmlazid/NovelNest/actions) |
| Automatically copy published chapters to D1 | [D1 chapter auto-sync](https://github.com/dmlazid/NovelNest/actions/workflows/d1-auto-sync.yml) |
| Check database storage and available Free-tier slots | [D1 capacity and account audit](https://github.com/dmlazid/NovelNest/actions/runs/37768574387) |
| Prepare additional empty databases (**plan-only by default**) | [D1 database setup](https://github.com/dmlazid/NovelNest/actions/workflows/d1-shard-setup.yml) |
| Initial 5-chapter import and verification | [D1 import pilot](https://github.com/dmlazid/NovelNest/actions/workflows/d1-chapter-pilot.yml) |

The D1 migration does **not** redirect readers, modify the GitHub-hosted chapters, or change the original Cloudflare Worker automatically. Database storage is checked before imports, with a **380 MiB stop threshold** for the current D1 database. A preliminary capacity analysis estimates roughly **five D1 databases** for the existing library; that is a planning estimate, not completed migration.

Details: [Cloudflare D1 migration](./cloudflare/d1/README.md) · [Safe multi-database rollout plan](./cloudflare/d1/SHARDING_PLAN.md)

## Adding or updating a novel

Send the **EPUB file**, the **original novel link**, or **both** in ChatGPT.

- **EPUB:** For an initial chapter import, chapter-order checks, and missing-chapter audit.
- **Link:** For verifying the licensed source and configuring future chapter updates when permitted.
- **EPUB + link:** Best for ongoing novels with downloadable initial chapters.

New titles are checked before publication. Once published in the NovelHaven catalog, they are automatically eligible for D1 chapter syncing; you do **not** need to import each novel into Cloudflare manually. The scheduled D1 sync only copies already-published chapters: it does not collect new content from novel source sites.

See the [new-novel upload checklist](./docs/adding-novels.md).

## Repository folders

| Folder | Contents |
| --- | --- |
| [`dist/`](./dist/) | Live website code, covers, novel catalogs, and published chapter chunks |
| [`scripts/`](./scripts/) | EPUB/source importers, D1 migration tools, safety tests, and build checks |
| [`.github/workflows/`](./.github/workflows/) | GitHub Actions for updating, testing, publishing, and D1 migration |
| [`cloudflare/d1/`](./cloudflare/d1/) | D1 setup, capacity audit details, and migration plan |
| [`firebase/`](./firebase/) | Reader sign-in and account-sync configuration |
| [`docs/`](./docs/) | Longer how-to guides and project details |
| [`updates/`](./updates/) | Dated change logs and batch history |

## Updates and safeguards

Major changes are recorded in dated folders, starting with [updates/2026-10-08](./updates/2026-10-08/). Automatic import runs may update chapters while their final publication is still pending. Check the **GitHub Pages deployment** for what has gone live.

**Protect the live site:** Preserve the existing teal design, domain, URLs, novel content and reader controls. Do not change AdSense publisher IDs, advertising scripts, `ads.txt`, verification tags, or publisher-policy pages as part of a storage migration. AdSense approval cannot be guaranteed by a database change.
