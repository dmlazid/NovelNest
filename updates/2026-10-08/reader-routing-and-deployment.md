# Reader, routing, and update reliability

- Fixed root-relative chapter loading and footer policy links when navigating from the homepage.
- Published real HTML for every existing chapter, discovery route, genre, and editorial guide. Valid pages return 200; unknown pages keep 404/noindex.
- Chapter pages include their actual text before JavaScript runs. Existing chapter URLs and saved reading positions are preserved.
- Display source chapter titles without conflicting sequential prefixes. Split chapters retain their original source numbering.
- Combined catalog metadata and application scripts into one cached bundle. Catalog metadata is approximately 2.5 MB instead of 7.1 MB; the published chapter text is stored once as HTML.
- Added chapter sitemaps, split below the sitemap URL limit.
- Fixed the null-novel exception on the homepage.
- Stabilized per-workflow updater queues, ensured waiting jobs check out current main, made batch validation failures stop publication, and added synchronization to restart obsolete updater jobs from saved checkpoints.
- Preserved the AdSense script/publisher ID, Google verification, ads.txt, current trust pages, original guides, and the gate that pauses automatically discovered new titles. Real error pages do not load ad code.

Validation: 53 JavaScript tests, 5 publication-guard tests, full source chapter/asset validation, and generated-site checks for all chapter paths, sampled chapter bodies/canonicals, sitemap structure, and preserved AdSense/trust files. The local snapshot contained 90 novels and 63,987 chapters; ongoing imports can increase this total.

These fixes address technical defects. Google still determines approval. Permission to republish does not by itself satisfy Google's replicated-content and inventory-value requirements. Existing AdSense account review status and consent-platform configuration are not changed by this update.
