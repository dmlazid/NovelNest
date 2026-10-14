# NovelHaven AdSense reapplication — readiness audit
Updated 2026-10-14 (Asia/Manila). Site: https://novelhaven.top/ . Firebase project: novelnest-7d9ca.

## Decision: HOLD reapplication until content-rights and live checks are verified

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

### Critical open issue: rights and independent content value
Many library novels and chapter texts were imported from third-party sites (including AkkNovel and FreeWebNovel). Public accessibility of the source does not confer republication, translation, cover-art or commercial advertising rights. A source URL, attribution, or a generic "licensed" notice alone does not prove rights.

For **each** externally sourced full-text novel or translation:
1. Confirm the exact rightsholder for the chapter text, translation, and cover image.
2. Record permission or licensing documentation covering reproduction on NovelHaven and ad-supported distribution, or a valid alternative legal basis.
3. For text that cannot be lawfully republished, do not monetize or present the full text as original/authorized. Obtain permission or remove the unlicensed full text and consider a lawful original discovery page with source links instead. Merely hiding pages from Google does **not** make unauthorized distribution acceptable.
4. Review originality and added value site-wide, not only the home page. Navigation/bookmarks alone may not resolve Google's policy against ads on replicated content without substantial original commentary, curation, or added value.

### Technical/live checks still needed
- Confirm the new mobile UI deployment from an actual phone, including menu scrolling, Create Private Draft, admin login, bookmark preservation, and chapter reading.
- Confirm GitHub "NovelHaven mobile UX regression" Actions job passed (the remote status cannot be verified through the current connector).
- Check the site's rendered accessibility and availability for signed-out visitors on mobile and desktop, including no broken chapter links or covers.
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
