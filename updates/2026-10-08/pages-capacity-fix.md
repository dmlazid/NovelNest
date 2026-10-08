# Restore chapter deployments within the Pages size limit

Chapter imports grew beyond the capacity of the earlier full-page template.
The latest local source snapshot contains 90 novels and 79,524 chapters; the
old generated site was 1,094,961,407 bytes and failed its hosting size gate.

Chapter pages now use a compact static reading layout. Every paragraph, title,
canonical URL, next/previous link and footer policy link remains in the HTML.
The shared JavaScript restores the original interactive header before the
application binds its controls and renders the usual reader. The favicon is
stored once as an asset. Discovery pages retain their existing metadata and
layout. No source chapter, saved URL or reading-position identifier is changed.

The same snapshot now produces 926,253,982 bytes (168,707,425 bytes smaller).
The size gate remains active and reports the measured size on failure. Builds
above 90% of the budget warn that additional hosting capacity will be needed.
This optimization creates headroom; GitHub Pages still has a finite 1 GB limit
and continued bulk imports will eventually require a larger hosting service.

Validation: 55 JavaScript tests and 5 publication-safeguard tests passed. The
source validator checks every chapter. Generated-site checks verify all 79,524
chapter paths, first/middle/last chapter text per novel against its source,
header restoration, direct-page hydration, reader assets, canonical URLs,
policy links and unchanged AdSense, ads.txt and Google verification. Existing
policy and privacy files are unchanged. New-title publication remains gated.

After deployment, the workflow now checks the public homepage, a direct
chapter, privacy page, ads.txt, sitemap and runtime from the GitHub runner.
It verifies the deployed build timestamp and publisher files and allows a
short retry window for CDN propagation before reporting a failure.

These technical checks do not establish Google approval or complete content
policy compliance. Rights, content eligibility and the AdSense account's
review and consent settings remain the publisher's responsibility.
