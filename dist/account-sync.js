(() => {
  const empty = () => ({ data: { saved: [], progress: {}, positions: {}, chapterStatus: {} }, seen: {} });
  const copy = value => JSON.parse(JSON.stringify(value));
  // Apply only this device's changes to the latest server state. Unchanged stale
  // bookmarks must not resurrect a bookmark removed on another device.
  function membership(base, local, remote) {
    const result = new Set(remote), before = new Set(base), after = new Set(local);
    for (const value of before) if (!after.has(value)) result.delete(value);
    for (const value of after) if (!before.has(value)) result.add(value);
    return [...result];
  }
  function merge(base, local, remote) {
    const result = copy(remote);
    result.data.saved = membership(base.data.saved, local.data.saved, remote.data.saved);
    for (const field of ['progress', 'positions']) {
      for (const [key, value] of Object.entries(local.data[field])) {
        if (JSON.stringify(value) === JSON.stringify(base.data[field][key])) continue;
        if (!result.data[field][key] || value.at >= result.data[field][key].at) result.data[field][key] = copy(value);
      }
    }
    for (const [id, value] of Object.entries(local.data.chapterStatus)) {
      const before = base.data.chapterStatus[id] || { started: [], finished: [] };
      const cloud = remote.data.chapterStatus[id] || { started: [], finished: [] };
      const finished = membership(before.finished, value.finished, cloud.finished);
      result.data.chapterStatus[id] = { started: [...new Set([...membership(before.started, value.started, cloud.started), ...finished])].sort((a,b) => a-b), finished: finished.sort((a,b) => a-b) };
    }
    result.data.positions = Object.fromEntries(Object.entries(result.data.positions).sort((a,b) => b[1].at-a[1].at).slice(0,200));
    for (const [id, count] of Object.entries(local.seen)) result.seen[id] = Math.max(count, result.seen[id] || 0);
    return result;
  }
  function updates(novels, state) {
    return novels.filter(n => state.data.saved.includes(n.id) && Number.isInteger(state.seen[n.id]) && n.chapters.length > state.seen[n.id]).map(n => ({ id: n.id, title: n.title, count: n.chapters.length - state.seen[n.id], first: state.seen[n.id] + 1 }));
  }
  window.NovelNestSync = { empty, merge, updates };
})();
