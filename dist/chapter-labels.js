(() => {
  // URLs and saved progress use the stable reading order. Source chapter numbers
  // may include a prologue or split parts, and must not be renumbered.
  function title(value) {
    let text = String(value || '').replace(/[\u200b\ufeff]/g, '').trim();
    while (/^Chapter\s+\d+\s*:\s*Chapter\s+\d/i.test(text)) {
      text = text.replace(/^Chapter\s+\d+\s*:\s*/i, '');
    }
    return text;
  }
  function number(chapter, fallback) {
    return title(chapter?.title).match(/^Chapter\s+(\d+(?:[.\-]\d+)?)/i)?.[1] || String(fallback);
  }
  window.NovelNestChapterLabels = { title, number };
})();
