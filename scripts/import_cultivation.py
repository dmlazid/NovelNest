#!/usr/bin/env python3
from __future__ import annotations

import json
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

BASE = "https://freewebnovel.com/novel/cultivation-online-novel"
TITLE = "Cultivation Online"
AUTHOR = "Mylittlebrother"
FIXED_CHUNK_FILES = 40
MIN_CHUNK_CAPACITY = 75
MAX_WORKERS = 8
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-cultivation.js"
COVER_PATH = ASSET_DIR / "cultivation-online.jpg"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/4.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
}


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(8):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 429:
                retry = r.headers.get("Retry-After")
                try:
                    retry = float(retry) if retry else 0
                except (TypeError, ValueError):
                    retry = 0
                delay = max(retry, min(90, 8 + attempt * 10))
                print(f"Rate limited: {url}; retrying in {delay:.0f}s", flush=True)
                last = RuntimeError(f"HTTP 429 for {url}")
                time.sleep(delay)
                continue
            r.raise_for_status()
            return r.content if binary else r.text
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


def detect_latest(page_raw: str) -> int:
    numbers = {int(n) for n in re.findall(r"cultivation-online-novel/chapter-(\\d+)", page_raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\\d+)", page_raw, flags=re.I)}
    if not numbers:
        raise RuntimeError("Could not detect Cultivation Online chapter numbers from the source page")
    latest = max(numbers)
    print(f"Latest Cultivation Online source chapter detected: {latest}", flush=True)
    return latest


def load_existing() -> list[dict]:
    chapters: list[dict] = []
    for path in sorted(DATA_DIR.glob("cultivation-chapters-*.js")):
        raw = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", raw, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse {path}")
        chapters.extend(json.loads(match.group(1)))
    if chapters:
        numbers = [int(c.get("number", i + 1)) for i, c in enumerate(chapters)]
        if numbers != list(range(1, len(chapters) + 1)):
            raise RuntimeError("Existing Cultivation data is not a continuous 1..N sequence")
    return chapters


def parse_chapter(number: int) -> dict:
    raw = get(f"{BASE}/chapter-{number}")
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.select_one("div#article") or soup.select_one("div.txt")
    if article is None:
        # Keep a fallback for minor source-layout changes, but require substantial text below.
        article = soup.select_one("article") or soup.select_one("main")
    if article is None:
        raise RuntimeError(f"Chapter {number}: content container not found")

    for node in article.select("script, style, noscript, div[id^='bg-ssp-'], div[id^='pf-'], p sub, nav, aside"):
        node.decompose()

    paragraphs = []
    for p in article.find_all("p"):
        value = clean_text(p.get_text(" ", strip=True))
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
            if not value or "this story originates from" in low or "ensure the author gets the support" in low:
                continue
            paragraphs.append(value)

    chars = sum(len(p) for p in paragraphs)
    if len(paragraphs) < 3 or chars < 400:
        raise RuntimeError(f"Chapter {number}: only {len(paragraphs)} blocks / {chars} characters found")

    title_node = soup.select_one("span.chapter") or soup.select_one("h1")
    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    if not re.search(rf"\b{number}\b", title):
        title = f"Chapter {number}: {title}" if title else f"Chapter {number}"
    return {"number": number, "title": title, "paragraphs": paragraphs}


def fetch_range(start: int, end: int) -> list[dict]:
    if end < start:
        return []
    numbers = list(range(start, end + 1))
    results: dict[int, dict] = {}
    print(f"Fetching Cultivation Online chapters {start}-{end} ({len(numbers)} chapters)", flush=True)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(parse_chapter, n): n for n in numbers}
        for future in as_completed(futures):
            n = futures[future]
            results[n] = future.result()
            if len(results) % 25 == 0 or len(results) == len(numbers):
                print(f"Fetched {len(results)}/{len(numbers)}", flush=True)
    return [results[n] for n in numbers]


def chunk_capacity(chapters: list[dict]) -> int:
    return max(MIN_CHUNK_CAPACITY, math.ceil(len(chapters) / FIXED_CHUNK_FILES))


def write_chunks(chapters: list[dict]) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cap = chunk_capacity(chapters)
    for i in range(1, FIXED_CHUNK_FILES + 1):
        start = (i - 1) * cap
        part = chapters[start:start + cap]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        (DATA_DIR / f"cultivation-chapters-{i:02d}.js").write_text(
            "window.CULTIVATION_CHAPTERS=(window.CULTIVATION_CHAPTERS||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )
    return cap


def ensure_cover(page_raw: str) -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 8_000:
        return
    soup = BeautifulSoup(page_raw, "html.parser")
    url = None
    for img in soup.find_all("img"):
        if "cultivation online" in (img.get("alt") or "").lower():
            src = img.get("src") or img.get("data-src")
            if src:
                url = urljoin(BASE, src)
                break
    if not url:
        meta = soup.find("meta", attrs={"property": "og:image"})
        if meta and meta.get("content"):
            url = urljoin(BASE, meta["content"])
    if not url:
        raise RuntimeError("Could not locate Cultivation Online cover")
    data = get(url, binary=True)
    if len(data) < 8_000:
        raise RuntimeError("Downloaded Cultivation cover is unexpectedly small")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    COVER_PATH.write_bytes(data)


def write_catalog(chapters: list[dict], cap: int, updated: str) -> None:
    metadata = [
        {"number": c["number"], "title": c.get("title") or f"Chapter {c['number']}", "paragraphs": ["Loading chapter…"], "lazy": True}
        for c in chapters
    ]
    novel = {
        "id": "cultivation-online",
        "title": TITLE,
        "author": AUTHOR,
        "genre": "Adventure",
        "tags": ["Adventure", "Comedy", "Romance", "Action", "Harem", "Game", "System", "Cultivation"],
        "status": "Ongoing",
        "cover": "assets/cultivation-online.jpg",
        "updated": updated,
        "sample": False,
        "synopsis": "Yuan was born with an incurable illness that left him blind at a young age and crippled a few years later, rendering everything below his head useless. Deemed hopeless and irredeemable, his parents quickly gave up on him, and the world ignored him. In this dark and still world, his younger sister became his sole reason for living. Watch as this young man reaches for the apex as a genius in Cultivation Online, the newest VRMMORPG, becoming a legendary figure in both worlds.",
        "license": {"type": "Authorized publication", "note": "Published on NovelNest with permission from the rights holder, as confirmed by the site owner."},
        "source": "FreeWebNovel",
        "sourceUrl": BASE,
        "lazyChunks": {"prefix": "data/cultivation-chapters-", "capacity": cap, "global": "CULTIVATION_CHAPTERS"},
        "chapters": metadata,
    }
    CATALOG_PATH.write_text(
        "(() => {\n  const novel = " + json.dumps(novel, ensure_ascii=False, separators=(",", ":")) + ";\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n  if (index >= 0) window.NOVELS[index] = novel;\n  else window.NOVELS.push(novel);\n})();\n",
        encoding="utf-8",
    )


def current_updated_date() -> str:
    if not CATALOG_PATH.exists():
        return datetime.now(timezone.utc).date().isoformat()
    text = CATALOG_PATH.read_text(encoding="utf-8")
    match = re.search(r'"updated":"([^"]+)"', text)
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def main() -> None:
    page = get(BASE)
    latest = detect_latest(page)
    chapters = load_existing()
    existing = len(chapters)
    print(f"NovelNest currently has {existing} Cultivation Online chapters.", flush=True)

    if latest < existing:
        print(f"Source currently reports {latest}, below the published {existing}; keeping all existing chapters.", flush=True)
        target = existing
    else:
        target = latest

    if existing < target:
        chapters.extend(fetch_range(existing + 1, target))

    numbers = [int(c.get("number", i + 1)) for i, c in enumerate(chapters)]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError("Cultivation Online chapters are missing, duplicated, or out of order")

    cap = write_chunks(chapters)
    ensure_cover(page)
    updated = datetime.now(timezone.utc).date().isoformat() if target > existing else current_updated_date()
    write_catalog(chapters, cap, updated)
    print(f"Import complete: Cultivation Online has chapters 1-{len(chapters)}, with no gaps or duplicates.", flush=True)


if __name__ == "__main__":
    main()
