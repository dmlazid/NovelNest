# NovelNest

NovelNest is a web-novel library and chapter reader hosted on GitHub Pages at **NovelHaven**.

- **Live website:** https://novelhaven.top/
- **Repository:** https://github.com/dmlazid/NovelNest
- **Deployments and chapter updates:** https://github.com/dmlazid/NovelNest/actions

## Repository folders

| Folder | What is inside |
| --- | --- |
| [`dist/`](./dist/) | Live website files, novel catalogs, covers, and chapter data |
| [`scripts/`](./scripts/) | Importers, checks, build tools, and tests |
| [`.github/workflows/`](./.github/workflows/) | Automatic imports, checks, and GitHub Pages deployment |
| [`firebase/`](./firebase/) | Firebase configuration and rules |
| [`updates/`](./updates/) | **Dated update folders and batch history** |
| [`docs/`](./docs/) | Longer project documentation |

## Current status

NovelHaven is actively importing and updating authorized novel batches. Large novels are imported in resumable checkpoints, so the repository may update many times while catch-up is running.

For the detailed catalog/batch list and the latest archived changes, open:

**[updates/2026-10-07/](./updates/2026-10-07/)**

For the longer technical/project guide, open:

**[docs/project-guide.md](./docs/project-guide.md)**

## Update organization

From now on, detailed update notes should go into a dated folder such as:

`updates/2026-10-08/README.md`

This keeps the main GitHub page short instead of adding every new batch and change directly to this README.
