import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export function validateSite(root = 'dist') {
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const context = vm.createContext({ window: {} });
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
  assert(scripts.includes('catalog.js'), 'The catalog must be loaded by the page');
  assert(!scripts.some(s => s.startsWith('data/')), 'Chapter text must load on demand');
  for (const ref of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])) {
    if (/^(?:https?:|data:|#)/.test(ref)) continue;
    assert(fs.existsSync(path.join(root, ref.split('?')[0])), `Missing page asset: ${ref}`);
  }
  for (const name of fs.readdirSync(root).filter(n => n.endsWith('.js'))) new vm.Script(read(name), { filename: name });
  for (const name of scripts.filter(s => s === 'catalog.js' || /^licensed-(?!ui\.js)/.test(s))) vm.runInContext(read(name), context, { filename: name, timeout: 1000 });
  const novels = context.window.NOVELS;
  assert(Array.isArray(novels) && novels.length > 0, 'No novels were checked');
  const ids = new Set();
  const checkedFiles = new Set();
  let chapterCount = 0;
  for (const novel of novels) {
    assert(novel.id && !ids.has(novel.id), `Duplicate or missing novel ID: ${novel.id}`);
    ids.add(novel.id);
    assert(novel.title && novel.chapters?.length, `${novel.id}: empty catalog`);
    assert(fs.existsSync(path.join(root, novel.cover)), `${novel.id}: missing cover`);
    assert(['Ongoing', 'Completed'].includes(novel.status), `${novel.id}: invalid status`);
    const config = novel.lazyChunks;
    assert(config && Number.isInteger(config.capacity) && config.capacity > 0, `${novel.id}: invalid chunk configuration`);
    const count = Math.ceil(novel.chapters.length / config.capacity);
    const chapters = [];
    for (let chunk = 1; chunk <= count; chunk++) {
      const file = `${config.prefix}${String(chunk).padStart(2, '0')}.js`;
      assert(fs.existsSync(path.join(root, file)), `Missing chapter file: ${file}`);
      const data = vm.createContext({ window: {} });
      vm.runInContext(read(file), data, { filename: file, timeout: 1000 });
      const part = data.window[config.global];
      const expected = Math.min(config.capacity, novel.chapters.length - chapters.length);
      assert(Array.isArray(part) && part.length === expected, `${file}: expected ${expected} chapters`);
      chapters.push(...part);
      checkedFiles.add(file);
    }
    for (const [index, chapter] of chapters.entries()) {
      const number = Number(chapter.number ?? (config.numberFromTitle ? chapter.title?.match(/^Chapter\s+(\d+)/i)?.[1] : NaN));
      assert.equal(number, index + 1, `${novel.id}: missing, duplicate, or out-of-order chapter at ${index + 1}`);
      const metadata = novel.chapters[index];
      assert.equal(metadata.number, number, `${novel.id}: catalog number mismatch`);
      assert.equal(metadata.title, chapter.title, `${novel.id}: catalog title mismatch at ${number}`);
      assert(metadata.lazy === true, `${novel.id}: expected lazy metadata`);
      assert(Array.isArray(chapter.paragraphs) && chapter.paragraphs.length > 0, `${novel.id}: empty chapter ${number}`);
      assert(chapter.paragraphs.every(p => typeof p === 'string' && p.trim() && !/^Loading chapter[….]*$/.test(p)), `${novel.id}: invalid chapter text at ${number}`);
    }
    chapterCount += chapters.length;
  }
  for (const name of fs.readdirSync(path.join(root, 'data')).filter(n => n.endsWith('.js'))) {
    const file = `data/${name}`;
    if (checkedFiles.has(file)) continue;
    const data = vm.createContext({ window: {} });
    vm.runInContext(read(file), data, { filename: file, timeout: 1000 });
    assert(Object.values(data.window).every(v => Array.isArray(v) && v.length === 0), `Unindexed chapters in ${file}`);
  }
  console.log(`Validated ${novels.length} novels and ${chapterCount} actual chapters, including metadata, sequence, text and assets.`);
  return { novels: novels.length, chapters: chapterCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) validateSite(process.argv[2] || 'dist');
