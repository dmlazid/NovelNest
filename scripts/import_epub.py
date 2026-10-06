#!/usr/bin/env python3
"""Import a supplied WebToEpub book; validate chapter order before publishing.

Usage: python scripts/import_epub.py /path/to/book.epub --id novel-slug --key shortname --updated YYYY-MM-DD
"""
import argparse
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

CAPACITY = 25
DIST = Path(__file__).resolve().parents[1] / 'dist'


def text(element):
    return ' '.join(''.join(element.itertext()).split()) if element is not None else ''


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('epub', type=Path)
    parser.add_argument('--id', required=True, help='Stable novel URL slug')
    parser.add_argument('--key', required=True, help='Short lowercase data filename prefix')
    parser.add_argument('--status', choices=['Ongoing', 'Completed'], default='Ongoing')
    parser.add_argument('--updated', required=True, help='YYYY-MM-DD publication date')
    parser.add_argument('--audit', action='store_true', help='Report gaps without writing any files')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.id) or not re.fullmatch(r'[a-z]+', args.key):
        parser.error('Use lowercase letters/numbers/hyphens for id and lowercase letters for key')
    from datetime import date
    date.fromisoformat(args.updated)
    global_name = args.key.upper() + '_CHAPTERS'
    ID = args.id
    with zipfile.ZipFile(args.epub) as archive:
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        opf_path = container.find('.//{*}rootfile').attrib['full-path']
        package = ET.fromstring(archive.read(opf_path))
        base = posixpath.dirname(opf_path)
        metadata = package.find('{*}metadata')
        title = text(metadata.find('{*}title'))
        if not title:
            raise ValueError('Missing book title')
        manifest = {item.attrib['id']: item.attrib for item in package.find('{*}manifest')}
        chapters = []
        synopsis = text(metadata.find('{*}description'))
        for item in package.find('{*}spine'):
            entry = manifest[item.attrib['idref']]
            if entry.get('media-type') != 'application/xhtml+xml':
                continue
            document = ET.fromstring(archive.read(posixpath.normpath(posixpath.join(base, entry['href']))))
            body = document.find('{*}body')
            if body is None:
                raise ValueError('Missing document body')
            heading = text(body.find('.//{*}h1')).replace('\u200b', '').replace('\ufeff', '').strip()
            match = re.match(r'^Chapter\s+(\d+)', heading, re.I)
            if not match:
                if heading == 'Information':
                    description = next((node for node in body.iter() if node.get('class') == 'inner'), None)
                    if description is not None:
                        synopsis = ' '.join(text(p) for p in description.iter() if p.tag.rsplit('}', 1)[-1] == 'p')
                continue
            number = int(match.group(1))
            paragraphs = [text(p) for p in body.iter() if p.tag.rsplit('}', 1)[-1] == 'p']
            paragraphs = [p for p in paragraphs if p]
            if len(paragraphs) < 3:
                raise ValueError(f'Chapter {number} has insufficient text')
            chapters.append({'number': number, 'title': heading, 'paragraphs': paragraphs})
        if not chapters:
            raise ValueError('No chapters found')
        numbers = [c['number'] for c in chapters]
        missing = sorted(set(range(1, max(numbers) + 1)) - set(numbers))
        report = {'title': title, 'chapters': len(chapters), 'lastChapter': max(numbers), 'missing': missing,
                  'duplicates': sorted({n for n in numbers if numbers.count(n) > 1})}
        if args.audit:
            print(json.dumps(report, ensure_ascii=False))
            return
        if numbers != list(range(1, len(numbers) + 1)):
            raise ValueError('Chapter sequence is incomplete or out of order: ' + json.dumps(report))
        cover_id = next(m.attrib['content'] for m in metadata.findall('{*}meta') if m.get('name') == 'cover')
        cover = manifest[cover_id]
        if cover['media-type'] != 'image/jpeg':
            raise ValueError('Expected JPEG cover')
        cover_bytes = archive.read(posixpath.normpath(posixpath.join(base, cover['href'])))
        # All parsing and validation finish before writing the publication files.
        (DIST / 'assets').mkdir(exist_ok=True)
        (DIST / 'data').mkdir(exist_ok=True)
        (DIST / 'assets' / f'{ID}.jpg').write_bytes(cover_bytes)
        for start in range(0, len(chapters), CAPACITY):
            part = chapters[start:start + CAPACITY]
            path = DIST / 'data' / f'{args.key}-chapters-{start // CAPACITY + 1:02d}.js'
            path.write_text(f'window.{global_name}=(window.{global_name}||[]).concat(' + encode(part) + ');\n')
        tags = [t.strip() for t in text(metadata.find('{*}subject')).split(',') if t.strip()]
        novel = {
            'id': ID, 'title': title, 'author': text(metadata.find('{*}creator')),
            'genre': tags[0] if tags else 'Fiction', 'tags': tags or ['Fiction'],
            'status': args.status, 'cover': f'assets/{ID}.jpg', 'updated': args.updated, 'sample': False,
            'synopsis': synopsis,
            'license': {'type': 'Authorized publication', 'note': 'Published on NovelNest with permission from the rights holder, as confirmed by the site owner.'},
            'lazyChunks': {'prefix': f'data/{args.key}-chapters-', 'capacity': CAPACITY, 'global': global_name},
            'chapters': [{'number': c['number'], 'title': c['title'], 'paragraphs': ['Loading chapter…'], 'lazy': True} for c in chapters]
        }
        (DIST / f'licensed-{args.key}.js').write_text('(() => {\n  const novel = ' + encode(novel) + ';\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n  if (index >= 0) window.NOVELS[index] = novel;\n  else window.NOVELS.push(novel);\n})();\n')
        print(f'Imported {title}: {len(chapters)} chapters, {sum(len(c["paragraphs"]) for c in chapters)} paragraphs, original cover.')


if __name__ == '__main__':
    main()
