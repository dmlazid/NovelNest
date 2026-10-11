// Source-reported activity, updated by the hourly source checker.
(() => {
  const reports = {};
  for (const n of window.NOVELS || []) if (Object.prototype.hasOwnProperty.call(reports,n.id)) Object.assign(n,reports[n.id]);
})();
