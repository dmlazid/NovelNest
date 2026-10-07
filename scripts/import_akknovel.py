#!/usr/bin/env python3
from __future__ import annotations

import json
from io import BytesIO
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
from PIL import Image, ImageOps

BASE = "https://www.akknovel.com"
CHUNK_CAPACITY = 100
REQUEST_DELAY = float(os.environ.get("AKKNOVEL_REQUEST_DELAY", "0.8"))
BATCH_SIZE = max(1, int(os.environ.get("AKKNOVEL_BATCH_SIZE", "100")))
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
    "directed-inner-voice": {
        "id": "directed-leakage-inner-voice",
        "slug": "directed-leakage-of-inner-voice-i-pretended-to-be-a-god-undergoing-tribulations",
        "title": "Directed Leakage of Inner Voice: I Pretended to Be a God Undergoing Tribulations",
        "author": "Jade is unpolished",
        "genre": "Comedy",
        "tags": ["Comedy", "Historical", "System", "Mind Reading"],
        "synopsis": "Yue Fuguang gets a second chance at life with a defective merit system and discovers she is the doomed real heiress of a familiar story. Rather than shoulder an impossible mission alone, she turns selective leaks of her inner thoughts into a way to push the imperial court toward saving the dynasty.",
    },
    "kick-scumbag": {
        "id": "kick-scumbag-city-marry",
        "slug": "after-kicking-over-the-scumbag-the-whole-city-wants-to-marry-me",
        "title": "After Kicking Over the Scumbag, the Whole City Wants to Marry Me",
        "author": "The moon is falling on the branches.",
        "genre": "Romance",
        "tags": ["Romance", "Historical", "Rebirth", "Revenge"],
        "synopsis": "After a disastrous first life ends in betrayal and the destruction of her family, Gu Ying is reborn determined to change everything. Her plans for revenge and a quiet future become complicated when the powerful man she mistakenly clings to turns out to be far more dangerous—and devoted—than expected.",
    },
    "spend-stepmother": {
        "id": "you-make-money-ill-spend-it",
        "slug": "you-make-money-ill-spend-it-stepmothers-ultimate-pleasure-in-the-aristocratic-family",
        "title": "You Make Money, I’ll Spend It: Stepmother’s Ultimate Pleasure in the Aristocratic Family",
        "author": "Luchi",
        "genre": "Romance",
        "tags": ["Romance", "Transmigration", "Modern", "Family"],
        "synopsis": "Shen Mu Mu transmigrates into a novel and unexpectedly becomes the stepmother of a teenage heir in a wealthy family. What begins as a comfortable contract arrangement grows into a lively new life involving business, family bonds, public attention, and a marriage that becomes much more real than planned.",
    },
    "ancient-miss-ceo-wife": {
        "id": "ancient-miss-ceo-wife",
        "slug": "the-ancient-miss-transmigrates-into-a-ceos-wife",
        "title": "The Ancient Miss Transmigrates into a CEO’s Wife",
        "author": "Zhiyang",
        "genre": "Romance",
        "tags": ["Romance", "Transmigration", "Modern", "Marriage"],
        "synopsis": "Shen Yin, a young woman from another era, wakes in a modern world she barely understands and learns that she now has both a husband and a child. As she adapts to contemporary life, her old-world skills and new relationships reshape the family she has unexpectedly entered.",
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
            return response.content if binary else response.content.decode("utf-8", errors="replace")
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
        "cover": ASSET_DIR / f"akk-{key}-cover.jpg",
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
        label = re.sub(r"^Last chapter:\s*", "", label, flags=re.I)
        if label.lower() == "read":
            label = ""
        suffix = re.sub(rf"^(?:Ch\.?|Chapter)\s*{number}\s*", "", label, flags=re.I).strip(" :-")
        if re.fullmatch(rf"0*{number}", suffix or ""):
            suffix = ""
        item = {"number": number, "url": absolute, "suffix": suffix}
        if number not in found:
            found[number] = item
        else:
            current = found[number]["suffix"]
            if (not current and suffix) or (current.lower().startswith("last chapter") and not suffix.lower().startswith("last chapter")):
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


def cover_url(raw: str, cfg: dict) -> str:
    soup = BeautifulSoup(raw, "html.parser")
    # The page's og:image is AkkNovel's site logo, not the novel cover.
    def title_key(value):
        return "".join(c for c in clean_text(value).casefold() if c.isalnum())
    titles = {title_key(cfg["title"])}
    heading = soup.find("h1")
    if heading:
        titles.add(title_key(heading.get_text(" ", strip=True)))
    for image in soup.find_all("img"):
        labels = {title_key(image.get(attr) or "") for attr in ("title", "alt")}
        if any(label and label in titles for label in labels):
            src = image.get("data-src") or image.get("src")
            if src and not src.startswith("data:"):
                return urljoin(BASE, src)
    raise RuntimeError(f"{cfg['title']}: matching novel cover not found")


def jpeg_cover(data: bytes) -> bytes:
    # Decode before saving: a large SVG/logo or HTML error page is not a JPEG.
    with Image.open(BytesIO(data)) as image:
        image.load()
        image = ImageOps.exif_transpose(image)
        if image.width < 100 or image.height < 150 or image.height <= image.width:
            raise ValueError("Expected a portrait novel cover, not a logo or thumbnail")
        image = image.convert("RGB")
        output = BytesIO()
        image.save(output, format="JPEG", quality=92)
        return output.getvalue()


def ensure_cover(raw: str, cfg: dict, p: dict):
    if p["cover"].exists():
        try:
            data = p["cover"].read_bytes()
            jpeg_cover(data)
            if data.startswith(b"\xff\xd8\xff"):
                return
        except (OSError, ValueError):
            pass
    data = jpeg_cover(get(cover_url(raw, cfg), binary=True))
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    temporary = p["cover"].with_suffix(".jpg.tmp")
    temporary.write_bytes(data)
    temporary.replace(p["cover"])


def ensure_index_registration(key: str) -> None:
    index_path = DIST / "index.html"
    html = index_path.read_text(encoding="utf-8")
    tag = f'<script defer src="licensed-akk-{key}.js"></script>'
    if tag in html:
        return
    anchor = '<script defer src="licensed-supreme-magus.js"></script>'
    if anchor not in html:
        raise RuntimeError("Could not locate licensed script anchor in index.html")
    index_path.write_text(html.replace(anchor, anchor + tag), encoding="utf-8")


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
        "cover": p["cover"].relative_to(DIST).as_posix(), "updated": updated, "sample": False,
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
    rebuild = os.environ.get("AKKNOVEL_REBUILD", "0") == "1"
    existing = [] if rebuild else load_existing(key, p)
    before = len(existing)
    if rebuild:
        print(f"{cfg['title']}: rebuilding existing chapters with the corrected parser.", flush=True)
    latest = source[-1]["number"]
    print(f"{cfg['title']}: NovelNest has {before}; source has {latest}.", flush=True)
    if latest < before:
        source = source[:before]
        latest = before

    target = min(latest, before + BATCH_SIZE)
    for item in source[before:target]:
        existing.append(parse_chapter(item, cfg["title"]))
        if len(existing) % 10 == 0 or len(existing) == target:
            print(f"{cfg['title']}: imported {len(existing)}/{latest}", flush=True)
        time.sleep(REQUEST_DELAY)

    if [c["number"] for c in existing] != list(range(1, len(existing) + 1)):
        raise RuntimeError(f"{cfg['title']}: missing, duplicated, or out-of-order chapters")

    ensure_cover(raw, cfg, p)
    write_chunks(key, p, existing)
    updated = datetime.now(timezone.utc).date().isoformat() if len(existing) > before else previous_updated(p["catalog"])
    source_status = find_status(soup)
    published_status = source_status if len(existing) >= latest else "Ongoing"
    write_catalog(key, cfg, p, existing, published_status, find_author(soup, cfg["author"]), updated)
    ensure_index_registration(key)
    if len(existing) < latest:
        print(
            f"{cfg['title']}: checkpoint complete at {len(existing)}/{latest}; "
            f"the next checkpoint will continue from Chapter {len(existing) + 1}.",
            flush=True,
        )
    else:
        print(f"{cfg['title']}: complete at {len(existing)} chapters.", flush=True)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in SERIES:
        raise SystemExit("Usage: python scripts/import_akknovel.py <" + "|".join(SERIES) + ">")
    import_series(sys.argv[1])


if __name__ == "__main__":
    main()
