(() => {
  const id = 'astral-pet-store';
  const chapters = window.ASTRAL_CHAPTERS || [];
  const licensed = {
    id,
    title: 'Astral Pet Store',
    author: 'Ancient Xi / Gu Xi / 古羲',
    genre: 'Action',
    tags: ['Action','Adventure','Comedy','Fantasy','School Life','Xuanhuan'],
    status: 'Completed',
    cover: 'assets/astral-pet-store.jpg',
    updated: '2026-10-05',
    sample: false,
    synopsis: 'After transmigrating into a world centered on astral pets, a young pet-store owner with no natural affinity receives a system that opens a path toward training extraordinary creatures and changing his fate.',
    license: {
      type: 'Authorized publication',
      note: 'Published on NovelNest with permission from the rights holder, as confirmed by the site owner.'
    },
    source: 'FreeWebNovel',
    sourceUrl: 'https://freewebnovel.com/novel/astral-pet-store',
    chapters
  };
  const index = window.NOVELS.findIndex(n => n.id === id);
  if (index >= 0) window.NOVELS[index] = licensed;
  else window.NOVELS.push(licensed);
})();
