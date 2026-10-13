# NovelHaven production and content review — October 13, 2026

This is a technical review, not proof that the site is approved for Google AdSense.

## What is fixed in GitHub

- Detecting exact repeated chapter bodies across the 129,000-chapter catalog.
- Keeping the nine existing duplicate chapter bodies readable but out of generated sitemaps and their AdSense-enabled compiled reader pages.
- Blocking publication of any **new** unreviewed exact repeated chapter bodies rather than silently adding them.
- Preserving all existing novel data, bookmarks, source release updates, the teal design, and publisher verification.
- Separating historical Cloudflare D1 rows from current published chapter counts.
- Pausing D1 migration after Cloudflare reports the daily Free-tier limit until the next UTC day; continuing only through verified, quota-bounded batches.
- Reporting the live Cloudflare build, reader, ads.txt, restricted-route status and Pages account access without altering them.

## What still blocks production verification

**Cloudflare Pages access.** GitHub Actions previously received HTTP 403 / authentication error 10000 on the Cloudflare Pages API. The Pages project may be named `novelnest` or `novelnest-ac6`; the new read-only probe distinguishes these. Check that the GitHub secret `CLOUDFLARE_API_TOKEN` belongs to the correct Cloudflare account and has **Account / Cloudflare Pages Read** (and Edit only if an authorized deployment is intended). Never paste secrets in issues or this report. If the token belongs to another account, correct `CLOUDFLARE_ACCOUNT_ID`.

**Build output mismatch.** The current Pages Git integration has served the raw `dist` app even when the separate `_cloudflare` generated site passed GitHub validation. The intended compiled build is `NOVELNEST_CLOUDFLARE=1 node scripts/build.mjs` with output `_cloudflare`. **Do not apply this in production yet**: compiled chapter HTML requires the verified D1 Worker, otherwise existing chapters may stop loading. Apply it only after all original paragraphs in D1 pass the full content audit and the isolated workers.dev preview passes. The read-only production audit does not switch hosting or DNS.

**D1 free-tier limit.** Migration reported Cloudflare D1 error 7500 with an actual API failure. Per Cloudflare, Free daily limits reset at **00:00 UTC** and data is preserved. The scheduled retry is now less frequent, and a same-day cache prevents repeated failed requests. Successful GitHub job completion does not mean chapter copying is complete.

**Actual source text.** The following pairs have identical substantial chapter bodies and must be verified against permitted source copies before any replacement:

| Novel | Original chapter | Repeated chapter |
| --- | ---: | ---: |
| Supreme Magus | 1913 | 1915 |
| Supreme Magus | 1914 | 1916 |
| My Rich Wife | 751 | 752 |
| My Rich Wife | 871 | 872 |
| Reborn at Boot Camp | 3669 | 3670 |
| Necropolis Immortal | 1586 | 1587 |
| Necropolis Immortal | 1764 | 1765 |
| Martial Peak | 5177 | 5178 |
| Martial God Asura | 6010 | 6012 |

Publisher catalog cross-check: *Supreme Magus* #1913–1914 are **Frost Soul**, while #1915–1916 are **Shattered Plans** — demonstrably distinct chapters ([publisher catalog](https://www.webnovel.com/book/12820870105509205/catalog)). *My Rich Wife* #751–752 have identical **titles** in a publisher catalog; that does not mean the original body texts were identical ([publisher catalog](https://www.webnovel.com/book/21934772905339405/catalog)). Do **not** fabricate replacement story text or overwrite existing reader data without verifying the actual authorized edition.

## AdSense blockers not solved by a successful build

- Store privately the work-specific rights evidence for **each** republished novel: rights holder, title and language/translation, covered chapter ranges, territory/dates, monetized publication permission, and cover artwork rights. A generic “Authorized publication” field is not external proof of permission. Do not publish private agreements in GitHub.
- Review novel descriptions, chapter bodies and visual assets for explicit sexual content. One high-risk novel has been reversibly hidden from public discovery, but full catalog clearance is not established.
- Publishing copied chapters without substantial added value can still violate Google Publisher Policies **even with a license**. Original Reading Desk pages help readers but do not automatically make unrelated chapter pages monetizable.
- Do not ask for AdSense review while live chapter routes return an SPA shell, rights and content risks are unresolved, or production Ads policies are not verified.

**Status:** The website remains online on the existing host, but full deployment verification and AdSense readiness are outstanding. No automatic production cutover is authorized by this document.
