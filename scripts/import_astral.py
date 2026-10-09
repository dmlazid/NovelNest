#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import math
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://freewebnovel.com/novel/astral-pet-store"
TITLE = "Astral Pet Store"
AUTHOR = "Ancient Xi / Gu Xi / 古羲"
FIXED_CHUNK_FILES = 20
MIN_CHUNK_CAPACITY = 100
MAX_WORKERS = 4
BATCH_SIZE = max(1, min(1000, int(os.environ.get('ASTRAL_BATCH_SIZE', '100'))))
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-astral.js"
COVER_PATH = ASSET_DIR / "astral-pet-store.jpg"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/2.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
}


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(7):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 429:
                retry_header = r.headers.get("Retry-After")
                try:
                    retry_after = float(retry_header) if retry_header else 0
                except (TypeError, ValueError):
                    retry_after = 0
                delay = max(retry_after, min(90, 10 + attempt * 10))
                print(f"Rate limited while fetching {url}; retrying in {delay:.0f}s...", flush=True)
                last = RuntimeError(f"HTTP 429 for {url}")
                time.sleep(delay)
                continue
            r.raise_for_status()
            return r.content if binary else r.text
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


def detect_latest_chapter(raw: str) -> int:
    numbers = {int(n) for n in re.findall(r"astral-pet-store/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        raise RuntimeError("Could not detect chapter numbers from the Astral Pet Store page; leaving the site unchanged.")
    latest = max(numbers)
    print(f"Latest Astral Pet Store chapter detected: {latest}", flush=True)
    return latest


def load_existing_chapters() -> list[dict]:
    chapters: list[dict] = []
    for path in sorted(DATA_DIR.glob("astral-chapters-*.js")):
        text = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", text, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse existing chapter file: {path}")
        part = json.loads(match.group(1))
        if not isinstance(part, list):
            raise RuntimeError(f"Invalid chapter payload in {path}")
        chapters.extend(part)

    if chapters:
        numbers = [int(ch.get("number", i + 1)) for i, ch in enumerate(chapters)]
        expected = list(range(1, len(chapters) + 1))
        if numbers != expected:
            raise RuntimeError("Existing Astral chapter data is not a continuous 1..N sequence; refusing to append to corrupted data.")
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
    return {"number": number, "title": title or f"Chapter {number}", "paragraphs": paragraphs}


def fetch_chapters(start: int, end: int) -> list[dict]:
    if end < start:
        return []
    total = end - start + 1
    print(f"Importing {total} Astral chapter(s): {start}-{end}", flush=True)
    results: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(parse_chapter, number): number for number in range(start, end + 1)}
        for future in as_completed(futures):
            number = futures[future]
            results[number] = future.result()
            if len(results) % 25 == 0 or len(results) == total:
                print(f"Fetched {len(results)}/{total} requested chapters", flush=True)
    return [results[number] for number in range(start, end + 1)]


def chunk_capacity(chapters: list[dict]) -> int:
    return max(MIN_CHUNK_CAPACITY, math.ceil(len(chapters) / FIXED_CHUNK_FILES))


def write_js_chunks(chapters: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    capacity = chunk_capacity(chapters)
    for index in range(1, FIXED_CHUNK_FILES + 1):
        start = (index - 1) * capacity
        part = chapters[start:start + capacity]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"astral-chapters-{index:02d}.js"
        path.write_text(
            "window.ASTRAL_CHAPTERS=(window.ASTRAL_CHAPTERS||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )


def cover_url_from_page(raw: str) -> str | None:
    soup = BeautifulSoup(raw, "html.parser")
    for img in soup.find_all("img"):
        alt = (img.get("alt") or "").strip().lower()
        if alt == TITLE.lower():
            src = img.get("src") or img.get("data-src")
            if src:
                return urljoin(BASE, src)
    meta = soup.find("meta", attrs={"property": "og:image"})
    if meta and meta.get("content"):
        return urljoin(BASE, meta["content"])
    return None


def ensure_cover(raw: str) -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 10_000:
        return
    cover_url = cover_url_from_page(raw)
    if not cover_url:
        raise RuntimeError("Could not locate the Astral Pet Store cover image on the source page")
    cover = get(cover_url, binary=True)
    if len(cover) < 10_000:
        raise RuntimeError("Downloaded Astral Pet Store cover image is unexpectedly small")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    COVER_PATH.write_bytes(cover)
    print(f"Saved cover from {cover_url}", flush=True)


def write_licensed_catalog(chapters: list[dict], updated: str) -> None:
    metadata = [
        {
            "number": int(ch.get("number", i + 1)),
            "title": ch.get("title") or f"Chapter {i + 1}",
            "paragraphs": ["Loading chapter…"],
            "lazy": True,
        }
        for i, ch in enumerate(chapters)
    ]
    metadata_json = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))
    capacity = chunk_capacity(chapters)
    content = f"""(() => {{
  const id = 'astral-pet-store';
  const chapters = {metadata_json};
  const licensed = {{
    id,
    title: 'Astral Pet Store',
    author: 'Ancient Xi / Gu Xi / 古羲',
    genre: 'Action',
    tags: ['Action','Adventure','Comedy','Fantasy','School Life','Xuanhuan'],
    status: 'Completed',
    cover: 'assets/astral-pet-store.jpg',
    updated: '{updated}',
    sample: false,
    synopsis: 'After transmigrating into a world centered on astral pets, a young pet-store owner with no natural affinity receives a system that opens a path toward training extraordinary creatures and changing his fate.',
    license: {{
      type: 'Authorized publication',
      note: 'Published on NovelNest with permission from the rights holder, as confirmed by the site owner.'
    }},
    source: 'FreeWebNovel',
    sourceUrl: 'https://freewebnovel.com/novel/astral-pet-store',
    lazyChunks: {{prefix: 'data/astral-chapters-', capacity: {capacity}, global: 'ASTRAL_CHAPTERS'}},
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
    raw = get(BASE)
    latest = detect_latest_chapter(raw)
    existing_chapters = load_existing_chapters()
    existing = len(existing_chapters)
    print(f"NovelNest currently has {existing} Astral chapters.", flush=True)

    if latest < existing:
        raise RuntimeError(f"Source reports only {latest} chapters, below the existing {existing}; refusing to remove chapters.")

    target = min(latest, existing + BATCH_SIZE)
    if target > existing:
        new_chapters = fetch_chapters(existing + 1, target)
        chapters = existing_chapters + new_chapters
        updated = datetime.now(timezone.utc).date().isoformat()
    else:
        chapters = existing_chapters
        updated = current_updated_date()
        print("No new Astral chapters found.", flush=True)

    if len(chapters) != target:
        raise RuntimeError(f"Astral checkpoint count mismatch: expected {target}, built {len(chapters)}")

    numbers = [int(ch.get("number", i + 1)) for i, ch in enumerate(chapters)]
    if numbers != list(range(1, target + 1)):
        raise RuntimeError("Astral chapters are missing, duplicated, or out of order")

    write_js_chunks(chapters)
    ensure_cover(raw)
    write_licensed_catalog(chapters, updated)
    print(f"Checkpoint complete: Astral Pet Store has a clean 1-{target}/{latest} sequence with no duplicates.", flush=True)


if __name__ == "__main__":
    main()
