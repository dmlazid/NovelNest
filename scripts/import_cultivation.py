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

NOVEL_PAGE = "https://novelrare.com/novel/cultivation-online/"
CHAPTER_URL = "https://novelrare.com/novel/cultivation-online/chapter-{number}/"
TITLE = "Cultivation Online"
AUTHOR = "Mylittlebrother"
TARGET = 2663
FIXED_CHUNK_FILES = 40
MIN_CHUNK_CAPACITY = 75
MAX_WORKERS = 6
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-cultivation.js"
COVER_PATH = ASSET_DIR / "cultivation-online.jpg"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/3.1; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
}


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(7):
        try:
            r = requests.get(url, headers=HEADERS, timeout=35)
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
    value = " ".join(value.split()).strip()
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", value, flags=re.I)
    return " ".join(value.split()).strip()


def is_noise(value: str) -> bool:
    low = value.lower().strip()
    if not low:
        return True
    if low in {"previous chapter", "next chapter", "chapter list", "home", "novelrare.com", "read novel", "table of contents", "bookmark", "report chapter"}:
        return True
    return any(piece in low for piece in (
        "this story originates from", "ensure the author gets the support",
        "read more chapters", "please disable adblock", "novelrare is",
    ))


def load_existing_chapters() -> list[dict]:
    chapters: list[dict] = []
    for path in sorted(DATA_DIR.glob("cultivation-chapters-*.js")):
        raw = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", raw, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse existing chapter file: {path}")
        part = json.loads(match.group(1))
        if not isinstance(part, list):
            raise RuntimeError(f"Invalid chapter payload in {path}")
        chapters.extend(part)
    if chapters:
        numbers = [int(ch.get("number", i + 1)) for i, ch in enumerate(chapters)]
        if numbers != list(range(1, len(chapters) + 1)):
            raise RuntimeError("Existing Cultivation Online data is not a clean 1..N sequence")
    return chapters


def content_candidate(soup: BeautifulSoup):
    selectors = [
        ".chapter-content", ".entry-content", ".reading-content", ".chapter-body",
        ".text-left", ".post-content", "article .content", "article", "main",
    ]
    candidates = []
    for selector in selectors:
        for node in soup.select(selector):
            value = clean_text(node.get_text(" ", strip=True))
            if len(value) > 500:
                candidates.append((len(value), node))
    return max(candidates, key=lambda item: item[0])[1] if candidates else (soup.body or soup)


def parse_chapter(number: int) -> dict:
    raw = get(CHAPTER_URL.format(number=number))
    soup = BeautifulSoup(raw, "html.parser")
    for node in soup.select("script, style, noscript, nav, header, footer, aside, form, iframe"):
        node.decompose()

    title_node = soup.find("h1") or soup.find("h2")
    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    title = re.sub(r"^Cultivation Online\s*[-–:]\s*", "", title, flags=re.I).strip()
    if not re.search(rf"\b{number}\b", title):
        title = f"Chapter {number}: {title}" if title else f"Chapter {number}"

    container = content_candidate(soup)
    paragraphs = []
    for p in container.find_all("p"):
        value = clean_text(p.get_text(" ", strip=True))
        if value and not is_noise(value):
            paragraphs.append(value)
    if len(paragraphs) < 3:
        paragraphs = []
        for value in container.stripped_strings:
            value = clean_text(value)
            if value and not is_noise(value) and value != title:
                paragraphs.append(value)

    while paragraphs and (re.fullmatch(rf"(?:Chapter\s+)?{number}(?:\s*[:.-].*)?", paragraphs[0], re.I) or paragraphs[0] == title):
        paragraphs.pop(0)
    paragraphs = [p for p in paragraphs if len(p) > 1]
    combined = sum(len(p) for p in paragraphs)
    if len(paragraphs) < 3 or combined < 500:
        raise RuntimeError(f"Chapter {number}: only {len(paragraphs)} usable blocks / {combined} characters were found")
    return {"number": number, "title": title or f"Chapter {number}", "paragraphs": paragraphs}


def fetch_chapters(numbers: list[int]) -> list[dict]:
    if not numbers:
        return []
    print(f"Fetching {len(numbers)} Cultivation Online chapter(s): {numbers[0]}-{numbers[-1]}", flush=True)
    results: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(parse_chapter, number): number for number in numbers}
        for future in as_completed(futures):
            number = futures[future]
            results[number] = future.result()
            if len(results) % 25 == 0 or len(results) == len(numbers):
                print(f"Fetched {len(results)}/{len(numbers)} requested chapters", flush=True)
    return [results[n] for n in numbers]


def chunk_capacity(chapters: list[dict]) -> int:
    return max(MIN_CHUNK_CAPACITY, math.ceil(len(chapters) / FIXED_CHUNK_FILES))


def write_chunks(chapters: list[dict]) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    capacity = chunk_capacity(chapters)
    for index in range(1, FIXED_CHUNK_FILES + 1):
        start = (index - 1) * capacity
        part = chapters[start:start + capacity]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        (DATA_DIR / f"cultivation-chapters-{index:02d}.js").write_text(
            "window.CULTIVATION_CHAPTERS=(window.CULTIVATION_CHAPTERS||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )
    return capacity


def cover_from_page(raw: str) -> str | None:
    soup = BeautifulSoup(raw, "html.parser")
    meta = soup.find("meta", attrs={"property": "og:image"})
    if meta and meta.get("content"):
        return urljoin(NOVEL_PAGE, meta["content"])
    for img in soup.find_all("img"):
        if "cultivation online" in (img.get("alt") or "").lower():
            src = img.get("src") or img.get("data-src")
            if src:
                return urljoin(NOVEL_PAGE, src)
    return None


def ensure_cover(raw: str) -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 8_000:
        return
    url = cover_from_page(raw)
    if not url:
        raise RuntimeError("Could not locate the Cultivation Online cover image")
    data = get(url, binary=True)
    if len(data) < 8_000:
        raise RuntimeError("Downloaded Cultivation Online cover is unexpectedly small")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    COVER_PATH.write_bytes(data)


def write_catalog(chapters: list[dict], capacity: int, updated: str) -> None:
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
        "source": "NovelRare",
        "sourceUrl": NOVEL_PAGE,
        "lazyChunks": {"prefix": "data/cultivation-chapters-", "capacity": capacity, "global": "CULTIVATION_CHAPTERS"},
        "chapters": metadata,
    }
    CATALOG_PATH.write_text(
        "(() => {\n  const novel = " + json.dumps(novel, ensure_ascii=False, separators=(",", ":")) + ";\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n  if (index >= 0) window.NOVELS[index] = novel;\n  else window.NOVELS.push(novel);\n})();\n",
        encoding="utf-8",
    )


def main() -> None:
    page = get(NOVEL_PAGE)
    chapters = load_existing_chapters()
    if len(chapters) > TARGET:
        print(f"Trimming Cultivation Online from {len(chapters)} to requested target {TARGET}.", flush=True)
        chapters = chapters[:TARGET]
    if len(chapters) < TARGET:
        chapters.extend(fetch_chapters(list(range(len(chapters) + 1, TARGET + 1))))

    numbers = [int(ch.get("number", i + 1)) for i, ch in enumerate(chapters)]
    if numbers != list(range(1, TARGET + 1)):
        raise RuntimeError("Cultivation Online chapters are missing, duplicated, or out of order")

    capacity = write_chunks(chapters)
    ensure_cover(page)
    write_catalog(chapters, capacity, datetime.now(timezone.utc).date().isoformat())
    print(f"Import complete: Cultivation Online has exactly 1-{TARGET}, with no gaps or duplicate chapter numbers.", flush=True)


if __name__ == "__main__":
    main()
