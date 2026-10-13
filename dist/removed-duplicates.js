// These exact repeated chapter bodies were deleted from public chapter chunks.
// Keep their numeric slots as tombstones: old bookmarks and all other chapter
// URLs remain stable, while the chapter list and reader skip removed entries.
(() => {
  const removed = {
  "supreme-magus": [
    1915,
    1916
  ],
  "my-rich-wife": [
    752,
    872
  ],
  "reborn-at-boot-camp-general-dont-mess-around": [
    3670
  ],
  "necropolis-immortal": [
    1587,
    1765
  ],
  "martial-peak": [
    5178
  ],
  "martial-god-asura": [
    6012
  ]
};
  window.NOVELNEST_REMOVED_DUPLICATES = removed;
  for (const novel of window.NOVELS || []) {
    for (const number of removed[novel.id] || []) {
      const index = number - 1;
      const chapter = novel.chapters[index];
      if (!chapter || Number(chapter.number) !== number) throw Error('Removed chapter record missing: '+novel.id+':'+number);
      novel.chapters[index] = { ...chapter, paragraphs: [], lazy: false, removedDuplicate: true };
    }
  }
})();
