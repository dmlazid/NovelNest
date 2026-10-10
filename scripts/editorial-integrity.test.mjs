import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../dist/', import.meta.url);
const guides = [
  'guide-genres.html',
  'guide-long-web-novel.html',
  'guide-ongoing-vs-completed.html',
  'guide-pacing.html',
  'guide-progression-fantasy.html',
  'guide-reading-list.html',
  'guide-returning-to-a-novel.html',
];
const ads = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9356195452195758" crossorigin="anonymous"></script>';

test('Reading Desk guides keep NovelHaven branding, canonical URLs, and publisher verification', () => {
  const desk = fs.readFileSync(new URL('reading-desk.html', root), 'utf8');
  for (const filename of guides) {
    const html = fs.readFileSync(new URL(filename, root), 'utf8');
    assert(!html.includes('NovelNest') && !html.includes('Novel<span>Nest'), filename + ': old branding');
    assert(html.includes('Novel<span>Haven</span>'), filename + ': visible logo');
    assert(html.includes('<meta property="og:site_name" content="NovelHaven">'), filename + ': social identity');
    assert(html.includes('<link rel="canonical" href="https://novelhaven.top/' + filename + '">'), filename + ': canonical');
    assert(html.includes(ads), filename + ': AdSense script missing or changed');
    assert(desk.includes('href="' + filename + '"'), filename + ': unlinked reading guide');
  }
});

test('reading list includes practical original help', () => {
  const html = fs.readFileSync(new URL('guide-reading-list.html', root), 'utf8');
  for (const section of ['Use three simple choices','Leave yourself a return note','Review your list for five minutes each week'])
    assert(html.includes('<h2>' + section + '</h2>'), 'Guide section missing: ' + section);
});
