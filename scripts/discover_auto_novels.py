#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SCRIPTS = ROOT / "scripts"
POLICY_PATH = SCRIPTS / "auto_import_policy.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestDiscovery/2.0; +https://novelhaven.top)",
    "Accept-Language": "en-US,en;q=0.9",
}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    return " ".join(value.split()).strip()


def repair_mojibake(value: str) -> str:
    value = clean_text(value)
    if not value or not any(marker in value for marker in ("â", "Ã", "ð", "Â")):
        return value
    try:
        repaired = value.encode("latin-1").decode("utf-8")
        if repaired:
            return clean_text(repaired)
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return value


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
                delay = min(60, 8 + attempt * 8)
                print(f"Rate limited: {url}; retrying in {delay}s", flush=True)
                time.sleep(delay)
                continue
            response.raise_for_status()
            try:
                return response.content.decode("utf-8")
            except UnicodeDecodeError:
                return response.text
        except Exception as exc:
            last = exc
            if attempt < 5:
                time.sleep(min(30, 2 ** (attempt + 1)))
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def policy_for(source: str) -> tuple[int, bool]:
    policy = load_json(POLICY_PATH)
    batch_size = int(policy.get("batch_size", 15) or 15)
    source_policy = policy.get("sources", {}).get(source, {})
    allowed = source_policy.get("sourcewide_authorized") is True
    return max(1, batch_size), allowed


def registry_path(source: str) -> Path:
    return SCRIPTS / f"auto_{source}.json"


def candidate_path(source: str) -> Path:
    return SCRIPTS / f"candidates_{source}.json"


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
        value = repair_mojibake(h1.get_text(" ", strip=True))
        if value:
            return value
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return repair_mojibake(og["content"]).split(" - ")[0].strip()
    return fallback.replace("-", " ").title()


def author_from_page(soup: BeautifulSoup) -> str:
    text = " ".join(repair_mojibake(v) for v in soup.stripped_strings if clean_text(v))
    match = re.search(
        r"\bAuthor\s*:\s*(.+?)(?=\s+(?:Genre|Status|View|Last chapter|Bookmark|Read|Description|SUMMARY|Summary|Chapters?)\b|$)",
        text,
        flags=re.I,
    )
    if match:
        author = repair_mojibake(match.group(1))
        if author and len(author) <= 160:
            return author
    return "Unknown"


def synopsis_from_page(soup: BeautifulSoup, title: str) -> str:
    for selector in ("meta[name='description']", "meta[property='og:description']"):
        node = soup.select_one(selector)
        if node and node.get("content"):
            value = repair_mojibake(node["content"])
            if len(value) >= 80:
                return value[:2500]

    text = " ".join(repair_mojibake(v) for v in soup.stripped_strings if clean_text(v))
    for marker in ("Description", "SUMMARY", "Summary"):
        pos = text.find(marker)
        if pos >= 0:
            value = clean_text(text[pos + len(marker):])
            for stop in (" More Series ", " All ", " Chapters Ch.", " Latest chapters "):
                stop_pos = value.find(stop)
                if stop_pos > 80:
                    value = value[:stop_pos]
            if len(value) >= 80:
                return value[:2500]

    return f"{title} was discovered automatically from the source catalog."


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
        if any(needle in lower for needle in needles):
            tags.append(label)
    if not tags:
        tags = ["Fantasy"]
    return tags[0], tags[:6]


def novel_slugs_from_page(raw: str, source: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(raw, "html.parser")
    found: list[str] = []
    seen: set[str] = set()
    if source == "freewebnovel":
        pattern = re.compile(r"https://freewebnovel\.com/novel/([^/?#]+)/*$", re.I)
    else:
        pattern = re.compile(r"https://(?:www\.)?akknovel\.com/series/([^/?#]+)/*$", re.I)

    for anchor in soup.find_all("a", href=True):
        absolute = urljoin(base_url, anchor["href"])
        match = pattern.match(absolute)
        if not match:
            continue
        slug = match.group(1).strip("/")
        if slug and slug not in seen:
            seen.add(slug)
            found.append(slug)
    return found


def discover_fwn_candidates() -> list[str]:
    urls = ["https://freewebnovel.com/sort/most-popular"]
    urls.extend(f"https://freewebnovel.com/sort/most-popular/{page}" for page in range(2, 11))
    found: list[str] = []
    seen: set[str] = set()
    for url in urls:
        try:
            slugs = novel_slugs_from_page(get(url), "freewebnovel", url)
        except Exception as exc:
            print(f"Could not read FreeWebNovel popularity page {url}: {exc}", flush=True)
            continue
        for slug in slugs:
            if slug not in seen:
                seen.add(slug)
                found.append(slug)
    return found


def discover_akk_candidates() -> list[str]:
    urls = []
    for page in range(1, 11):
        suffix = "" if page == 1 else f"&page={page}"
        urls.append(
            "https://www.akknovel.com/series?order=desc&sort=popularity&status=all" + suffix
        )

    found: list[str] = []
    seen: set[str] = set()
    for url in urls:
        try:
            slugs = novel_slugs_from_page(get(url), "akknovel", url)
        except Exception as exc:
            print(f"Could not read AkkNovel popularity page {url}: {exc}", flush=True)
            continue
        for slug in slugs:
            if slug not in seen:
                seen.add(slug)
                found.append(slug)

    # Fallback/extension: AkkNovel's home page exposes new, completed, and recently updated series.
    try:
        for slug in novel_slugs_from_page(get("https://www.akknovel.com/"), "akknovel", "https://www.akknovel.com/"):
            if slug not in seen:
                seen.add(slug)
                found.append(slug)
    except Exception as exc:
        print(f"Could not read AkkNovel home page fallback: {exc}", flush=True)

    return found


def cfg_fwn(slug: str) -> dict:
    url = f"https://freewebnovel.com/novel/{slug}"
    soup = BeautifulSoup(get(url), "html.parser")
    title = page_title(soup, slug)
    synopsis = synopsis_from_page(soup, title)
    tags = []
    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        if "/genre/" in href or "/genres/" in href:
            value = repair_mojibake(anchor.get_text(" ", strip=True))
            if value and value not in tags:
                tags.append(value)
    genre, guessed = classify(" ".join([title, synopsis, *tags]))
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


def prune_candidates(source: str, candidates: dict, auto_registry: dict) -> dict:
    existing = existing_source_slugs(source)
    existing.update(cfg.get("slug", "") for cfg in auto_registry.values())
    return {
        key: cfg
        for key, cfg in candidates.items()
        if cfg.get("slug") and cfg.get("slug") not in existing
    }


def discover(source: str, requested_limit: int, promote: bool) -> tuple[int, int]:
    configured_batch_size, sourcewide_authorized = policy_for(source)
    limit = configured_batch_size if requested_limit <= 0 else requested_limit

    registry_file = registry_path(source)
    candidates_file = candidate_path(source)
    auto_registry = load_json(registry_file)
    candidates = prune_candidates(source, load_json(candidates_file), auto_registry)

    if source == "freewebnovel":
        discovered = discover_fwn_candidates()
        make_cfg = cfg_fwn
    else:
        discovered = discover_akk_candidates()
        make_cfg = cfg_akk

    blocked = existing_source_slugs(source)
    blocked.update(cfg.get("slug", "") for cfg in auto_registry.values())
    blocked.update(cfg.get("slug", "") for cfg in candidates.values())

    added = 0
    remaining_slots = max(0, limit - len(candidates))
    for rank, slug in enumerate(discovered, start=1):
        if added >= remaining_slots:
            break
        if slug in blocked:
            continue
        try:
            cfg = make_cfg(slug)
        except Exception as exc:
            print(f"Skipping {slug}: {exc}", flush=True)
            continue
        key = slug_key(slug)
        while key in candidates or key in auto_registry:
            key += "-auto"
        cfg["discoveryRank"] = rank
        cfg["discoveredFrom"] = "Most Popular" if source == "freewebnovel" else "Popularity/active catalog"
        candidates[key] = cfg
        blocked.add(slug)
        added += 1
        print(f"Selected candidate {source}: {cfg['title']} ({slug})", flush=True)
        time.sleep(0.35)

    save_json(candidates_file, candidates)
    print(
        f"{source}: candidate queue has {len(candidates)}/{limit}; added {added} this run.",
        flush=True,
    )

    promoted = 0
    if not promote:
        return added, promoted

    if not sourcewide_authorized:
        print(
            f"{source}: automatic publication is paused because sourcewide_authorized is false in "
            f"{POLICY_PATH.relative_to(ROOT)}. Candidates were saved but not imported.",
            flush=True,
        )
        return added, promoted

    if len(candidates) < limit:
        print(
            f"{source}: waiting for a full {limit}-title candidate batch before promotion.",
            flush=True,
        )
        return added, promoted

    promoted_keys = []
    for key in list(candidates.keys())[:limit]:
        pending = candidates[key]
        slug = pending.get("slug", "")
        try:
            refreshed = make_cfg(slug)
        except Exception as exc:
            print(f"Could not refresh {slug} before promotion: {exc}", flush=True)
            continue
        refreshed["discoveryRank"] = pending.get("discoveryRank")
        refreshed["discoveredFrom"] = pending.get("discoveredFrom")
        auto_registry[key] = refreshed
        candidates.pop(key)
        promoted_keys.append(key)
        promoted += 1

    if promoted < limit:
        print(
            f"{source}: only {promoted}/{limit} candidates refreshed successfully; "
            "waiting for a complete batch before starting automatic publication.",
            flush=True,
        )
        # Roll back only this attempted batch so older automatic registries stay intact.
        for key in promoted_keys:
            candidates[key] = auto_registry.pop(key)
        promoted = 0

    save_json(registry_file, auto_registry)
    save_json(candidates_file, candidates)
    print(
        f"{source}: promoted a full automatic batch of {promoted} titles for import.",
        flush=True,
    )
    return added, promoted


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover the next NovelNest automatic batch without requiring manual novel links."
    )
    parser.add_argument("source", choices=["freewebnovel", "akknovel"])
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Candidate batch size. 0 uses scripts/auto_import_policy.json (default 15).",
    )
    parser.add_argument(
        "--promote",
        action="store_true",
        help="Promote a full candidate batch only when source-wide authorization is enabled.",
    )
    args = parser.parse_args()
    discover(args.source, args.limit, args.promote)


if __name__ == "__main__":
    main()
