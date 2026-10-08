#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SCRIPTS = ROOT / "scripts"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedDiscovery/1.0; +https://novelhaven.top)",
    "Accept-Language": "en-US,en;q=0.9",
}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def clean_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value or "").split()).strip()


def slug_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return value[:100]


def get(url: str) -> str:
    last = None
    for attempt in range(6):
        try:
            response = SESSION.get(url, timeout=30)
            if response.status_code == 429:
                time.sleep(min(60, 8 + attempt * 8))
                continue
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last = exc
            if attempt < 5:
                time.sleep(min(30, 2 ** (attempt + 1)))
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def load_registry(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def existing_source_slugs(source: str) -> set[str]:
    slugs: set[str] = set()
    if source == "freewebnovel":
        pattern = re.compile(r'https://freewebnovel\.com/novel/([^"?#/]+)', re.I)
    else:
        pattern = re.compile(r'https://(?:www\.)?akknovel\.com/series/([^"?#/]+)', re.I)
    for path in DIST.glob("licensed-*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in pattern.finditer(text):
            slugs.add(match.group(1).strip("/"))
    return slugs


def page_title(soup: BeautifulSoup, fallback: str) -> str:
    h1 = soup.find("h1")
    if h1:
        value = clean_text(h1.get_text(" ", strip=True))
        if value:
            return value
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return clean_text(og["content"]).split(" - ")[0].strip()
    return fallback.replace("-", " ").title()


def author_from_page(soup: BeautifulSoup) -> str:
    text = " ".join(clean_text(v) for v in soup.stripped_strings if clean_text(v))
    match = re.search(r"\bAuthor\s*:\s*(.+?)(?=\s+(?:Genre|Status|View|Last chapter|Bookmark|Read|Description|SUMMARY|Summary|Chapters?)\b|$)", text, flags=re.I)
    if match:
        author = clean_text(match.group(1))
        if author and len(author) <= 160:
            return author
    return "Unknown"


def synopsis_from_page(soup: BeautifulSoup, title: str) -> str:
    for selector in ("meta[name='description']", "meta[property='og:description']"):
        node = soup.select_one(selector)
        if node and node.get("content"):
            value = clean_text(node["content"])
            if len(value) >= 80:
                return value[:2500]
    text = " ".join(clean_text(v) for v in soup.stripped_strings if clean_text(v))
    for marker in ("Description", "SUMMARY", "Summary"):
        pos = text.find(marker)
        if pos >= 0:
            value = clean_text(text[pos + len(marker):])
            if len(value) >= 80:
                return value[:2500]
    return f"{title} is an authorized title selected automatically for NovelNest."


def classify(text: str) -> tuple[str, list[str]]:
    lower = text.casefold()
    rules = [
        ("Romance", ["romance", "marriage", "husband", "wife", "love", "heiress"]),
        ("Action", ["action", "battle", "war", "martial", "fighter"]),
        ("Fantasy", ["fantasy", "magic", "system", "cultivation", "transmigration", "reincarnation"]),
        ("Sci-fi", ["sci-fi", "apocalypse", "interstellar", "space", "technology"]),
        ("Mystery", ["mystery", "crime", "detective", "forensic", "thriller"]),
        ("Historical", ["historical", "ancient", "emperor", "imperial", "marquis", "dynasty"]),
        ("Game", ["game", "vrmmo", "player"]),
    ]
    tags = []
    for label, needles in rules:
        if any(n in lower for n in needles):
            tags.append(label)
    if not tags:
        tags = ["Fantasy"]
    return tags[0], tags[:6]


def discover_fwn_candidates() -> list[str]:
    urls = ["https://freewebnovel.com/sort/most-popular"] + [
        f"https://freewebnovel.com/sort/most-popular/{page}" for page in range(2, 11)
    ]
    found = []
    seen = set()
    for url in urls:
        soup = BeautifulSoup(get(url), "html.parser")
        for a in soup.find_all("a", href=True):
            absolute = urljoin(url, a["href"])
            match = re.match(r"https://freewebnovel\.com/novel/([^/?#]+)/*$", absolute, flags=re.I)
            if not match:
                continue
            slug = match.group(1)
            if slug not in seen:
                seen.add(slug)
                found.append(slug)
    return found


def cfg_fwn(slug: str) -> dict:
    url = f"https://freewebnovel.com/novel/{slug}"
    soup = BeautifulSoup(get(url), "html.parser")
    title = page_title(soup, slug)
    tags = []
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        if "/genre/" in href or "/genres/" in href:
            value = clean_text(a.get_text(" ", strip=True))
            if value and value not in tags:
                tags.append(value)
    genre, guessed = classify(" ".join([title, synopsis_from_page(soup, title), *tags]))
    if not tags:
        tags = guessed
    return {
        "id": slug,
        "slug": slug,
        "title": title,
        "author": author_from_page(soup),
        "genre": tags[0] if tags else genre,
        "tags": tags[:8] or guessed,
    }


def discover_akk_candidates() -> list[str]:
    urls = []
    for page in range(1, 11):
        suffix = "" if page == 1 else f"&page={page}"
        urls.append("https://www.akknovel.com/series?order=desc&sort=popularity&status=all" + suffix)
    found = []
    seen = set()
    for url in urls:
        soup = BeautifulSoup(get(url), "html.parser")
        for a in soup.find_all("a", href=True):
            absolute = urljoin(url, a["href"])
            match = re.match(r"https://(?:www\.)?akknovel\.com/series/([^/?#]+)/*$", absolute, flags=re.I)
            if not match:
                continue
            slug = match.group(1)
            if slug not in seen:
                seen.add(slug)
                found.append(slug)
    return found


def cfg_akk(slug: str) -> dict:
    url = f"https://www.akknovel.com/series/{slug}"
    soup = BeautifulSoup(get(url), "html.parser")
    title = page_title(soup, slug)
    synopsis = synopsis_from_page(soup, title)
    genre, tags = classify(title + " " + synopsis)
    return {
        "id": slug,
        "slug": slug,
        "title": title,
        "author": author_from_page(soup),
        "genre": genre,
        "tags": tags,
        "synopsis": synopsis,
    }


def discover(source: str, limit: int) -> int:
    if source == "freewebnovel":
        path = SCRIPTS / "auto_freewebnovel.json"
        candidates = discover_fwn_candidates()
        make_cfg = cfg_fwn
    else:
        path = SCRIPTS / "auto_akknovel.json"
        candidates = discover_akk_candidates()
        make_cfg = cfg_akk

    registry = load_registry(path)
    existing = existing_source_slugs(source)
    existing.update(cfg.get("slug", "") for cfg in registry.values())

    added = 0
    for slug in candidates:
        if added >= limit:
            break
        if slug in existing:
            continue
        try:
            cfg = make_cfg(slug)
        except Exception as exc:
            print(f"Skipping {slug}: {exc}", flush=True)
            continue
        key = slug_key(slug)
        while key in registry:
            key += "-auto"
        registry[key] = cfg
        existing.add(slug)
        added += 1
        print(f"Selected {source}: {cfg['title']} ({slug})", flush=True)
        time.sleep(0.4)

    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Added {added} new {source} title(s) to {path.relative_to(ROOT)}.", flush=True)
    return added


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", choices=["freewebnovel", "akknovel"])
    parser.add_argument("--limit", type=int, default=15)
    args = parser.parse_args()
    discover(args.source, max(1, args.limit))


if __name__ == "__main__":
    main()
