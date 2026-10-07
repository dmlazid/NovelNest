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

import requests
from bs4 import BeautifulSoup

BASE = "https://freewebnovel.com/novel/supreme-magus-novel"
TITLE = "Supreme Magus"
AUTHOR = "Legion20"
KEY = "supreme-magus"
NOVEL_ID = "supreme-magus"
CHUNK_CAPACITY = 100
BATCH_SIZE = max(1, int(os.environ.get("SUPREME_MAGUS_BATCH_SIZE", "100")))
REQUEST_DELAY = 1.3
END_PROBE_MISSES = 8

DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
CATALOG_PATH = DIST / "licensed-supreme-magus.js"
COVER_PATH = ASSET_DIR / "supreme-magus.jpg"
STATE_PATH = DATA_DIR / "supreme-magus-state.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/2.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
}

session = requests.Session()
session.headers.update(HEADERS)


def request(url: str, *, binary: bool = False, optional: bool = False):
    last = None
    for attempt in range(8):
        try:
            response = session.get(url, timeout=30)
            if response.status_code == 404 and optional:
                return None
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
            return response.content if binary else response
        except Exception as exc:
            last = exc
            if attempt < 7:
                delay = min(45, 2 ** (attempt + 1))
                print(f"Fetch error: {url}: {exc}; retrying in {delay}s", flush=True)
                time.sleep(delay)
    if optional:
        print(f"Optional source page unavailable after retries: {url}: {last}", flush=True)
        return None
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def clean_text(value: str) -> str:
    value = " ".join(value.split())
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", value, flags=re.I)
    return " ".join(value.split()).strip()


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


def load_state(existing_count: int) -> dict:
    if not STATE_PATH.exists():
        if existing_count:
            raise RuntimeError(
                "Supreme Magus has imported chapters but no source-index state. "
                "Refusing to guess because FreeWebNovel inserts unnumbered entries."
            )
        return {"source_index": 0, "last_chapter": 0}

    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    source_index = int(state.get("source_index", 0))
    last_chapter = int(state.get("last_chapter", 0))
    if source_index < 0 or last_chapter != existing_count:
        raise RuntimeError(
            f"Supreme Magus state mismatch: source_index={source_index}, "
            f"last_chapter={last_chapter}, existing={existing_count}"
        )
    return {"source_index": source_index, "last_chapter": last_chapter}


def save_state(source_index: int, last_chapter: int) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(
            {"source_index": source_index, "last_chapter": last_chapter},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )


def chapter_url(source_index: int) -> str:
    return f"{BASE}/chapter-{source_index}"


CHAPTER_WORD_RE = re.compile(
    r"\b(?:chapter|chpater|chaper|chater|capter|chapte|chaptre)\s*:?[\s-]*(-?\d+)\b",
    flags=re.I,
)


def extract_chapter_number(value: str):
    """Read source chapter numbers while tolerating common heading typos.

    FreeWebNovel occasionally contains headings such as "Chpater 1953".
    We still require an explicit chapter-like word plus a number so unrelated
    page text cannot silently advance the NovelNest sequence.
    """
    match = CHAPTER_WORD_RE.search(value or "")
    if match:
        return int(match.group(1))
    match = re.match(r"^(-?\d+)\b", value or "")
    return int(match.group(1)) if match else None


def inspect_source_page(source_index: int):
    response = request(chapter_url(source_index), optional=True)
    if response is None:
        return None

    expected_suffix = f"/chapter-{source_index}"
    if not response.url.rstrip("/").endswith(expected_suffix):
        return None

    soup = BeautifulSoup(response.text, "html.parser")
    article = (
        soup.select_one("div#article")
        or soup.select_one("div.txt")
        or soup.select_one("article")
        or soup.select_one("main")
    )
    if article is None:
        return None

    title = ""
    for node in soup.select("span.chapter, h1, h2, h3"):
        candidate = clean_text(node.get_text(" ", strip=True))
        if extract_chapter_number(candidate) is not None:
            title = candidate
            break

    if not title:
        breadcrumb = clean_text(soup.get_text(" ", strip=True))
        match = CHAPTER_WORD_RE.search(breadcrumb)
        if match:
            start = match.start()
            title = clean_text(breadcrumb[start:start + 180])

    number = extract_chapter_number(title)
    return {"response": response, "soup": soup, "article": article, "title": title, "number": number}


def parse_actual_chapter(page: dict, expected_number: int) -> dict:
    article = page["article"]
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
            f"Chapter {expected_number}: only {len(paragraphs)} blocks / {characters} characters found"
        )

    source_title = page.get("title") or ""
    title_match = CHAPTER_WORD_RE.search(source_title)
    if title_match and int(title_match.group(1)) == expected_number:
        suffix = source_title[title_match.end():].strip()
        suffix = re.sub(r"^[\s:.-]+", "", suffix)
        title = f"Chapter {expected_number}" + (f" {suffix}" if suffix else "")
    else:
        title = f"Chapter {expected_number}"
        if source_title:
            title += f": {source_title}"

    return {"number": expected_number, "title": title, "paragraphs": paragraphs}


def scan_batch(chapters: list[dict], state: dict) -> tuple[list[dict], int, bool]:
    expected = len(chapters) + 1
    source_index = int(state["source_index"])
    last_valid_source_index = source_index
    added = 0
    misses = 0

    print(
        f"Supreme Magus: scanning source after index {source_index}; "
        f"next NovelNest chapter is {expected}.",
        flush=True,
    )

    while added < BATCH_SIZE and misses < END_PROBE_MISSES:
        source_index += 1
        page = inspect_source_page(source_index)

        if page is None:
            misses += 1
            print(
                f"Source index {source_index}: no chapter page "
                f"({misses}/{END_PROBE_MISSES} end probes).",
                flush=True,
            )
            time.sleep(REQUEST_DELAY)
            continue

        last_valid_source_index = source_index
        misses = 0
        actual = page.get("number")

        if actual is None or actual <= 0:
            print(
                f"Source index {source_index}: skipped extra entry "
                f"{page.get('title') or '(unnumbered)'!r}.",
                flush=True,
            )
            time.sleep(REQUEST_DELAY)
            continue

        if actual < expected:
            print(
                f"Source index {source_index}: skipped duplicate/extra Chapter {actual}; "
                f"expected Chapter {expected}.",
                flush=True,
            )
            time.sleep(REQUEST_DELAY)
            continue

        if actual > expected:
            raise RuntimeError(
                f"Source index {source_index} jumped to Chapter {actual}; "
                f"expected Chapter {expected}. Import stopped to prevent a gap."
            )

        chapters.append(parse_actual_chapter(page, expected))
        added += 1
        expected += 1
        if added % 10 == 0 or added == BATCH_SIZE:
            print(f"Imported {added}/{BATCH_SIZE} chapters in this checkpoint.", flush=True)
        time.sleep(REQUEST_DELAY)

    caught_up = added < BATCH_SIZE and misses >= END_PROBE_MISSES
    return chapters, last_valid_source_index, caught_up


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


def ensure_cover() -> None:
    if COVER_PATH.exists() and COVER_PATH.stat().st_size > 8_000:
        return

    cover_url = "https://freewebnovel.com/files/article/image/0/871/871s.jpg"
    data = request(cover_url, binary=True)
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


def current_updated_date() -> str:
    if not CATALOG_PATH.exists():
        return datetime.now(timezone.utc).date().isoformat()
    text = CATALOG_PATH.read_text(encoding="utf-8")
    match = re.search(r'"updated":"([^"]+)"', text)
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def main() -> None:
    chapters = load_existing()
    existing = len(chapters)
    state = load_state(existing)
    print(
        f"NovelNest currently has {existing} Supreme Magus chapters "
        f"(last source index {state['source_index']}).",
        flush=True,
    )

    chapters, last_valid_source_index, caught_up = scan_batch(chapters, state)
    imported = len(chapters) - existing

    if not chapters:
        raise RuntimeError("No Supreme Magus chapters were found at the source")

    ensure_cover()
    write_chunks(chapters)
    save_state(last_valid_source_index, len(chapters))

    updated = (
        datetime.now(timezone.utc).date().isoformat()
        if imported
        else current_updated_date()
    )
    write_catalog(chapters, updated)

    if imported:
        print(
            f"Checkpoint complete: Supreme Magus advanced {existing} -> {len(chapters)} chapters; "
            f"source index is now {last_valid_source_index}.",
            flush=True,
        )
    if caught_up:
        print(f"Supreme Magus is caught up at Chapter {len(chapters)}.", flush=True)


if __name__ == "__main__":
    main()
