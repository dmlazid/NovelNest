# NovelNest AdSense readiness

This file tracks what is done and what still requires the site owner or a real AdSense account.

## Completed
- Privacy Policy
- Terms of Use
- Contact page
- Copyright / takedown process
- About page
- Editorial Policy
- Content Licensing & Rights page
- Advertising Disclosure
- Original NovelNest Reading Desk articles
- Crawlable static trust/editorial URLs
- Canonical metadata and structured data
- robots.txt
- sitemap.xml
- Privacy Choices page for local NovelNest data
- Real AdSense publisher code installed for ca-pub-9356195452195758

## Automatic novel publication safeguard (October 8, 2026)
- The site owner's statement of republication permission is preserved.
- Scheduled updaters may continue adding chapters to novels that are already published.
- Automatic popular-novel discovery stays enabled, but NEW discovered titles remain candidates rather than being published.
- Entries already in the automatic registry but not yet linked from the published site's index also remain blocked.
- New automatic publication defaults to off. To release any individual title later, enable the global gate AND explicitly add its registry key to the reviewed-title allowlist, only after an editorial/site-quality check.
- This gate does not determine or guarantee Google AdSense approval. Google can restrict monetization of reproduced works without meaningful added editorial or reader value even with publishing permission.
- Do not alter the existing AdSense publisher code, ads.txt, Google account settings, or the published novel catalog to implement the gate.

## Still required before AdSense activation
1. In AdSense, verify ownership of novelhaven.top.
2. Resolve the content and live-deployment blockers below before requesting another review.
3. Configure Google Privacy & Messaging or another Google-certified CMP before serving personalized ads to EEA, UK, or Switzerland visitors.
4. Wait for Google to mark the site Ready/approved.
5. Only finalize ad placements after the site/account status permits serving ads.

## Official references
- Site URL requirements: https://support.google.com/adsense/answer/2784438
- Add and verify a site: https://support.google.com/adsense/answer/12169212
- ads.txt: https://support.google.com/adsense/answer/12171612
- Google-certified CMP requirement: https://support.google.com/adsense/answer/13554116

Do not claim AdSense approval until Google has reviewed and marked the site Ready.


## October 13 continuation audit — not ready for resubmission
- PR #11 is merged. Current main passed Check and package website; Cloudflare Pages reported success, but the live site-quality audit failed.
- Live `/build-info.json` and `/sitemaps/catalog.xml` returned the SPA homepage, not the generated JSON/XML. Check the Pages production build command and output directory before treating a green deployment as proof of a complete publishing build. Do not switch to the D1 reader until its full-content audit passes.
- Six previously archived FreeWebNovel keys remain archived; no additional titles were deleted in this change. Length alone does not establish low quality.
- Existing source-wide owner permission declarations are preserved. This audit has not independently verified title-specific licenses covering translations, artwork and monetization.
- `Supreme Harem God System` needs priority human review for explicit sexual content; its chapter titles flag adult scenes. A title/keyword flag is not a completed content review. Do not mark the whole catalog policy-safe based on structural tests.
- Google prohibits monetizing copied content without added value and copyright-infringing or sexually explicit content. General guides do not automatically resolve chapter-page eligibility: https://support.google.com/publisherpolicies/answer/10502938
- Home Reading Desk links now point to the complete static editorial collection and canonical guides rather than older app copies. The long-novel guide includes reading-time estimation, completion checks and an arc-selection example.
- AdSense code, verification, ads.txt, affiliate links, accounts, bookmark/progress storage, importers and D1 configuration are untouched.

## October 13 policy safeguard (pending publication verification)
- The explicitly sexual **Supreme Harem God System** is withheld from public discovery and `noindex`-marked without deleting chapters or breaking bookmarks. Ten previously curated long imports remain hidden.
- Generated hidden novel detail and chapter pages do not load the AdSense publisher script; the Cloudflare D1 reader strips it from hidden chapter responses. The public homepage and other approved routes retain publisher verification and ads.txt unchanged.
- The current raw Cloudflare SPA fallback can still load the general homepage script before client routing. Site-wide approval must **not** be assumed until the deployed build/output and adult-content audit are resolved.
- No license or monetization rights are independently certified by this safeguard; review other potentially explicit books and translated content before requesting approval.

## Confirmed chapter repetition — targeted safeguards
- A full catalog text audit found **9 exact repeated chapter bodies** (rather than relying on headings or chapter lengths). The repeated copies are in Supreme Magus (#1915, #1916), My Rich Wife (#752, #872), Reborn at Boot Camp (#3670), Necropolis Immortal (#1587, #1765), Martial Peak (#5178) and Martial God Asura (#6012).
- The generated sitemap and Cloudflare reader omit these repeated copies from indexing/ads, but their chapter text and reader navigation remain available. Three affected long titles already have entire-book noindex curation; six other affected routes receive targeted Cloudflare Pages noindex headers.
- These are temporary safeguards, **not repaired prose**: source comparison is still required before replacing any chapter body. The raw SPA shell may still include the site-wide publisher script until the hosting mismatch is resolved.
