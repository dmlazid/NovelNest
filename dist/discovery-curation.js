'use strict';
// Reader-safe reversible curation: these extremely long imported FreeWebNovel
// catalogs are kept intact and direct chapter URLs / bookmarks still work.
// They are intentionally not promoted or submitted for search indexing.
window.NOVELNEST_DISCOVERY_EXCLUDED=[
  "martial-god-asura",
  "legend-of-swordsman",
  "martial-peak",
  "infinite-mana-in-the-apocalypse",
  "reborn-at-boot-camp-general-dont-mess-around",
  "chaotic-sword-god",
  "madams-identities-shocks-the-entire-city-again",
  "the-long-awaited-mr-han",
  "cultivation-chat-group",
  "fey-evolution-merchant"
];
const excluded=new Set(window.NOVELNEST_DISCOVERY_EXCLUDED);
for(const novel of window.NOVELS||[])if(excluded.has(novel.id))novel.discoveryHidden=true;
