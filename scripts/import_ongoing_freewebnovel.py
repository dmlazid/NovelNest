#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

DIST = Path("dist")
DATA_DIR = DIST / "data"
REQUEST_DELAY = 0.8

BOOKS = [
    {
        "key": "monarch",
        "slug": "extras-path-the-eternal-frost-monarch",
        "source": "https://freewebnovel.com/novel/extras-path-the-eternal-frost-monarch",
    },
    {
        "key": "signin",
        "slug": "getting-10-million-from-my-first-sign-in",
        "source": "https://freewebnovel.com/novel/getting-10-million-from-my-first-sign-in",
    },
    {
        "key": "luna",
        "slug": "his-discarded-luna-the-rivals-obsession",
        "source": "https://freewebnovel.com/novel/his-discarded-luna-the-rivals-obsession",
    },
    {
        "key": "sss",
        "slug": "sss-rank-awakening-the-world-beyond-redemption",
        "source": "https://freewebnovel.com/novel/sss-rank-awakening-the-world-beyond-redemption",
    },
]

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/4.1; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
})


def get(url: str) -> str:
    last = None
    for attempt in range(7):
        try:
            response = session.get(url, timeout=30)
            if response.status_code == 429:
                retry_header = response.headers.get("Retry-After")
                try:
                    retry_after = float(retry_header) if retry_header else 0
                except (TypeError, ValueError):
                    retry_after = 0
                delay = max(retry_after, min(90, 10 + attempt * 10))
                print(f"Rate limited while fetching {url}; retrying in {delay:.0f}s...", flush=True)
                last = RuntimeError(f"HTTP 429 for {url}")
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.text
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


def catalog_path(key: str) -> Path:
    return DIST / f"licensed-{key}.js"


def load_catalog(key: str) -> dict:
    path = catalog_path(key)
    text = path.read_text(encoding="utf-8")
    match = re.search(r"const novel = (\{.*?\});\s*const index =", text, flags=re.S)
    if not match:
        raise RuntimeError(f"Could not parse {path}")
    novel = json.loads(match.group(1))
    if novel.get("status") != "Ongoing":
        raise RuntimeError(f"{novel.get('title', key)} is not marked Ongoing")
    return novel


def load_existing(key: str) -> list[dict]:
    chapters: list[dict] = []
    files = sorted(DATA_DIR.glob(f"{key}-chapters-*.js"))
    if not files:
        raise RuntimeError(f"No existing chapter chunks found for {key}")
    for path in files:
        text = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", text, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse {path}")
        part = json.loads(match.group(1))
        if not isinstance(part, list):
            raise RuntimeError(f"Invalid chapter payload in {path}")
        chapters.extend(part)
    numbers = [int(chapter.get("number", 0)) for chapter in chapters]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError(f"{key} chapter data is not a clean 1..N sequence")
    return chapters


def detect_latest(book: dict) -> int:
    raw = get(book["source"])
    slug = re.escape(book["slug"])
    numbers = {int(n) for n in re.findall(slug + r"/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"\bChapter\s+(\d+)\b", raw, flags=re.I)}
    if not numbers:
        raise RuntimeError("Could not detect chapter numbers on the source page")
    return max(numbers)


def parse_chapter(book: dict, number: int) -> dict:
    raw = get(f"{book['source']}/chapter-{number}")
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.select_one("div#article") or soup.select_one("div.txt") or soup.select_one("article")
    if article is None:
        raise RuntimeError(f"Chapter {number}: content container was not found")

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
        paragraphs = [clean_text(v) for v in article.stripped_strings if clean_text(v)]

    if len(paragraphs) < 3 or sum(len(p) for p in paragraphs) < 300:
        raise RuntimeError(f"Chapter {number}: insufficient chapter text")

    title_node = soup.select_one("span.chapter")
    if not title_node:
        for heading in soup.find_all(["h1", "h2", "h3"]):
            heading_text = clean_text(heading.get_text(" ", strip=True))
            if re.search(rf"\bChapter\s+{number}\b", heading_text, flags=re.I):
                title_node = heading
                break
    title = clean_text(title_node.get_text(" ", strip=True)) if title_node else f"Chapter {number}"
    if not re.match(rf"^Chapter\s+{number}\b", title, flags=re.I):
        title = f"Chapter {number}: {title}" if title else f"Chapter {number}"

    return {"number": number, "title": title, "paragraphs": paragraphs}


def write_chunks(key: str, chapters: list[dict], capacity: int, global_name: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    count = (len(chapters) + capacity - 1) // capacity
    for index in range(1, count + 1):
        start = (index - 1) * capacity
        part = chapters[start:start + capacity]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"{key}-chapters-{index:02d}.js"
        path.write_text(
            f"window.{global_name}=(window.{global_name}||[]).concat(" + payload + ");\n",
            encoding="utf-8",
        )
    for old in DATA_DIR.glob(f"{key}-chapters-*.js"):
        match = re.search(r"(\d+)\.js$", old.name)
        if match and int(match.group(1)) > count:
            old.unlink()


def write_catalog(book: dict, novel: dict, chapters: list[dict], updated: str) -> None:
    lazy = novel.get("lazyChunks") or {}
    capacity = int(lazy.get("capacity") or 25)
    global_name = str(lazy.get("global") or f"{book['key'].upper()}_CHAPTERS")
    write_chunks(book["key"], chapters, capacity, global_name)

    novel["updated"] = updated
    novel["source"] = "FreeWebNovel"
    novel["sourceUrl"] = book["source"]
    novel["lazyChunks"] = {
        "prefix": f"data/{book['key']}-chapters-",
        "capacity": capacity,
        "global": global_name,
    }
    novel["chapters"] = [
        {
            "number": chapter["number"],
            "title": chapter.get("title") or f"Chapter {chapter['number']}",
            "paragraphs": ["Loading chapter…"],
            "lazy": True,
        }
        for chapter in chapters
    ]

    payload = json.dumps(novel, ensure_ascii=False, separators=(",", ":"))
    catalog_path(book["key"]).write_text(
        "(() => {\n"
        "  const novel = " + payload + ";\n"
        "  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n"
        "  if (index >= 0) window.NOVELS[index] = novel;\n"
        "  else window.NOVELS.push(novel);\n"
        "})();\n",
        encoding="utf-8",
    )


def update_book(book: dict) -> tuple[str, int, int]:
    novel = load_catalog(book["key"])
    chapters = load_existing(book["key"])
    existing = len(chapters)
    latest = detect_latest(book)
    title = novel.get("title", book["key"])
    print(f"{title}: NovelNest has {existing}; source reports {latest}.", flush=True)

    if latest <= existing:
        # A mirror can temporarily lag. Never delete or roll back published chapters.
        write_catalog(book, novel, chapters, novel.get("updated") or datetime.now(timezone.utc).date().isoformat())
        print(f"{title}: no newer chapters to import.", flush=True)
        return title, existing, existing

    for number in range(existing + 1, latest + 1):
        chapters.append(parse_chapter(book, number))
        print(f"{title}: fetched chapter {number}/{latest}", flush=True)
        if number < latest:
            time.sleep(REQUEST_DELAY)

    write_catalog(book, novel, chapters, datetime.now(timezone.utc).date().isoformat())
    print(f"{title}: updated {existing} -> {len(chapters)} chapters.", flush=True)
    return title, existing, len(chapters)


def main() -> None:
    checked = 0
    changed = 0
    failures = []
    for book in BOOKS:
        try:
            title, before, after = update_book(book)
            checked += 1
            if after > before:
                changed += 1
        except Exception as exc:
            failures.append(f"{book['key']}: {exc}")
            print(f"WARNING: {book['key']} updater failed: {exc}", flush=True)

    if checked == 0:
        raise RuntimeError("All ongoing source checks failed: " + "; ".join(failures))

    print(f"Checked {checked}/{len(BOOKS)} ongoing novels; {changed} received new chapters.", flush=True)
    if failures:
        print("Some books could not be checked this run: " + "; ".join(failures), flush=True)


if __name__ == "__main__":
    main()
