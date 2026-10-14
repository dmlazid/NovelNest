# NovelHaven AdSense reapplication — readiness audit
Updated 2026-10-14 (Asia/Manila). Site: https://novelhaven.top/ . Firebase project: novelnest-7d9ca.

## Decision: prepare reapplication; verify live accessibility and current AdSense issues before submission

This is not a claim that NovelHaven violates policy, and not a Google decision.
AdSense acceptance cannot be guaranteed by having policy pages or publishing technical fixes.

### Verified in current GitHub source
- `dist/index.html` retains the existing AdSense publisher tag `ca-pub-9356195452195758`; no change to the tag was made in the mobile UX repair.
- `dist/ads.txt` contains the corresponding Google seller declaration.
- `dist/robots.txt` allows indexing and references `https://novelhaven.top/sitemap.xml`.
- `dist/sitemap.xml` lists the homepage, policy/contact pages, Reading Desk and seven editorial guides; it does not claim that every novel or chapter is indexed.
- Privacy, Terms, Contact, Copyright/Takedown, Editorial Policy, Content Licensing and Advertising Disclosure pages exist in `dist/`.
- Original Author Studio and moderator pages remain noindex and ad-free.
- Mobile navigation, direct writing composition, loading improvements and updated offline regression workflow were committed.

### Commercial publication rights: owner-confirmed (not independently audited)
The owner confirmed in chat on October 14, 2026, that NovelHaven has permission to republish AkkNovel and FreeWebNovel content commercially with advertising. Treat this as the owner's confirmation; do **not** remove novels on an assumption that rights are absent. Contract/license documentation was not provided for independent verification; keep the documentation privately, including whether permission covers each translation, chapter, cover, and advertising.

### Remaining content-value requirement, even for licensed material
Google's replicated-content policy separately requires original commentary, curation, or other value. A license alone does not guarantee AdSense approval. NovelHaven already has seven original Reading Desk guides and features such as bookmarks, history and reading tracking. Ensure meaningful original editorial value is visible across the site, not solely on a legal page.
- Review story and category pages for distinctive editorial summaries and relevant reading recommendations rather than automatically generated copies.
- Avoid ads on empty, error, loading, and unreviewed manuscript screens.
- Keep the present AdSense publisher code and ads.txt unchanged; do not cloak or substitute special content for Google's crawler.
- Record the rights details privately; never upload confidential agreements or private keys into the public GitHub repository.


### Updates after reviewing Google's rejection email (October 14)
The three AdSense email screenshots show a generic "Update your AdSense application" request and Google's tip to focus on original content quality. Neither the screenshots nor the AdSense account homepage names a specific page or final policy finding. Do not label this as a confirmed "low value content" finding.

New source changes:
- Replaced the empty homepage HTML main region with genuine reading guidance and working static links as a meaningful fallback before the JavaScript application renders. This is visible to readers when JavaScript is delayed or disabled; it is not crawler-only content.
- Expanded the original Reading Desk with links to practical genre/pacing/reading-list workflows.
- Expanded three existing guides with original decision checklists, chapter-sample methods, time-management examples and relevant cross-links. Did not fabricate reviews of novels that editors have not read.
- Updated the sitemap lastmod dates only for pages actually revised.
- Preserved the existing AdSense verification code and matching ads.txt, plus noindex/ad-free author tools.
- Verified 25/25 source checks for these changes. **Not verified**: live DNS/HTTP, device rendering, or GitHub Actions completion.

Google's written policy also addresses *replicated content on individual ad-served screens*, even where publication rights exist. Continue creating authentic reader value, not keyword padding, at the level of site sections where third-party text appears. Before resubmission, verify that licensed novel pages are accessible, functional and accompanied by meaningful useful features/curation. Keep rights documentation privately.

The assistant's runtime DNS failed for several unrelated domains as well as novelhaven.top, so external-site fetch failures in that environment are not proof NovelHaven is unavailable to visitors.

### Technical/live checks still needed
- Confirm the new mobile UI deployment from an actual phone, including menu scrolling, Create Private Draft, admin login, bookmark preservation, and chapter reading.
- Confirm GitHub "NovelHaven mobile UX regression" and "NovelHaven AdSense source readiness" Actions jobs passed (the current connector cannot list or verify the runs).
- Run `node scripts/adsense-preflight.mjs` in the repository (source-only checks; it is not a Google account review).
- Check the site's rendered accessibility and availability for signed-out visitors on mobile and desktop, including no broken chapter links or covers. The automated public-site request in this chat failed due to a tool-side/network lookup error and is **not** evidence that Google's crawler is blocked.
- Check submitted/indexed pages and any indexing errors in Google Search Console. The GSC Wizard connector could not be used because its trial/subscription is inactive.
- Verify any Google AdSense "Needs attention" description in the **actual account**. GitHub code does not expose private account review decisions.
- Ensure the privacy and advertising disclosures reflect any active cookies/ads, and confirm needed consent management where legally required.

### When the site is eligible for another review
If the site is marked "Needs attention" in AdSense:
1. Sign in to https://adsense.google.com/adsense/u/0/sites .
2. Choose `novelhaven.top` and inspect the full issue list; resolve the actual cited deficiencies.
3. Confirm site code and domain are unchanged and reachable, then select **Request review** on the **Sites** page.
4. For a separate **Policy center** enforcement, use `Policy center → Fix → Start review process` instead.

Google's site-review guidance: https://support.google.com/adsense/answer/12176698
Google's replicated-content policy: https://support.google.com/publisherpolicies/answer/11190248
Google's Policy center review process: https://support.google.com/adsense/answer/7003627

Review may take days or weeks and approval is not guaranteed.

### Non-goals
- Do not remove AdSense verification or seller settings during site repairs.
- Do not use cloaking or show different copyright-risk content to Google and readers.
- Do not auto-reapply without checking the account's current status and ensuring the rights and content-value risks are addressed.
