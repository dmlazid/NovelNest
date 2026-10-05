#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://freewebnovel.com/novel/got-a-gallery-in-the-wild"
TITLE = "Got a Gallery in the Wild"
AUTHOR = "Ripper_8410 / 두부두부"
FIXED_CHUNK_FILES = 10
MIN_CHUNK_CAPACITY = 50
REQUEST_DELAY = 1.1
DIST = Path("dist")
DATA_DIR = DIST / "data"
CATALOG_PATH = DIST / "licensed-gallery.js"

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/2.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
})


def get(url: str) -> str:
    last = None
    for attempt in range(7):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 429:
                retry_header = r.headers.get("Retry-After")
                try:
                    retry_after = float(retry_header) if retry_header else 0
                except (TypeError, ValueError):
                    retry_after = 0
                delay = max(retry_after, min(90, 15 + attempt * 12))
                print(f"Rate limited while fetching {url}; retrying in {delay:.0f}s...", flush=True)
                last = RuntimeError(f"HTTP 429 for {url}")
                time.sleep(delay)
                continue
            r.raise_for_status()
            return r.text
        except Exception as exc:
            last = exc
            if attempt < 6:
                delay = min(45, 2 ** (attempt + 1))
                print(f"Fetch error for {url}: {exc}; retrying in {delay}s...", flush=True)
                time.sleep(delay)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def clean_text(value: str) -> str:
    value = " ".join(value.split())
    normalized = unicodedata.normalize("NFKD", value)
    normalized = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", normalized, flags=re.I)
    return " ".join(normalized.split()).strip()


def detect_latest_chapter() -> int:
    raw = get(BASE)
    numbers = {int(n) for n in re.findall(r"got-a-gallery-in-the-wild/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        raise RuntimeError("Could not detect chapter numbers from the novel page; leaving the site unchanged.")
    latest = max(numbers)
    print(f"Latest source chapter detected: {latest}", flush=True)
    return latest


def load_existing_chapters() -> list[dict]:
    chapters: list[dict] = []
    for path in sorted(DATA_DIR.glob("gallery-chapters-*.js")):
        text = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", text, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse existing chapter file: {path}")
        part = json.loads(match.group(1))
        if not isinstance(part, list):
            raise RuntimeError(f"Invalid chapter payload in {path}")
        chapters.extend(part)
    return chapters


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
        paragraphs = [clean_text(text) for text in article.stripped_strings if clean_text(text)]

    if len(paragraphs) < 3:
        raise RuntimeError(f"Chapter {number}: only {len(paragraphs)} text blocks were found")

    title_node = soup.select_one("span.chapter")
    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    return {"title": title or f"Chapter {number}", "paragraphs": paragraphs}


def write_js_chunks(chapters: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    capacity = max(MIN_CHUNK_CAPACITY, math.ceil(len(chapters) / FIXED_CHUNK_FILES))
    if capacity * FIXED_CHUNK_FILES < len(chapters):
        raise RuntimeError("Chapter data exceeds fixed chunk capacity")

    for index in range(1, FIXED_CHUNK_FILES + 1):
        start = (index - 1) * capacity
        part = chapters[start:start + capacity]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"gallery-chapters-{index:02d}.js"
        path.write_text(
            "window.GALLERY_CHAPTERS=(window.GALLERY_CHAPTERS||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )

    for old in DATA_DIR.glob("gallery-chapters-*.js"):
        match = re.search(r"(\d+)\.js$", old.name)
        if match and int(match.group(1)) > FIXED_CHUNK_FILES:
            old.unlink()


def write_licensed_catalog(chapters: list[dict], updated: str) -> None:
    content = f"""(() => {{
  const id = 'got-a-gallery-in-the-wild';
  const chapters = window.GALLERY_CHAPTERS || [];
  const licensed = {{
    id,
    title: 'Got a Gallery in the Wild',
    author: 'Ripper_8410 / 두부두부',
    genre: 'Fantasy',
    tags: ['Fantasy','Action','Adventure','Comedy','Harem','Martial Arts','Supernatural'],
    status: 'Ongoing',
    cover: 'assets/got-a-gallery-in-the-wild.jpg',
    updated: '{updated}',
    sample: false,
    synopsis: 'I ended up in an unknown place. The only thing I can rely on is this gallery. But there are just too many strange people.',
    license: {{
      type: 'Authorized publication',
      note: 'Published on NovelNest with permission from the rights holder, as confirmed by the site owner.'
    }},
    source: 'FreeWebNovel',
    sourceUrl: 'https://freewebnovel.com/novel/got-a-gallery-in-the-wild',
    chapters
  }};
  const index = window.NOVELS.findIndex(n => n.id === id);
  if (index >= 0) window.NOVELS[index] = licensed;
  else window.NOVELS.push(licensed);
}})();
"""
    CATALOG_PATH.write_text(content, encoding="utf-8")


def current_updated_date() -> str:
    if not CATALOG_PATH.exists():
        return datetime.now(timezone.utc).date().isoformat()
    text = CATALOG_PATH.read_text(encoding="utf-8")
    match = re.search(r"updated:\s*'([^']+)'", text)
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def main() -> None:
    latest = detect_latest_chapter()
    chapters = load_existing_chapters()
    existing = len(chapters)
    print(f"NovelNest currently has {existing} chapters.", flush=True)

    if latest < existing:
        raise RuntimeError(f"Source reports only {latest} chapters, below the existing {existing}; refusing to remove chapters.")

    new_count = latest - existing
    if new_count:
        print(f"Importing {new_count} new chapter(s)...", flush=True)
        for number in range(existing + 1, latest + 1):
            chapters.append(parse_chapter(number))
            print(f"Fetched chapter {number}/{latest}", flush=True)
            if number < latest:
                time.sleep(REQUEST_DELAY)
        updated = datetime.now(timezone.utc).date().isoformat()
    else:
        print("No new chapters found.", flush=True)
        updated = current_updated_date()

    write_js_chunks(chapters)
    write_licensed_catalog(chapters, updated)
    print(f"Import complete: {len(chapters)} chapters available on NovelNest.", flush=True)


if __name__ == "__main__":
    main()
