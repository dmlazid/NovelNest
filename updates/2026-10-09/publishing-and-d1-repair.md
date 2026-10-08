# Publishing and D1 migration repair

The Pages build had exceeded its existing size guard, and D1 sync rejected the gallery novel because its legacy chunks intentionally derive chapter numbers from titles.

- Match D1 chapter-number validation to the existing source validator: title-derived numbers are accepted only when `numberFromTitle` is explicitly configured. Wrong order, wrong titles and missing metadata still stop the import.
- Add a regression covering the legacy format and rejection of malformed/unconfigured source chapters.
- Reduce static chapter markup without removing or changing chapter text. Escape HTML text separately from attributes and omit HTML's optional paragraph end tags. Keep full text in each crawlable chapter response, real canonical URLs and direct chapter navigation.
- Restore the original header and complete policy footer before app startup. Static pages retain direct privacy, privacy choices, terms, copyright and contact links. All policy files, publisher script, Google verification and ads.txt remain unchanged.
- Relative static chapter links use the novel root; the runtime restores the site root before rendering interactive navigation. Restore the original theme color and favicon for the interactive reader.
- Trigger a bounded 350-chapter D1 import on importer repairs, using the existing shared concurrency lock and storage/write guards. Manual preview mode remains available.

Validation: 104 JavaScript tests and 5 publication guard tests passed. First/middle/last D1 selection across all 90 novels passed. Full generated-site checks cover chapter count, exact source paragraphs, footer hydration, canonical URLs and publisher files.

This repairs publishing and the stalled importer. It does not claim the complete Cloudflare migration is finished. D1 copying remains bounded and resumable, and the Pages size limit remains enforced; further growth still requires completing the hosting migration.
