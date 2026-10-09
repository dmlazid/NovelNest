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

BASE = "https://freewebnovel.com/novel/investing-in-my-three-crippled-wives-get-10000x-times-return"
TITLE = "Investing In My Three Crippled Wives Get 10,000x Times Return"
AUTHOR = "The_First_Legion"
INITIAL_TARGET = 250
BATCH_SIZE = max(1, min(1000, int(os.environ.get('INVESTING_BATCH_SIZE', '100'))))
FIXED_CHUNK_FILES = 10
MIN_CHUNK_CAPACITY = 50
MAX_WORKERS = 5
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-investing.js"
INDEX_PATH = DIST / "index.html"
COVER_PATH = ASSET_DIR / "investing-in-my-three-crippled-wives-get-10000x-times-return.jpg"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/3.1; +https://github.com/dmlazid/NovelNest)",
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
                delay = max(retry_after, min(90, 8 + attempt * 10))
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
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", value, flags=re.I)
    return " ".join(value.split()).strip()


def detect_latest(raw: str) -> int | None:
    numbers = {int(n) for n in re.findall(r"investing-in-my-three-crippled-wives-get-10000x-times-return/chapter-(\d+)", raw, re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\d+)", raw, re.I)}
    return max(numbers) if numbers else None


def load_existing() -> list[dict]:
    chapters = []
    for path in sorted(DATA_DIR.glob("investing-chapters-*.js")):
        raw = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", raw, re.S)
        if not match:
            raise RuntimeError(f"Could not parse {path}")
        chapters.extend(json.loads(match.group(1)))
    if chapters:
        numbers = [int(c.get("number", i + 1)) for i, c in enumerate(chapters)]
        if numbers != list(range(1, len(chapters) + 1)):
            raise RuntimeError("Existing Investing chapter data is not a clean 1..N sequence")
    return chapters


def parse_chapter(number: int) -> dict:
    raw = get(f"{BASE}/chapter-{number}")
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.select_one("div#article") or soup.select_one("div.txt") or soup.select_one("article")
    if article is None:
        raise RuntimeError(f"Chapter {number}: content container was not found")
    for node in article.select("script, style, div[id^='bg-ssp-'], div[id^='pf-'], p sub"):
        node.decompose()
    paragraphs = []
    for p in article.find_all("p"):
        value = clean_text(p.get_text(" ", strip=True))
        low = value.lower()
        if not value or "this story originates from" in low or "ensure the author gets the support" in low:
            continue
        paragraphs.append(value)
    if len(paragraphs) < 3:
        paragraphs = [clean_text(v) for v in article.stripped_strings if clean_text(v)]
    if len(paragraphs) < 3 or sum(len(v) for v in paragraphs) < 400:
        raise RuntimeError(f"Chapter {number}: insufficient text")
    title_node = soup.select_one("span.chapter") or soup.find("h1")
    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    return {"number": number, "title": title or f"Chapter {number}", "paragraphs": paragraphs}


def fetch_range(start: int, end: int) -> list[dict]:
    if end < start:
        return []
    numbers = list(range(start, end + 1))
    print(f"Fetching Investing chapters {start}-{end}", flush=True)
    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(parse_chapter, n): n for n in numbers}
        for future in as_completed(futures):
            n = futures[future]
            results[n] = future.result()
            if len(results) % 25 == 0 or len(results) == len(numbers):
                print(f"Fetched {len(results)}/{len(numbers)} requested chapters", flush=True)
    return [results[n] for n in numbers]


def capacity(chapters: list[dict]) -> int:
    return max(MIN_CHUNK_CAPACITY, math.ceil(len(chapters) / FIXED_CHUNK_FILES))


def write_chunks(chapters: list[dict]) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cap = capacity(chapters)
    for i in range(1, FIXED_CHUNK_FILES + 1):
        start = (i - 1) * cap
        part = chapters[start:start + cap]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        (DATA_DIR / f"investing-chapters-{i:02d}.js").write_text(
            "window.INVESTING_CHAPTERS=(window.INVESTING_CHAPTERS||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )
    return cap


def ensure_cover(raw: str) -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 8_000:
        return
    soup = BeautifulSoup(raw, "html.parser")
    url = None
    meta = soup.find("meta", attrs={"property": "og:image"})
    if meta and meta.get("content"):
        url = urljoin(BASE, meta["content"])
    if not url:
        for img in soup.find_all("img"):
            if "crippled wives" in (img.get("alt") or "").lower():
                src = img.get("src") or img.get("data-src")
                if src:
                    url = urljoin(BASE, src)
                    break
    if not url:
        raise RuntimeError("Could not locate Investing cover")
    data = get(url, binary=True)
    if len(data) < 8_000:
        raise RuntimeError("Downloaded Investing cover is unexpectedly small")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    COVER_PATH.write_bytes(data)


def write_catalog(chapters: list[dict], cap: int, updated: str) -> None:
    metadata = [{"number": c["number"], "title": c.get("title") or f"Chapter {c['number']}", "paragraphs": ["Loading chapter…"], "lazy": True} for c in chapters]
    novel = {
        "id": "investing-in-my-three-crippled-wives-get-10000x-times-return",
        "title": TITLE,
        "author": AUTHOR,
        "genre": "Fantasy",
        "tags": ["Fantasy", "Romance", "System", "Action", "Adult", "Adventure", "Harem"],
        "status": "Ongoing",
        "cover": "assets/investing-in-my-three-crippled-wives-get-10000x-times-return.jpg",
        "updated": updated,
        "sample": False,
        "synopsis": "Three broken women, a desperate outcast, and two powerful systems collide when Dexter Ashford signs a marriage contract tying him to three former S-Rank heroines. Every investment he makes in helping them recover can return rewards multiplied ten-thousandfold, changing the fate of a family everyone else discarded.",
        "license": {"type": "Authorized publication", "note": "Published on NovelNest with permission from the rights holder, as confirmed by the site owner."},
        "source": "FreeWebNovel",
        "sourceUrl": BASE,
        "lazyChunks": {"prefix": "data/investing-chapters-", "capacity": cap, "global": "INVESTING_CHAPTERS"},
        "chapters": metadata,
    }
    CATALOG_PATH.write_text(
        "(() => {\n  const novel = " + json.dumps(novel, ensure_ascii=False, separators=(",", ":")) + ";\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n  if (index >= 0) window.NOVELS[index] = novel;\n  else window.NOVELS.push(novel);\n})();\n",
        encoding="utf-8",
    )


def ensure_index_registration() -> None:
    if not INDEX_PATH.exists():
        raise RuntimeError("dist/index.html is missing")
    html = INDEX_PATH.read_text(encoding="utf-8")
    tag = '<script defer src="licensed-investing.js"></script>'
    if tag in html:
        return
    anchor = '<script defer src="app.js"></script>'
    if anchor not in html:
        raise RuntimeError("Could not find app.js script tag in dist/index.html")
    INDEX_PATH.write_text(html.replace(anchor, tag + anchor, 1), encoding="utf-8")
    print("Registered licensed-investing.js in dist/index.html", flush=True)


def main() -> None:
    raw = get(BASE)
    detected = detect_latest(raw)
    existing = load_existing()
    count = len(existing)
    latest = max(INITIAL_TARGET, detected or 0) if count == 0 else max(count, detected or count)
    target = min(latest, count + BATCH_SIZE)
    print(f"Investing source reports {detected or 'unknown'} chapters; checkpoint target {target}/{latest}", flush=True)
    chapters = list(existing)
    if len(chapters) < target:
        chapters.extend(fetch_range(len(chapters) + 1, target))
    numbers = [int(c.get("number", i + 1)) for i, c in enumerate(chapters)]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError("Investing chapters are missing, duplicated, or out of order")
    cap = write_chunks(chapters)
    ensure_cover(raw)
    write_catalog(chapters, cap, datetime.now(timezone.utc).date().isoformat())
    ensure_index_registration()
    print(f"Import complete: Investing novel has a clean 1-{len(chapters)} sequence.", flush=True)


if __name__ == "__main__":
    main()
