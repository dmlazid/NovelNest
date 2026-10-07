#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.akknovel.com"
CHUNK_CAPACITY = 100
REQUEST_DELAY = float(os.environ.get("AKKNOVEL_REQUEST_DELAY", "0.8"))
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/1.0; +https://novelhaven.top)",
    "Accept-Language": "en-US,en;q=0.9",
}

SERIES = {
    "farming-immortality": {
        "id": "farming-cultivating-immortality",
        "slug": "farming-no-she-is-cultivating-immortality",
        "title": "Farming? No, She Is Cultivating Immortality",
        "author": "Fat egg",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Cultivation", "Adventure"],
        "synopsis": "Qin Zhen is judged unable to cultivate while her younger sister is taken into an immortal sect. Starting with ordinary land and spirit fields, she slowly builds a family legacy that reaches far beyond simple farming.",
    },
    "mistaken-system": {
        "id": "mistakenly-bound-system",
        "slug": "mistakenly-bound-by-the-system-lets-squeeze-out-a-space-first",
        "title": "Mistakenly Bound by the System? Let’s Squeeze Out a Space First!",
        "author": "Unknown",
        "genre": "Fantasy",
        "tags": ["Fantasy", "System", "Transmigration", "Slice of Life"],
        "synopsis": "Jiang Yanyan wakes inside a novel after an accidental system binding. With a supermarket space, farmland, storage, and daily rewards, she chooses a relaxed path through different worlds while dealing with troublesome people on her own terms.",
    },
    "long-aotian": {
        "id": "long-aotian-love-rival",
        "slug": "transmigrated-as-long-aotians-love-rival",
        "title": "Transmigrated as Long Aotian’s Love Rival",
        "author": "There is a shadow on the bright terrace",
        "genre": "Romance",
        "tags": ["Romance", "Fantasy", "Transmigration", "Harem"],
        "synopsis": "A woman transmigrates into a harem novel, not as one of the heroines but as the overpowered protagonist’s persistent romantic rival. Her new identity and the rivalry become far stranger than the original story suggested.",
    },
    "marquis-inner-voice": {
        "id": "marquis-inner-voice",
        "slug": "who-gets-it-the-marquiss-concubine-born-daughters-inner-voice-is-auto-broadcasting",
        "title": "Who Gets It! The Marquis’s Concubine-Born Daughter’s Inner Voice is Auto-Broadcasting",
        "author": "Xianyu, dreaming of making a comeback",
        "genre": "Comedy",
        "tags": ["Comedy", "Historical", "System", "Transmigration"],
        "synopsis": "A modern graduate becomes an overlooked daughter in a marquis household and plans to live quietly with a gossip system. A bug broadcasts her inner thoughts, turning private secrets into daily entertainment for increasingly powerful listeners.",
    },
    "tyrant-father": {
        "id": "tyrant-father-daughter",
        "slug": "raiding-a-home-and-finding-his-own-daughter-the-tyrant-father-chickened-out",
        "title": "Raiding a Home and Finding His Own Daughter, the Tyrant Father Chickened Out",
        "author": "Unknown",
        "genre": "Comedy",
        "tags": ["Comedy", "Historical", "Transmigration", "System"],
        "synopsis": "Su Yaoyao transmigrates into a dangerous new life just as a tyrant raids her home. When he unexpectedly hears her thoughts and discovers their connection, palace politics turn into a chaotic mix of family drama, secrets, and overwhelming modern knowledge.",
    },
    "zombie-cat": {
        "id": "zombie-apocalypse-cat",
        "slug": "zombie-apocalypse-me-and-my-cat",
        "title": "Zombie Apocalypse: Me and My Cat",
        "author": "Unknown",
        "genre": "Sci-fi",
        "tags": ["Sci-fi", "Apocalypse", "Adventure", "Survival"],
        "synopsis": "When a zombie apocalypse begins, Jiang Cheng faces an even stranger problem: the stray cat he rescued has been infected. Their survival story unfolds in a world where familiar rules are rapidly collapsing.",
    },
}


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    return " ".join(value.split()).strip()


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(7):
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
            if response.status_code == 429:
                delay = min(90, 8 + attempt * 10)
                print(f"Rate limited: {url}; retrying in {delay}s", flush=True)
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.content if binary else response.text
        except Exception as exc:
            last = exc
            if attempt < 6:
                delay = min(40, 2 ** (attempt + 1))
                print(f"Fetch error: {url}: {exc}; retrying in {delay}s", flush=True)
                time.sleep(delay)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def series_url(cfg: dict) -> str:
    return f"{BASE}/series/{cfg['slug']}"


def paths(key: str):
    return {
        "catalog": DIST / f"licensed-akk-{key}.js",
        "cover": ASSET_DIR / f"akk-{key}.jpg",
        "prefix": f"data/akk-{key}-chapters-",
        "glob": f"akk-{key}-chapters-*.js",
        "global": "AKK_" + re.sub(r"[^A-Z0-9]+", "_", key.upper()) + "_CHAPTERS",
    }


def discover_chapters(raw: str, cfg: dict) -> list[dict]:
    soup = BeautifulSoup(raw, "html.parser")
    prefix = f"/series/{cfg['slug']}/chapter-"
    found = {}
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        absolute = urljoin(BASE, href)
        path = absolute.split("?", 1)[0].rstrip("/")
        if prefix not in path:
            continue
        match = re.search(r"/chapter-(\d+)(?:-|$)", path, flags=re.I)
        if not match:
            continue
        number = int(match.group(1))
        label = clean_text(anchor.get_text(" ", strip=True))
        suffix = re.sub(rf"^(?:Ch\.?|Chapter)\s*{number}\s*", "", label, flags=re.I).strip(" :-")
        item = {"number": number, "url": absolute, "suffix": suffix}
        if number not in found or len(suffix) > len(found[number]["suffix"]):
            found[number] = item
    chapters = [found[n] for n in sorted(found)]
    if not chapters:
        raise RuntimeError(f"{cfg['title']}: no chapter links found")
    numbers = [c["number"] for c in chapters]
    expected = list(range(1, max(numbers) + 1))
    if numbers != expected:
        missing = sorted(set(expected) - set(numbers))
        raise RuntimeError(f"{cfg['title']}: source chapter list has gaps: {missing[:10]}")
    return chapters


def find_status(soup: BeautifulSoup) -> str:
    heading = soup.find("h1")
    if heading:
        checked = 0
        for value in heading.next_elements:
            if isinstance(value, str):
                text = clean_text(value)
                if text in {"OnGoing", "Ongoing", "Completed"}:
                    return "Completed" if text == "Completed" else "Ongoing"
                checked += 1
                if checked > 30:
                    break
    return "Ongoing"


def find_author(soup: BeautifulSoup, fallback: str) -> str:
    heading = soup.find("h1")
    if heading:
        checked = []
        for value in heading.next_elements:
            if isinstance(value, str):
                text = clean_text(value)
                if text:
                    checked.append(text)
                if len(checked) > 30:
                    break
        joined = " ".join(checked)
        match = re.search(r"Author:\s*(.+?)(?=\s+(?:Last chapter|Bookmark|Read|Description|Chapters)\b|$)", joined, flags=re.I)
        if match:
            author = clean_text(match.group(1))
            if author:
                return author
    return fallback


def content_container(soup: BeautifulSoup):
    selectors = [
        ".chapter-content", ".reading-content", ".entry-content", ".text-left",
        "[class*='chapter-content']", "[class*='reading-content']", "article", "main"
    ]
    candidates = []
    seen = set()
    for selector in selectors:
        for node in soup.select(selector):
            if id(node) in seen:
                continue
            seen.add(id(node))
            text = clean_text(node.get_text(" ", strip=True))
            pchars = sum(len(clean_text(p.get_text(" ", strip=True))) for p in node.find_all("p"))
            score = pchars * 2 + len(text)
            if len(text) >= 300:
                candidates.append((score, node))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def parse_chapter(item: dict, title: str) -> dict:
    raw = get(item["url"])
    soup = BeautifulSoup(raw, "html.parser")
    node = content_container(soup)
    if node is None:
        raise RuntimeError(f"{title} Chapter {item['number']}: content container not found")
    for bad in node.select("script, style, noscript, nav, aside, footer, form, .comments, .comment"):
        bad.decompose()

    paragraphs = []
    for p in node.find_all("p"):
        text = clean_text(p.get_text(" ", strip=True))
        low = text.lower()
        if not text:
            continue
        if low.startswith(("previous chapter", "next chapter", "bookmark", "copyright ©")):
            continue
        paragraphs.append(text)

    if len(paragraphs) < 3:
        paragraphs = []
        for value in node.stripped_strings:
            text = clean_text(value)
            low = text.lower()
            if not text or low in {"search", "bookmark", "read"}:
                continue
            if low.startswith(("previous chapter", "next chapter", "copyright ©")):
                continue
            paragraphs.append(text)

    chars = sum(len(p) for p in paragraphs)
    if len(paragraphs) < 3 or chars < 250:
        raise RuntimeError(f"{title} Chapter {item['number']}: only {len(paragraphs)} blocks / {chars} characters found")

    number = item["number"]
    chapter_title = f"Chapter {number}"
    if item.get("suffix"):
        chapter_title += f": {item['suffix']}"
    return {"number": number, "title": chapter_title, "paragraphs": paragraphs}


def load_existing(key: str, p: dict) -> list[dict]:
    chapters = []
    for path in sorted(DATA_DIR.glob(p["glob"])):
        raw = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", raw, flags=re.S)
        if not match:
            raise RuntimeError(f"Could not parse {path}")
        chapters.extend(json.loads(match.group(1)))
    if [c.get("number") for c in chapters] != list(range(1, len(chapters) + 1)):
        raise RuntimeError(f"{key}: existing chapter data is not continuous")
    return chapters


def write_chunks(key: str, p: dict, chapters: list[dict]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    count = math.ceil(len(chapters) / CHUNK_CAPACITY)
    for index in range(1, count + 1):
        part = chapters[(index - 1) * CHUNK_CAPACITY:index * CHUNK_CAPACITY]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"akk-{key}-chapters-{index:02d}.js"
        path.write_text(
            f"window.{p['global']}=(window.{p['global']}||[]).concat({payload});\n",
            encoding="utf-8",
        )
    for old in DATA_DIR.glob(p["glob"]):
        match = re.search(r"(\d+)\.js$", old.name)
        if match and int(match.group(1)) > count:
            old.unlink()


def ensure_cover(raw: str, cfg: dict, p: dict):
    if p["cover"].exists() and p["cover"].stat().st_size > 4_000:
        return
    soup = BeautifulSoup(raw, "html.parser")
    url = None
    meta = soup.find("meta", attrs={"property": "og:image"})
    if meta and meta.get("content"):
        url = urljoin(BASE, meta["content"])
    if not url:
        for image in soup.find_all("img"):
            alt = clean_text(image.get("alt") or "")
            if cfg["title"].lower() in alt.lower() or alt.lower() in cfg["title"].lower():
                src = image.get("src") or image.get("data-src")
                if src:
                    url = urljoin(BASE, src)
                    break
    if not url:
        raise RuntimeError(f"{cfg['title']}: cover not found")
    data = get(url, binary=True)
    if len(data) < 4_000:
        raise RuntimeError(f"{cfg['title']}: downloaded cover is unexpectedly small")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    p["cover"].write_bytes(data)


def previous_updated(catalog: Path) -> str:
    if not catalog.exists():
        return datetime.now(timezone.utc).date().isoformat()
    match = re.search(r'"updated":"([^"]+)"', catalog.read_text(encoding="utf-8"))
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def write_catalog(key: str, cfg: dict, p: dict, chapters: list[dict], status: str, author: str, updated: str):
    metadata = [
        {"number": c["number"], "title": c["title"], "paragraphs": ["Loading chapter…"], "lazy": True}
        for c in chapters
    ]
    novel = {
        "id": cfg["id"], "title": cfg["title"], "author": author,
        "genre": cfg["genre"], "tags": cfg["tags"], "status": status,
        "cover": f"assets/akk-{key}.jpg", "updated": updated, "sample": False,
        "synopsis": cfg["synopsis"],
        "license": {
            "type": "Authorized publication",
            "note": "Published on NovelNest with permission from the rights holder, as confirmed by the site owner.",
        },
        "source": "AkkNovel", "sourceUrl": series_url(cfg),
        "lazyChunks": {"prefix": p["prefix"], "capacity": CHUNK_CAPACITY, "global": p["global"]},
        "chapters": metadata,
    }
    p["catalog"].write_text(
        "(() => {\n  const novel = " + json.dumps(novel, ensure_ascii=False, separators=(",", ":"))
        + ";\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n"
        + "  if (index >= 0) window.NOVELS[index] = novel;\n"
        + "  else window.NOVELS.push(novel);\n})();\n",
        encoding="utf-8",
    )


def import_series(key: str):
    cfg = SERIES[key]
    p = paths(key)
    raw = get(series_url(cfg))
    soup = BeautifulSoup(raw, "html.parser")
    source = discover_chapters(raw, cfg)
    existing = load_existing(key, p)
    before = len(existing)
    latest = source[-1]["number"]
    print(f"{cfg['title']}: NovelNest has {before}; source has {latest}.", flush=True)
    if latest < before:
        source = source[:before]
        latest = before

    for item in source[before:]:
        existing.append(parse_chapter(item, cfg["title"]))
        if len(existing) % 10 == 0 or len(existing) == latest:
            print(f"{cfg['title']}: imported {len(existing)}/{latest}", flush=True)
        time.sleep(REQUEST_DELAY)

    if [c["number"] for c in existing] != list(range(1, len(existing) + 1)):
        raise RuntimeError(f"{cfg['title']}: missing, duplicated, or out-of-order chapters")

    ensure_cover(raw, cfg, p)
    write_chunks(key, p, existing)
    updated = datetime.now(timezone.utc).date().isoformat() if len(existing) > before else previous_updated(p["catalog"])
    write_catalog(key, cfg, p, existing, find_status(soup), find_author(soup, cfg["author"]), updated)
    print(f"{cfg['title']}: complete at {len(existing)} chapters.", flush=True)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in SERIES:
        raise SystemExit("Usage: python scripts/import_akknovel.py <" + "|".join(SERIES) + ">")
    import_series(sys.argv[1])


if __name__ == "__main__":
    main()
