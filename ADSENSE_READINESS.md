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

## October 14 update — nine repeated chapters corrected
- Nine confirmed repeated chapter bodies have been removed from public chapter data and chapter lists without changing chapter numbers, saved links or reading progress. These deleted chapter slots remain reserved.
- The live deletion verification passed; the former notes about unreadable/unrepaired repeated prose above are historical.
- NovelHaven's chapter pages still use the existing reader while Cloudflare D1 receives and verifies content. A green build is not a full D1 content audit.

## October 14 policy and privacy work — pending production verification
- Policy, contact, privacy, takedown, rights and terms pages are no longer intended to load Google advertising code. The site homepage and useful Reading Desk guides retain the unchanged AdSense publisher verification and ads.txt.
- Privacy Choices displays NovelHaven branding and distinguishes deleting local browser reading data from signed-in cloud deletion and advertising consent.
- Generic "Licensed edition" labels in the card, novel detail and reader have been changed to neutral labels. Rights and cover permissions are **not** independently verified by a UI label.
- The site owner supplied `novelhaven15@gmail.com` as the rights-holder and copyright contact. Contact, Takedown and Content Licensing pages now offer direct email requests instead of requiring publication in GitHub Issues. Mailbox access and responsiveness have not been independently tested.
- `POLICY_RIGHTS_REVIEW.md` lists work-specific rights, translation, artwork and ad-monetization evidence that the owner must keep privately. A public `sourcewide_authorized` flag does not prove an individual license.
- AdSense resubmission is **not yet recommended**: confirm individual publication and advertising rights, screen content and user-generated links, configure the required Google-certified CMP as appropriate, and verify live pages after deployment.
- These changes do not remove the existing AdSense site-verification account, publisher ID, or approved reading guides and do not guarantee Google acceptance.

## Historical D1 rows and accurate copy accounting
- The D1 migration may contain older novels no longer in the published catalog; its raw `total_stored` can be greater than the 129,000 active source chapters. The migration now reports `active_stored`, `historical_stored` and `remaining_chapters` based only on current novel IDs, without deleting any archived data.
- Historical rows and routes no longer cause a false inventory error during the read-only full paragraph audit; they do not contribute to active coverage, and every current chapter must still match its original paragraphs and validated route. A full audit still has `cutover_ready: false` and never alters the live deployment.

## October 14 novel-page monetization safeguard — pending production verification

- Google Publisher Policies prohibit serving Google ads on replicated pages without substantial added value, and separately prohibit copyright infringement. Owner source-wide import permission flags are NOT evidence for individual translation, cover-image, full-text or advertising permissions.
- The compatible Pages build now keeps all **unreviewed novel details** readable and discoverable while removing the Google advertising loader on those pages. Chapter routes use one publisher-free, temporarily noindex SPA shell until the fully verified D1 reader is available. This does NOT delete any chapter or change bookmarks.
- The SPA navigation boundary forces a full document load when entering a novel from a page that already loaded the publisher script; subsequent ad-free chapter navigation stays in the reader. The future D1 Worker is also ad-free for novel chapter text.
- `scripts/novel-monetization-reviews.json` is initially empty by design. Each individual work needs evidence for text, translation, cover and commercial-ad rights, meaningful additional original value and content-policy checks before being added.
- CI creates a `novel-monetization-review` artifact with the catalog inventory and remaining review queue. It contains no contracts or chapter text.
- The public homepage and original Reading Desk guides keep the existing AdSense publisher tag and `ads.txt`. Privacy, contact and copyright pages stay free of advertising tags.
- **This is a precautionary hold, not a declaration that the catalog is copyright-cleared, high-quality or AdSense-approved.** Manual verification and the rejected-account Policy center remain essential. Do not request another review until those gaps are resolved.

## October 14 catalog-directory ad hold

- Generated Browse, Latest Novels, Latest Releases, Completed, Finder and Genre directory pages no longer load Google advertising code while their source-derived novel listings await editorial originality and monetization review. Library stays ad-free.
- This does **not** hide or delete any novels, change indexability of directory pages, stop source chapter updates, modify saved bookmarks, or turn off site owner verification.
- Entering these directories or unreviewed novel detail/chapters from the ad-tagged homepage uses one fresh document load. Browsing from an already ad-free page continues through the existing SPA.
- The homepage and independent original Reading Desk guides retain the existing AdSense publisher verification code; the public `ads.txt` is untouched.
- A technical hold is not permission to republish or an AdSense approval. Work-specific rights, sensitive-text screening and meaningful original value remain unresolved until privately verified by the owner.
