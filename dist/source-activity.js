// Source-reported chapter activity, not NovelHaven import timestamps.
(() => {
  const reports = {"dimensional-keeper-all-my-skills-are-at-level-100":{"sourceActivityVerified":true,"sourceActivityIsOngoing":true,"sourceActivityObservedAt":"2026-10-11T07:09:12Z","sourceActivityAgeSeconds":72000,"sourceActivityChapter":2050,"sourceActivityTitle":"Chapter 2050: Virgil’s Bet!"},"hero-summoning-world-at-peace":{"sourceActivityVerified":true,"sourceActivityIsOngoing":true,"sourceActivityObservedAt":"2026-10-11T07:09:12Z","sourceActivityAgeSeconds":18000,"sourceActivityChapter":2647,"sourceActivityTitle":"Chapter 2647 - Re: Demon Realm Amusement Park ㉗"},"immortality-through-array-formations":{"sourceActivityVerified":true,"sourceActivityIsOngoing":true,"sourceActivityObservedAt":"2026-10-11T07:09:12Z","sourceActivityAgeSeconds":7200,"sourceActivityChapter":2830,"sourceActivityTitle":"Chapter 2830 - 132: Campaign Against Shugu"}};
  for (const n of window.NOVELS || []) {
    if (Object.prototype.hasOwnProperty.call(reports, n.id)) Object.assign(n, reports[n.id]);
  }
})();
