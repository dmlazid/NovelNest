#!/usr/bin/env python3
"""Import the owner's Monarch EPUB locally; no network requests.

Usage: python scripts/import_monarch_epub.py /path/to/book.epub
"""
import argparse
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ID = 'extras-path-the-eternal-frost-monarch'
CAPACITY = 25
DIST = Path(__file__).resolve().parents[1] / 'dist'


def text(element):
    return ' '.join(''.join(element.itertext()).split()) if element is not None else ''


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('epub', type=Path)
    args = parser.parse_args()
    with zipfile.ZipFile(args.epub) as archive:
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        opf_path = container.find('.//{*}rootfile').attrib['full-path']
        package = ET.fromstring(archive.read(opf_path))
        base = posixpath.dirname(opf_path)
        metadata = package.find('{*}metadata')
        title = text(metadata.find('{*}title'))
        if title != "Extra's Path: The Eternal Frost Monarch":
            raise ValueError('This importer is for the Monarch novel only')
        manifest = {item.attrib['id']: item.attrib for item in package.find('{*}manifest')}
        chapters = []
        for item in package.find('{*}spine'):
            entry = manifest[item.attrib['idref']]
            if entry.get('media-type') != 'application/xhtml+xml':
                continue
            document = ET.fromstring(archive.read(posixpath.normpath(posixpath.join(base, entry['href']))))
            body = document.find('{*}body')
            heading = text(body.find('.//{*}h1'))
            match = re.match(r'^Chapter\s+(\d+)\b', heading, re.I)
            if not match:
                continue
            number = int(match.group(1))
            if number != len(chapters) + 1:
                raise ValueError(f'Missing or duplicate chapter at {number}')
            paragraphs = [text(p) for p in body.iter() if p.tag.rsplit('}', 1)[-1] == 'p']
            paragraphs = [p for p in paragraphs if p]
            if len(paragraphs) < 3:
                raise ValueError(f'Chapter {number} has insufficient text')
            chapters.append({'number': number, 'title': heading, 'paragraphs': paragraphs})
        if not chapters:
            raise ValueError('No chapters found')
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
            path = DIST / 'data' / f'monarch-chapters-{start // CAPACITY + 1:02d}.js'
            path.write_text('window.MONARCH_CHAPTERS=(window.MONARCH_CHAPTERS||[]).concat(' + encode(part) + ');\n')
        novel = {
            'id': ID, 'title': title, 'author': text(metadata.find('{*}creator')),
            'genre': 'Fantasy', 'tags': [t.strip() for t in text(metadata.find('{*}subject')).split(',') if t.strip()],
            'status': 'Ongoing', 'cover': f'assets/{ID}.jpg', 'updated': '2026-10-06', 'sample': False,
            'synopsis': text(metadata.find('{*}description')),
            'license': {'type': 'EPUB edition', 'note': 'Text and cover imported from the EPUB supplied by the site owner.'},
            'lazyChunks': {'prefix': 'data/monarch-chapters-', 'capacity': CAPACITY, 'global': 'MONARCH_CHAPTERS'},
            'chapters': [{'number': c['number'], 'title': c['title'], 'paragraphs': ['Loading chapter…'], 'lazy': True} for c in chapters]
        }
        (DIST / 'licensed-monarch.js').write_text('(() => {\n  const novel = ' + encode(novel) + ';\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n  if (index >= 0) window.NOVELS[index] = novel;\n  else window.NOVELS.push(novel);\n})();\n')
        print(f'Imported {title}: {len(chapters)} chapters, {sum(len(c["paragraphs"]) for c in chapters)} paragraphs, original cover.')


if __name__ == '__main__':
    main()
