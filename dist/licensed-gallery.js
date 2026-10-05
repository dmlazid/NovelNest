(() => {
  const id = 'got-a-gallery-in-the-wild';
  const chapters = window.GALLERY_CHAPTERS || [];
  const licensed = {
    id,
    title: 'Got a Gallery in the Wild',
    author: 'Ripper_8410 / 두부두부',
    genre: 'Fantasy',
    tags: ['Fantasy','Action','Adventure','Comedy','Harem','Martial Arts','Supernatural'],
    status: 'Ongoing',
    cover: 'assets/got-a-gallery-in-the-wild.jpg',
    updated: '2026-10-05',
    sample: false,
    synopsis: 'I ended up in an unknown place. The only thing I can rely on is this gallery. But there are just too many strange people.',
    license: {
      type: 'Authorized publication',
      note: 'Published on NovelNest with permission from the rights holder, as confirmed by the site owner.'
    },
    source: 'FreeWebNovel',
    sourceUrl: 'https://freewebnovel.com/novel/got-a-gallery-in-the-wild',
    chapters
  };
  const index = window.NOVELS.findIndex(n => n.id === id);
  if (index >= 0) window.NOVELS[index] = licensed;
  else window.NOVELS.push(licensed);
})();
