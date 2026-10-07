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

BASE = "https://freewebnovel.com/novel/the-innkeeper"
TITLE = "The Innkeeper"
AUTHOR = "lifesketcher"
CHUNK_CAPACITY = 100
BATCH_SIZE = max(1, int(os.environ.get("INNKEEPER_BATCH_SIZE", "100")))
REQUEST_DELAY = 1.3
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-innkeeper.js"
COVER_PATH = ASSET_DIR / "the-innkeeper.jpg"
LATEST_CACHE_PATH = Path(".innkeeper-latest")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/5.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
}


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(8):
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
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


def chapter_exists(number: int) -> bool:
    url = f"{BASE}/chapter-{number}"
    last = None
    for attempt in range(6):
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
            if response.status_code == 404:
                return False
            if response.status_code == 429:
                retry = response.headers.get("Retry-After")
                try:
                    retry = float(retry) if retry else 0
                except (TypeError, ValueError):
                    retry = 0
                delay = max(retry, min(60, 6 + attempt * 8))
                time.sleep(delay)
                continue
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            article = (
                soup.select_one("div#article")
                or soup.select_one("div.txt")
                or soup.select_one("article")
                or soup.select_one("main")
            )
            if article is None:
                return False
            article_text = clean_text(article.get_text(" ", strip=True))
            page_text = clean_text(soup.get_text(" ", strip=True))
            return len(article_text) >= 300 and re.search(rf"\b{number}\b", page_text) is not None
        except Exception as exc:
            last = exc
            if attempt < 5:
                time.sleep(min(30, 2 ** (attempt + 1)))
    raise RuntimeError(f"Could not probe Innkeeper chapter {number}: {last}")


def detect_latest(page_raw: str) -> int:
    numbers = {
        int(n)
        for n in re.findall(
            r"the-innkeeper/chapter-(\d+)",
            page_raw,
            flags=re.I,
        )
    }
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\d+)", page_raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"\bChapter\s+(\d+)\b", page_raw, flags=re.I)}
    if numbers:
        latest = max(numbers)
        print(f"Latest The Innkeeper source chapter detected from index: {latest}", flush=True)
        return latest

    print("Chapter list hidden in source response; probing chapter pages directly...", flush=True)
    low, high = 0, 1
    while chapter_exists(high):
        low = high
        high *= 2
        if high > 32768:
            raise RuntimeError("Innkeeper chapter probe exceeded safety limit")

    while low + 1 < high:
        mid = (low + high) // 2
        if chapter_exists(mid):
            low = mid
        else:
            high = mid

    if low < 1:
        raise RuntimeError("Could not detect any The Innkeeper chapters")
    print(f"Latest The Innkeeper source chapter detected by probing: {low}", flush=True)
    return low


def load_existing() -> list[dict]:
    chapters: list[dict] = []
    for path in sorted(DATA_DIR.glob("innkeeper-chapters-*.js")):
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
        expected = list(range(1, len(chapters) + 1))
        if numbers != expected:
            raise RuntimeError("Existing Innkeeper data is not a continuous 1..N sequence")
    return chapters


def parse_chapter(number: int) -> dict:
    raw = get(f"{BASE}/chapter-{number}")
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

    paragraphs = []
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

    title_node = soup.select_one("span.chapter")
    if not title_node:
        for heading in soup.find_all(["h1", "h2", "h3"]):
            heading_text = clean_text(heading.get_text(" ", strip=True))
            if re.search(rf"\bChapter\s+{number}\b", heading_text, flags=re.I):
                title_node = heading
                break

    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    if not re.search(rf"\b{number}\b", title):
        title = f"Chapter {number}: {title}" if title else f"Chapter {number}"
    return {"number": number, "title": title, "paragraphs": paragraphs}


def fetch_range(start: int, end: int) -> list[dict]:
    if end < start:
        return []

    chapters: list[dict] = []
    total = end - start + 1
    print(
        f"Fetching The Innkeeper chapters {start}-{end} ({total} chapters in this checkpoint)",
        flush=True,
    )

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
        part = chapters[start : start + CHUNK_CAPACITY]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"innkeeper-chapters-{index:02d}.js"
        path.write_text(
            "window.INNKEEPER_CHAPTERS=(window.INNKEEPER_CHAPTERS||[]).concat("
            + payload
            + ");\n",
            encoding="utf-8",
        )

    for old in DATA_DIR.glob("innkeeper-chapters-*.js"):
        match = re.search(r"(\d+)\.js$", old.name)
        if match and int(match.group(1)) > count:
            old.unlink()


def ensure_cover(page_raw: str) -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 8_000:
        return

    soup = BeautifulSoup(page_raw, "html.parser")
    url = None
    for image in soup.find_all("img"):
        if "the innkeeper" in (image.get("alt") or "").lower():
            src = image.get("src") or image.get("data-src")
            if src:
                url = urljoin(BASE, src)
                break

    if not url:
        meta = soup.find("meta", attrs={"property": "og:image"})
        if meta and meta.get("content"):
            url = urljoin(BASE, meta["content"])

    if not url:
        raise RuntimeError("Could not locate The Innkeeper cover")

    data = get(url, binary=True)
    if len(data) < 8_000:
        raise RuntimeError("Downloaded Innkeeper cover is unexpectedly small")

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
        "id": "the-innkeeper",
        "title": TITLE,
        "author": AUTHOR,
        "genre": "Fantasy",
        "tags": [
            "Fantasy",
            "Action",
            "System",
            "Adventure",
            "Cultivation",
        ],
        "status": "Ongoing",
        "cover": "assets/the-innkeeper.jpg",
        "updated": updated,
        "sample": False,
        "synopsis": (
            "A young man is unexpectedly chosen by a mysterious system and becomes the host of the Midnight Inn, "
            "a supernatural establishment connected to worlds far beyond Earth. As the inn grows, he meets powerful "
            "guests, uncovers larger cosmic mysteries, and slowly learns what his unusual role truly means."
        ),
        "license": {
            "type": "Authorized publication",
            "note": "Published on NovelNest with permission from the rights holder, as confirmed by the site owner.",
        },
        "source": "FreeWebNovel",
        "sourceUrl": BASE,
        "lazyChunks": {
            "prefix": "data/innkeeper-chapters-",
            "capacity": CHUNK_CAPACITY,
            "global": "INNKEEPER_CHAPTERS",
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
                print(f"Using this workflow run's cached latest source chapter: {latest}", flush=True)
        except (OSError, ValueError):
            latest = None

    if latest is None:
        page = get(BASE)
        latest = detect_latest(page)
        LATEST_CACHE_PATH.write_text(str(latest), encoding="utf-8")

    chapters = load_existing()
    existing = len(chapters)
    print(f"NovelNest currently has {existing} The Innkeeper chapters.", flush=True)

    if latest < existing:
        print(
            f"Source currently reports {latest}, below the published {existing}; keeping every existing chapter.",
            flush=True,
        )
        target = existing
    else:
        target = min(latest, existing + BATCH_SIZE)

    if target > existing:
        chapters.extend(fetch_range(existing + 1, target))

    numbers = [int(chapter.get("number", 0)) for chapter in chapters]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError("The Innkeeper chapters are missing, duplicated, or out of order")

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

    if target > existing:
        print(
            f"Checkpoint complete: The Innkeeper advanced {existing} -> {len(chapters)} "
            f"of {latest} source chapters.",
            flush=True,
        )
    else:
        print(
            f"The Innkeeper is already caught up at {len(chapters)} chapters.",
            flush=True,
        )


if __name__ == "__main__":
    main()
