'use strict';
// Reader-safe reversible curation: long imported books and the explicit-content
// review title are kept intact for existing direct readers and bookmarks.
// They are not promoted or submitted for indexing. This is not a rights clearance.
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
  "fey-evolution-merchant",
  "supreme-harem-god-system"
];
const excluded=new Set(window.NOVELNEST_DISCOVERY_EXCLUDED);
for(const novel of window.NOVELS||[])if(excluded.has(novel.id))novel.discoveryHidden=true;
