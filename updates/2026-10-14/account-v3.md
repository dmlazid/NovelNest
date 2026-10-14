# Account v3 — 2026-10-14

- Repair background account refresh replacing the entire mobile My Account row with an unbounded avatar.
- Compact the drawer header and collapsed administrator controls; reset drawer scroll deliberately on opening and route reading links without reloading the document.
- Add private photo uploads (192px compressed JPEG) and editable usernames for all signed-in accounts. Store profile in the UID-protected existing users document, preserving it during transactional reading sync. Username is a display name, not a unique login identifier.
- Restrict Founder / Owner presentation to the configured founder UID AND verified authorAdmins editor membership. Other editors retain administrator presentation. Existing Firestore rules continue enforcing all moderation and user-document writes; no client can create admin memberships.
- Give readers a matching reading activity card and author invitation; owners retain moderation and manuscript tools.
- Add actual submitted/published novel counts and distinct authors represented in those two groups. No estimated totals or invented analytics.
- Add administrator shortcuts on publishing pages and protect asynchronous role lookup against account switches.
- Personal drafts have no subscription cap; practical Firestore document/service limits remain.

Validation: account, navigation, publishing and Firebase security regression tests; compatible Cloudflare Pages build and reader/AdSense safeguard checks. Live publishing actions require the user's authenticated session and are not simulated against production.
