# NovelNest Updates — 2026-10-08

## Automatic 15-title batch discovery

NovelNest now has automatic discovery support for both FreeWebNovel and AkkNovel so future candidate batches do not require manually sending individual novel links.

### FreeWebNovel

- Discovery starts from the **Most Popular** catalog.
- Existing NovelNest titles are skipped automatically.
- The next queue is capped at **15 titles**.
- The current imported queue continues updating in 100-chapter checkpoints before a new batch is considered.

### AkkNovel

- Discovery checks the popularity/series catalog and falls back to the active home-page series lists when needed.
- Existing NovelNest titles are skipped automatically.
- The next queue is capped at **15 titles**.
- The current imported queue continues updating in 100-chapter checkpoints before a new batch is considered.

## Authorization safeguard

Automatically discovered titles are first stored as **candidates**. They are promoted into the importer only when the repository's source-wide authorization setting for that source is enabled.

Files:

- `scripts/auto_import_policy.json` — batch size and source-wide authorization switches
- `scripts/candidates_freewebnovel.json` — pending FreeWebNovel candidate batch
- `scripts/candidates_akknovel.json` — pending AkkNovel candidate batch
- `scripts/auto_freewebnovel.json` — approved automatic FreeWebNovel import registry
- `scripts/auto_akknovel.json` — approved automatic AkkNovel import registry
- `scripts/discover_auto_novels.py` — automatic discovery and duplicate filtering

The batch size is currently **15**.

## Import workflow improvements

- FreeWebNovel now loads automatic titles from its registry and supports a dynamic title queue.
- FreeWebNovel and AkkNovel use round-robin 100-chapter checkpoints so one very long novel does not block every other title.
- New batches are considered only when the current queue is caught up for the source snapshot.
- Candidate discovery does not require manual novel links.
- The workflows queue a continuation automatically when a new approved batch is promoted.
- Workflow variable expansion was corrected so the dynamic title arrays and GitHub token are evaluated normally.

## Cleanup

An older automatic AkkNovel run selected titles before the authorization safeguard was fully in place. Those unconfirmed automatic titles were moved back to the candidate queue, and the two titles that had begun importing were removed from the live catalog.

AdSense configuration was not changed in this update.
