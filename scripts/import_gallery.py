#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
import time
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://freewebnovel.com/novel/got-a-gallery-in-the-wild"
COVER_URL = "https://freewebnovel.com/files/article/image/15/15776/15776s.jpg"
TITLE = "Got a Gallery in the Wild"
AUTHOR = "Ripper_8410 / 두부두부"
DESCRIPTION = (
    "I ended up in an unknown place. "
    "The only thing I can rely on is this gallery. "
    "But there are just too many strange people."
)
CHAPTER_COUNT = 170
CHUNK_SIZE = 17
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
DOWNLOAD_DIR = DIST / "downloads"

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/1.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
})

def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(4):
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            return r.content if binary else r.text
        except Exception as exc:
            last = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last}")

def clean_text(value: str) -> str:
    value = " ".join(value.split())
    normalized = unicodedata.normalize("NFKD", value)
    normalized = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", normalized, flags=re.I)
    return " ".join(normalized.split()).strip()

def parse_chapter(number: int) -> dict:
    url = f"{BASE}/chapter-{number}"
    raw = get(url)
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.select_one("div#article") or soup.select_one("div.txt")
    if article is None:
        raise RuntimeError(f"Chapter {number}: content container was not found")

    for node in article.select("script, style, div[id^='bg-ssp-'], div[id^='pf-'], p sub"):
        node.decompose()

    paragraphs = []
    for p in article.find_all("p"):
        text = clean_text(p.get_text(" ", strip=True))
        low = text.lower()
        if not text:
            continue
        if "this story originates from" in low or "ensure the author gets the support" in low:
            continue
        paragraphs.append(text)

    if len(paragraphs) < 3:
        paragraphs = []
        for text in article.stripped_strings:
            text = clean_text(text)
            if text:
                paragraphs.append(text)

    if len(paragraphs) < 3:
        raise RuntimeError(f"Chapter {number}: only {len(paragraphs)} text blocks were found")

    title_node = soup.select_one("span.chapter")
    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    if not title:
        title = f"Chapter {number}"
    return {"title": title, "paragraphs": paragraphs}

def write_js_chunks(chapters: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for old in DATA_DIR.glob("gallery-chapters-*.js"):
        old.unlink()
    for start in range(0, len(chapters), CHUNK_SIZE):
        part = chapters[start:start + CHUNK_SIZE]
        index = start // CHUNK_SIZE + 1
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"gallery-chapters-{index:02d}.js"
        path.write_text(
            "window.GALLERY_CHAPTERS=(window.GALLERY_CHAPTERS||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )

def write_licensed_catalog() -> None:
    content = """(() => {
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
    epub: 'downloads/got-a-gallery-in-the-wild.epub',
    source: 'FreeWebNovel',
    chapters
  };
  const index = window.NOVELS.findIndex(n => n.id === id);
  if (index >= 0) window.NOVELS[index] = licensed;
  else window.NOVELS.push(licensed);
})();
"""
    (DIST / "licensed-gallery.js").write_text(content, encoding="utf-8")

def chapter_xhtml(number: int, chapter: dict) -> str:
    body = "\n".join(f"<p>{html.escape(p)}</p>" for p in chapter["paragraphs"])
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><title>{html.escape(chapter["title"])}</title>
<meta charset="utf-8"/>
<style>body{{font-family:serif;line-height:1.65;margin:5%;}}h1{{font-size:1.5em;}}p{{margin:0 0 1em;}}</style>
</head>
<body><h1>Chapter {number}: {html.escape(chapter["title"])}</h1>{body}</body>
</html>"""

def build_epub(chapters: list[dict], cover: bytes) -> None:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    path = DOWNLOAD_DIR / "got-a-gallery-in-the-wild.epub"
    book_id = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, BASE)}"
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
    ]
    spine = []
    nav_items = []
    for i, chapter in enumerate(chapters, 1):
        manifest.append(f'<item id="c{i}" href="Text/chapter-{i:03d}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{i}"/>')
        nav_items.append(f'<li><a href="Text/chapter-{i:03d}.xhtml">Chapter {i}: {html.escape(chapter["title"])}</a></li>')

    opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">{book_id}</dc:identifier>
<dc:title>{html.escape(TITLE)}</dc:title>
<dc:creator>{html.escape(AUTHOR)}</dc:creator>
<dc:language>en</dc:language>
<dc:publisher>NovelNest</dc:publisher>
<dc:description>{html.escape(DESCRIPTION)}</dc:description>
<dc:rights>Published on NovelNest with permission from the rights holder.</dc:rights>
<meta property="dcterms:modified">{modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>{''.join(manifest)}</manifest>
<spine>{''.join(spine)}</spine>
</package>"""

    nav = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Contents</title><meta charset="utf-8"/></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{''.join(nav_items)}</ol></nav></body>
</html>"""

    container = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/Images/cover.jpg", cover, compress_type=zipfile.ZIP_DEFLATED)
        for i, chapter in enumerate(chapters, 1):
            z.writestr(
                f"OEBPS/Text/chapter-{i:03d}.xhtml",
                chapter_xhtml(i, chapter),
                compress_type=zipfile.ZIP_DEFLATED,
            )

def main() -> None:
    print(f"Importing {CHAPTER_COUNT} authorized chapters...")
    chapters = []
    for number in range(1, CHAPTER_COUNT + 1):
        chapters.append(parse_chapter(number))
        print(f"Fetched chapter {number}/{CHAPTER_COUNT}")
        time.sleep(0.25)

    cover = get(COVER_URL, binary=True)
    if len(cover) < 10_000:
        raise RuntimeError("Downloaded cover image is unexpectedly small")

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    (ASSET_DIR / "got-a-gallery-in-the-wild.jpg").write_bytes(cover)
    write_js_chunks(chapters)
    write_licensed_catalog()
    build_epub(chapters, cover)

    if len(chapters) != CHAPTER_COUNT:
        raise RuntimeError("Chapter count mismatch")
    print("Import complete: 170 chapters, cover, chapter data, and EPUB generated.")

if __name__ == "__main__":
    main()
