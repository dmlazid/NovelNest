'use strict';
(() => {
  const button = document.querySelector('[data-clear-novelnest]');
  const status = document.querySelector('[data-clear-status]');
  if (!button) return;
  button.addEventListener('click', () => {
    let removed = 0;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('novelnest.')) keys.push(key);
      }
      for (const key of keys) { localStorage.removeItem(key); removed++; }
      status.textContent = removed
        ? 'Local NovelNest reading data was cleared from this browser.'
        : 'No local NovelNest reading data was found in this browser.';
    } catch {
      status.textContent = 'Browser storage could not be cleared. Use your browser site-data controls instead.';
    }
  });
})();