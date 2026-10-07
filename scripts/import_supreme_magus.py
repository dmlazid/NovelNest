#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://freewebnovel.com/novel/supreme-magus-novel"
TITLE = "Supreme Magus"
AUTHOR = "Legion20"
KEY = "supreme-magus"
NOVEL_ID = "supreme-magus"
SOURCE_OFFSET = 2
CHUNK_CAPACITY = 100
BATCH_SIZE = max(1, int(os.environ.get("SUPREME_MAGUS_BATCH_SIZE", "100")))
REQUEST_DELAY = 1.3

DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-supreme-magus.js"
COVER_PATH = ASSET_DIR / "supreme-magus.jpg"
INDEX_PATH = DIST / "index.html"
LATEST_CACHE_PATH = Path(".supreme-magus-latest")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/1.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
}

session = requests.Session()
session.headers.update(HEADERS)


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(8):
        try:
            response = session.get(url, timeout=30)
            if response.status_code == 429:
                retry = response.headers.get("Retry-After")
                try:
                    retry = float(retry) if retry else 0
                except (TypeError, ValueError):
                    retry = 0
                delay = max(retry, min(90, 8 + attempt * 10))
                print(f"Rate limited: {url}; retrying in {delay:.0f}s", flush=True)
                last = RuntimeError(f"HTTP 429 for {url}")
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.content if binary else response.text
        except Exception as exc:
            last = exc
            if attempt < 7:
                delay = min(45, 2 ** (attempt + 1))
                print(f"Fetch error: {url}: {exc}; retrying in {delay}s", flush=True)
                time.sleep(delay)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def clean_text(value: str) -> str:
    value = " ".join(value.split())
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", value, flags=re.I)
    return " ".join(value.split()).strip()


def source_index(number: int) -> int:
    return number + SOURCE_OFFSET


def chapter_page(number: int) -> str:
    return f"{BASE}/chapter-{source_index(number)}"


def chapter_exists(number: int) -> bool:
    if number < 1:
        return False
    try:
        raw = get(chapter_page(number))
    except Exception:
        return False

    soup = BeautifulSoup(raw, "html.parser")
    heading_text = " ".join(
        clean_text(node.get_text(" ", strip=True))
        for node in soup.select("span.chapter, h1, h2, h3")
    )
    return re.search(rf"\bChapter\s+{number}\b", heading_text, flags=re.I) is not None


def detect_latest(page_raw: str) -> int:
    visible = {int(n) for n in re.findall(r"\bChapter\s+(\d+)\b", page_raw, flags=re.I)}
    low = max(visible) if visible else 1

    if not chapter_exists(low):
        low = 1
        if not chapter_exists(low):
            raise RuntimeError("Could not verify Supreme Magus Chapter 1 at its source")

    step = 1
    while chapter_exists(low + step):
        low += step
        step *= 2
        if low > 20000:
            raise RuntimeError("Supreme Magus chapter probe exceeded safety limit")
        time.sleep(REQUEST_DELAY)

    high = low + step
    while low + 1 < high:
        mid = (low + high) // 2
        if chapter_exists(mid):
            low = mid
        else:
            high = mid
        time.sleep(REQUEST_DELAY)

    print(f"Latest Supreme Magus source chapter detected: {low}", flush=True)
    return low


def load_existing() -> list[dict]:
    chapters: list[dict] = []
    for path in sorted(DATA_DIR.glob(f"{KEY}-chapters-*.js")):
        raw = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", raw, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse {path}")
        part = json.loads(match.group(1))
        if not isinstance(part, list):
            raise RuntimeError(f"Invalid chapter payload in {path}")
        chapters.extend(part)

    if chapters:
        numbers = [int(chapter.get("number", 0)) for chapter in chapters]
        if numbers != list(range(1, len(chapters) + 1)):
            raise RuntimeError("Existing Supreme Magus data is not a continuous 1..N sequence")
    return chapters


def parse_chapter(number: int) -> dict:
    raw = get(chapter_page(number))
    soup = BeautifulSoup(raw, "html.parser")
    article = (
        soup.select_one("div#article")
        or soup.select_one("div.txt")
        or soup.select_one("article")
        or soup.select_one("main")
    )
    if article is None:
        raise RuntimeError(f"Chapter {number}: content container not found")

    for node in article.select(
        "script, style, noscript, div[id^='bg-ssp-'], div[id^='pf-'], p sub, nav, aside"
    ):
        node.decompose()

    paragraphs: list[str] = []
    for paragraph in article.find_all("p"):
        value = clean_text(paragraph.get_text(" ", strip=True))
        low = value.lower()
        if not value:
            continue
        if "this story originates from" in low or "ensure the author gets the support" in low:
            continue
        paragraphs.append(value)

    if len(paragraphs) < 3:
        paragraphs = []
        for value in article.stripped_strings:
            value = clean_text(value)
            low = value.lower()
            if not value:
                continue
            if "this story originates from" in low or "ensure the author gets the support" in low:
                continue
            paragraphs.append(value)

    characters = sum(len(p) for p in paragraphs)
    if len(paragraphs) < 3 or characters < 400:
        raise RuntimeError(
            f"Chapter {number}: only {len(paragraphs)} blocks / {characters} characters found"
        )

    title = ""
    for node in soup.select("span.chapter, h1, h2, h3"):
        candidate = clean_text(node.get_text(" ", strip=True))
        if re.search(rf"\bChapter\s+{number}\b", candidate, flags=re.I):
            title = candidate
            break
    if not title:
        title = f"Chapter {number}"

    if not re.match(rf"^Chapter\s+{number}\b", title, flags=re.I):
        title = f"Chapter {number}: {title}"

    return {"number": number, "title": title, "paragraphs": paragraphs}


def fetch_range(start: int, end: int) -> list[dict]:
    chapters: list[dict] = []
    if end < start:
        return chapters

    total = end - start + 1
    print(f"Fetching Supreme Magus chapters {start}-{end} ({total} chapters)", flush=True)
    for number in range(start, end + 1):
        chapters.append(parse_chapter(number))
        done = number - start + 1
        if done % 10 == 0 or number == end:
            print(f"Fetched {done}/{total}", flush=True)
        if number < end:
            time.sleep(REQUEST_DELAY)
    return chapters


def write_chunks(chapters: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    count = math.ceil(len(chapters) / CHUNK_CAPACITY)
    for index in range(1, count + 1):
        start = (index - 1) * CHUNK_CAPACITY
        part = chapters[start:start + CHUNK_CAPACITY]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"{KEY}-chapters-{index:02d}.js"
        path.write_text(
            "window.SUPREME_MAGUS_CHAPTERS=(window.SUPREME_MAGUS_CHAPTERS||[]).concat("
            + payload
            + ");\n",
            encoding="utf-8",
        )

    for old in DATA_DIR.glob(f"{KEY}-chapters-*.js"):
        match = re.search(r"(\d+)\.js$", old.name)
        if match and int(match.group(1)) > count:
            old.unlink()


def ensure_cover(page_raw: str) -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 8_000:
        return

    soup = BeautifulSoup(page_raw, "html.parser")
    url = None
    for image in soup.find_all("img"):
        if "supreme magus" in (image.get("alt") or "").lower():
            src = image.get("src") or image.get("data-src")
            if src:
                url = urljoin(BASE, src)
                break

    if not url:
        url = "https://freewebnovel.com/files/article/image/0/871/871s.jpg"

    data = get(url, binary=True)
    if len(data) < 8_000:
        raise RuntimeError("Downloaded Supreme Magus cover is unexpectedly small")

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    COVER_PATH.write_bytes(data)


def write_catalog(chapters: list[dict], updated: str) -> None:
    metadata = [
        {
            "number": chapter["number"],
            "title": chapter.get("title") or f"Chapter {chapter['number']}",
            "paragraphs": ["Loading chapter…"],
            "lazy": True,
        }
        for chapter in chapters
    ]

    novel = {
        "id": NOVEL_ID,
        "title": TITLE,
        "author": AUTHOR,
        "genre": "Fantasy",
        "tags": ["Fantasy", "Action", "Adventure", "Reincarnation", "Magic"],
        "status": "Ongoing",
        "cover": "assets/supreme-magus.jpg",
        "updated": updated,
        "sample": False,
        "synopsis": (
            "Derek McCoy has spent his life surviving one hardship after another. "
            "After losing everything and dying in pursuit of revenge, he is reborn in a world "
            "where magic is real. With another chance at life, he begins a long journey from "
            "a wounded soul toward becoming the Supreme Magus."
        ),
        "license": {
            "type": "Authorized publication",
            "note": "Published on NovelNest with permission from the rights holder, as confirmed by the site owner.",
        },
        "source": "FreeWebNovel",
        "sourceUrl": BASE,
        "lazyChunks": {
            "prefix": f"data/{KEY}-chapters-",
            "capacity": CHUNK_CAPACITY,
            "global": "SUPREME_MAGUS_CHAPTERS",
        },
        "chapters": metadata,
    }

    CATALOG_PATH.write_text(
        "(() => {\n  const novel = "
        + json.dumps(novel, ensure_ascii=False, separators=(",", ":"))
        + ";\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n"
        + "  if (index >= 0) window.NOVELS[index] = novel;\n"
        + "  else window.NOVELS.push(novel);\n})();\n",
        encoding="utf-8",
    )


def ensure_index_script() -> None:
    text = INDEX_PATH.read_text(encoding="utf-8")
    tag = '<script defer src="licensed-supreme-magus.js"></script>'
    if tag in text:
        return

    anchor = '<script defer src="app.js'
    pos = text.find(anchor)
    if pos < 0:
        raise RuntimeError("Could not find app.js script tag in dist/index.html")
    text = text[:pos] + tag + text[pos:]
    INDEX_PATH.write_text(text, encoding="utf-8")


def current_updated_date() -> str:
    if not CATALOG_PATH.exists():
        return datetime.now(timezone.utc).date().isoformat()
    text = CATALOG_PATH.read_text(encoding="utf-8")
    match = re.search(r'"updated":"([^"]+)"', text)
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def main() -> None:
    page = None
    latest = None

    if LATEST_CACHE_PATH.exists():
        try:
            cached = int(LATEST_CACHE_PATH.read_text(encoding="utf-8").strip())
            if cached > 0:
                latest = cached
                print(f"Using cached latest Supreme Magus chapter: {latest}", flush=True)
        except (OSError, ValueError):
            latest = None

    if latest is None:
        page = get(BASE)
        latest = detect_latest(page)
        LATEST_CACHE_PATH.write_text(str(latest), encoding="utf-8")

    chapters = load_existing()
    existing = len(chapters)
    print(f"NovelNest currently has {existing} Supreme Magus chapters.", flush=True)

    if latest < existing:
        print(f"Source currently reports {latest}; keeping all {existing} existing chapters.", flush=True)
        target = existing
    else:
        target = min(latest, existing + BATCH_SIZE)

    if target > existing:
        chapters.extend(fetch_range(existing + 1, target))

    numbers = [int(chapter.get("number", 0)) for chapter in chapters]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError("Supreme Magus chapters are missing, duplicated, or out of order")

    if page is None and (not COVER_PATH.exists() or COVER_PATH.stat().st_size <= 8_000):
        page = get(BASE)
    if page is not None:
        ensure_cover(page)

    write_chunks(chapters)
    updated = (
        datetime.now(timezone.utc).date().isoformat()
        if target > existing
        else current_updated_date()
    )
    write_catalog(chapters, updated)
    ensure_index_script()

    if target > existing:
        print(f"Checkpoint complete: Supreme Magus advanced {existing} -> {len(chapters)} of {latest}.", flush=True)
    else:
        print(f"Supreme Magus is caught up at {len(chapters)} chapters.", flush=True)


if __name__ == "__main__":
    main()
