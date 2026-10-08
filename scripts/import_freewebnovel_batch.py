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

from publication_guard import may_import_auto_title

BASE = "https://freewebnovel.com/novel"
CHUNK_CAPACITY = 100
BATCH_SIZE = max(1, int(os.environ.get("FWN_BATCH_SIZE", "100")))
REQUEST_DELAY = float(os.environ.get("FWN_REQUEST_DELAY", "0.8"))
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/6.0; +https://novelhaven.top)",
    "Accept-Language": "en-US,en;q=0.9",
}

SERIES = {
    "black-tech-internet-cafe": {
        "id": "black-tech-internet-cafe-system",
        "slug": "black-tech-internet-cafe-system",
        "title": "Black Tech Internet Cafe System",
        "author": "The Leaf That Goes Against Water",
        "genre": "Sci-fi",
        "tags": ["Sci-fi", "Comedy", "System", "Xuanhuan", "Action", "Fantasy"],
    },
    "shadow-slave": {
        "id": "shadow-slave",
        "slug": "shadow-slave",
        "title": "Shadow Slave",
        "author": "Guiltythree",
        "genre": "Action",
        "tags": ["Action", "Adventure", "Fantasy", "Romance"],
    },
    "martial-god-asura": {
        "id": "martial-god-asura",
        "slug": "martial-god-asura-novel",
        "title": "Martial God Asura",
        "author": "Kindhearted Bee",
        "genre": "Action",
        "tags": ["Action", "Fantasy", "Adventure", "Mature", "Xuanhuan", "Harem", "Drama", "Martial Arts"],
    },
    "strongest-sword-god": {
        "id": "reincarnation-of-the-strongest-sword-god",
        "slug": "reincarnation-of-the-strongest-sword-god",
        "title": "Reincarnation Of The Strongest Sword God",
        "author": "Lucky Old Cat",
        "genre": "Xianxia",
        "tags": ["Xianxia", "Martial Arts", "Adventure", "Action", "Xuanhuan", "Fantasy", "Reincarnation"],
    },
    "martial-peak": {
        "id": "martial-peak",
        "slug": "martial-peak",
        "title": "Martial Peak",
        "author": "Momo",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Martial Arts", "Mature", "Action", "Xuanhuan", "Harem"],
    },
    "mechanical-god-emperor": {
        "id": "mechanical-god-emperor",
        "slug": "mechanical-god-emperor",
        "title": "Mechanical God Emperor",
        "author": "Assets Exploding",
        "genre": "Sci-fi",
        "tags": ["Sci-fi", "Xuanhuan", "Action", "Adventure", "Mecha", "Harem"],
    },
    "prodigiously-amazing-weaponsmith": {
        "id": "prodigiously-amazing-weaponsmith",
        "slug": "prodigiously-amazing-weaponsmith",
        "title": "Prodigiously Amazing Weaponsmith",
        "author": "Shui Qingqing",
        "genre": "Romance",
        "tags": ["Romance", "Josei", "Xianxia", "Adventure", "Action", "Drama"],
    },
    "necropolis-immortal": {
        "id": "necropolis-immortal",
        "slug": "necropolis-immortal",
        "title": "Necropolis Immortal",
        "author": "Immortal Amidst Snow In July",
        "genre": "Xianxia",
        "tags": ["Xianxia", "Action", "Adventure", "Comedy", "Fantasy", "Mystery", "Supernatural"],
    },
    "infinite-mana": {
        "id": "infinite-mana-in-the-apocalypse",
        "slug": "infinite-mana-in-the-apocalypse",
        "title": "Infinite Mana In The Apocalypse",
        "author": "Adui",
        "genre": "Adventure",
        "tags": ["Adventure", "Fantasy", "Game", "Action"],
    },
    "reborn-boot-camp": {
        "id": "reborn-at-boot-camp-general-dont-mess-around",
        "slug": "reborn-at-boot-camp-general-dont-mess-around",
        "title": "Reborn at Boot Camp: General, Don't Mess Around!",
        "author": "直上青云",
        "genre": "Mystery",
        "tags": ["Mystery", "Action", "Romance", "Drama", "Josei", "Reincarnation"],
    },
    "my-vampire-system": {
        "id": "my-vampire-system",
        "slug": "my-vampire-system",
        "title": "My Vampire System",
        "author": "Jksmanga",
        "genre": "Action",
        "tags": ["Action", "Fantasy", "System", "Mystery"],
    },
    "mesmerizing-ghost-doctor": {
        "id": "mesmerizing-ghost-doctor",
        "slug": "mesmerizing-ghost-doctor",
        "title": "Mesmerizing Ghost Doctor",
        "author": "Feng Jiong",
        "genre": "Historical",
        "tags": ["Historical", "Comedy", "Fantasy", "Gender Bender", "Josei", "Xuanhuan", "Romance", "Adventure", "Action"],
    },
    "god-of-fishing": {
        "id": "god-of-fishing",
        "slug": "god-of-fishing",
        "title": "God of Fishing",
        "author": "Pig That Can Howl Like A Wolf",
        "genre": "Adventure",
        "tags": ["Adventure", "Romance", "Action"],
    },
    "retirement-world": {
        "id": "she-shocks-the-whole-world-after-retirement",
        "slug": "she-shocks-the-whole-world-after-retirement",
        "title": "She Shocks The Whole World After Retirement",
        "author": "Emperor's Song",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Romance", "Rebirth", "Cultivation", "Adventure"],
    },
    "godly-empress-doctor": {
        "id": "godly-empress-doctor",
        "slug": "godly-empress-doctor",
        "title": "Godly Empress Doctor",
        "author": "Su Xiao Nuan",
        "genre": "Romance",
        "tags": ["Romance", "Fantasy", "Cultivation", "Adventure", "Reincarnation"],
    },
    "chaotic-sword-god": {
        "id": "chaotic-sword-god",
        "slug": "chaotic-sword-god",
        "title": "Chaotic Sword God",
        "author": "Xin Xing Xiao Yao",
        "genre": "Action",
        "tags": ["Action", "Adventure", "Fantasy", "Martial Arts", "Xuanhuan"],
    },
    "re-evolution-online": {
        "id": "re-evolution-online",
        "slug": "re-evolution-online-novel",
        "title": "Re: Evolution Online",
        "author": "Yolohy",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Game", "Action", "Adventure", "Reincarnation"],
    },
    "hero-summoning-peace": {
        "id": "hero-summoning-world-at-peace",
        "slug": "i-was-caught-up-in-a-hero-summoning-but-that-world-is-at-peace",
        "title": "I Was Caught up in a Hero Summoning, but That World Is at Peace",
        "author": "Toudai",
        "genre": "Romance",
        "tags": ["Romance", "Fantasy", "Comedy", "Isekai", "Slice of Life"],
    },
    "fey-evolution-merchant": {
        "id": "fey-evolution-merchant",
        "slug": "fey-evolution-merchant",
        "title": "Fey Evolution Merchant",
        "author": "Amber Button",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Adventure", "System", "Cultivation", "Action"],
    },
    "remarried-empress": {
        "id": "remarried-empress",
        "slug": "remarried-empress-novel",
        "title": "Remarried Empress",
        "author": "Alphatart",
        "genre": "Romance",
        "tags": ["Romance", "Fantasy", "Drama", "Josei", "Historical"],
    },
    "overgeared": {
        "id": "overgeared",
        "slug": "overgeared-novel",
        "title": "Overgeared",
        "author": "Park Saenal",
        "genre": "Game",
        "tags": ["Game", "Action", "Adventure", "Fantasy", "Comedy"],
    },
    "dimensional-descent": {
        "id": "dimensional-descent",
        "slug": "dimensional-descent",
        "title": "Dimensional Descent",
        "author": "Awespec",
        "genre": "Action",
        "tags": ["Action", "Adventure", "Fantasy", "Sci-fi", "Cultivation"],
    },
    "legend-of-swordsman": {
        "id": "legend-of-swordsman",
        "slug": "legend-of-swordsman",
        "title": "Legend of Swordsman",
        "author": "Mr. Money",
        "genre": "Action",
        "tags": ["Action", "Adventure", "Fantasy", "Martial Arts", "Xuanhuan"],
    },
    "madams-identities": {
        "id": "madams-identities-shocks-the-entire-city-again",
        "slug": "madams-identities-shocks-the-entire-city-again",
        "title": "Madam's Identities Shocks the Entire City Again",
        "author": "Brother Ling",
        "genre": "Romance",
        "tags": ["Romance", "Modern", "Mystery", "School Life", "Family"],
    },
    "authors-pov": {
        "id": "the-authors-pov",
        "slug": "the-authors-pov",
        "title": "The Author's POV",
        "author": "Entrail_JI",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Action", "Adventure", "School Life", "Transmigration"],
    },
    "keyboard-immortal": {
        "id": "keyboard-immortal",
        "slug": "keyboard-immortal-novel",
        "title": "Keyboard Immortal",
        "author": "Monk Of The Six Illusions",
        "genre": "Action",
        "tags": ["Action", "Comedy", "Fantasy", "Harem", "Martial Arts", "Xuanhuan"],
    },
    "villain-clan": {
        "id": "turns-out-im-in-a-villain-clan",
        "slug": "turns-out-im-in-a-villain-clan",
        "title": "Turns Out I'm in a Villain Clan",
        "author": "Unknown",
        "genre": "Fantasy",
        "tags": ["Fantasy", "System", "Transmigration", "Adventure"],
    },
    "undead-legion": {
        "id": "evolving-my-undead-legion-in-a-game-like-world",
        "slug": "evolving-my-undead-legion-in-a-game-like-world",
        "title": "Evolving My Undead Legion in a Game-Like World",
        "author": "Unknown",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Game", "System", "Necromancer", "Adventure"],
    },
    "beginning-after-end": {
        "id": "the-beginning-after-the-end",
        "slug": "the-beginning-after-the-end-novel",
        "title": "The Beginning After The End",
        "author": "TurtleMe",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Action", "Adventure", "Reincarnation"],
    },
    "sss-suicide-hunter": {
        "id": "sss-class-suicide-hunter",
        "slug": "sssclass-suicide-hunter",
        "title": "SSS-Class Suicide Hunter",
        "author": "Shin Noah",
        "genre": "Action",
        "tags": ["Action", "Adventure", "Fantasy", "Game", "System"],
    },
    "cultivation-chat-group": {
        "id": "cultivation-chat-group",
        "slug": "cultivation-chat-group",
        "title": "Cultivation Chat Group",
        "author": "Legend of the Paladin",
        "genre": "Xianxia",
        "tags": ["Xianxia", "Cultivation", "Comedy", "Fantasy", "Modern"],
    },
    "long-awaited-mr-han": {
        "id": "the-long-awaited-mr-han",
        "slug": "the-long-awaited-mr-han",
        "title": "The Long-awaited Mr Han",
        "author": "As If Dawn",
        "genre": "Romance",
        "tags": ["Romance", "Modern", "Drama", "Rebirth"],
    },
    "supreme-harem-god": {
        "id": "supreme-harem-god-system",
        "slug": "supreme-harem-god-system",
        "title": "Supreme Harem God System",
        "author": "SleepDeprivedSloth",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Harem", "System", "Cultivation", "Action"],
    },
    "my-werewolf-system": {
        "id": "my-werewolf-system",
        "slug": "my-werewolf-system-novel",
        "title": "My Werewolf System",
        "author": "JKSManga",
        "genre": "Action",
        "tags": ["Action", "Fantasy", "System", "Supernatural"],
    },
    "tyranny-of-steel": {
        "id": "tyranny-of-steel",
        "slug": "tyranny-of-steel",
        "title": "Tyranny of Steel",
        "author": "Zentmeister",
        "genre": "Historical",
        "tags": ["Historical", "War", "Kingdom Building", "Reincarnation", "Action"],
    },
    "godly-stay-home-dad": {
        "id": "godly-stay-home-dad",
        "slug": "godly-stay-home-dad",
        "title": "Godly Stay-Home Dad",
        "author": "Shan Wang Zhang",
        "genre": "Romance",
        "tags": ["Romance", "Cultivation", "Modern", "Family", "Comedy"],
    },
    "my-rich-wife": {
        "id": "my-rich-wife",
        "slug": "my-rich-wife",
        "title": "My Rich Wife",
        "author": "Unknown",
        "genre": "Romance",
        "tags": ["Romance", "Urban", "Cultivation", "Action"],
    },
    "hidden-marriage-billionaire": {
        "id": "hidden-marriage-heaven-sent-billionaire-husband",
        "slug": "hidden-marriage-a-heaven-sent-billionaire-husband",
        "title": "Hidden Marriage: A Heaven-sent Billionaire Husband",
        "author": "Unknown",
        "genre": "Romance",
        "tags": ["Romance", "Modern", "Marriage", "Entertainment"],
    },
    "emperor-marry-doctor": {
        "id": "the-emperor-wants-to-marry-the-doctor",
        "slug": "the-emperor-wants-to-marry-the-doctor",
        "title": "The Emperor Wants to Marry the Doctor",
        "author": "Unknown",
        "genre": "Romance",
        "tags": ["Romance", "Fantasy", "Rebirth", "Cultivation", "Historical"],
    },
    "alchemy-emperor-head": {
        "id": "i-have-the-alchemy-emperor-in-my-head",
        "slug": "i-have-the-alchemy-emperor-in-my-head",
        "title": "I Have the Alchemy Emperor in My Head",
        "author": "Fu Xiaochen",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Action", "Cultivation", "Martial Arts", "Alchemy"],
    },
    "versatile-mage": {
        "id": "versatile-mage",
        "slug": "versatile-mage",
        "title": "Versatile Mage",
        "author": "Chaos",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Action", "Magic", "Adventure", "School Life"],
    },
    "alchemy-divine-dao": {
        "id": "alchemy-emperor-of-the-divine-dao",
        "slug": "alchemy-emperor-of-the-divine-dao",
        "title": "Alchemy Emperor of the Divine Dao",
        "author": "Flying Alone",
        "genre": "Xuanhuan",
        "tags": ["Xuanhuan", "Action", "Cultivation", "Alchemy", "Reincarnation"],
    },
    "king-of-technology": {
        "id": "im-the-king-of-technology",
        "slug": "im-the-king-of-technology",
        "title": "I'm the King of Technology",
        "author": "Lumii_",
        "genre": "Fantasy",
        "tags": ["Fantasy", "Kingdom Building", "Technology", "System", "Transmigration"],
    },
    "lady-gu-too-weak": {
        "id": "lady-gu-is-too-weak-to-fend-for-herself",
        "slug": "lady-gu-is-too-weak-to-fend-for-herself",
        "title": "Lady Gu Is Too Weak to Fend for Herself",
        "author": "Unknown",
        "genre": "Romance",
        "tags": ["Romance", "Modern", "Family", "Mystery"],
    },
}

AUTO_SERIES_PATH = Path("scripts/auto_freewebnovel.json")
if AUTO_SERIES_PATH.exists():
    try:
        auto_series = json.loads(AUTO_SERIES_PATH.read_text(encoding="utf-8"))
        if isinstance(auto_series, dict):
            SERIES.update({key: cfg for key, cfg in auto_series.items() if may_import_auto_title("freewebnovel", key)})
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not load {AUTO_SERIES_PATH}: {exc}")


def load_approved_auto_series() -> None:
    """Load only explicitly approved, promoted automatic titles."""
    registry = Path(__file__).with_name("auto_freewebnovel.json")
    if not registry.exists():
        return
    entries = json.loads(registry.read_text(encoding="utf-8"))
    if not isinstance(entries, dict):
        raise ValueError(f"Invalid automatic novel registry: {registry}")
    for key, cfg in entries.items():
        if not may_import_auto_title("freewebnovel", key):
            continue  # Keep unpublished automatic titles queued for manual site-quality review.
        if not isinstance(cfg, dict) or not all(cfg.get(field) for field in ("id", "slug", "title", "author", "genre", "tags")):
            raise ValueError(f"Invalid automatic novel entry: {key}")
        if key in SERIES and SERIES[key]["slug"] != cfg["slug"]:
            raise ValueError(f"Automatic novel key collides with an existing title: {key}")
        SERIES.setdefault(key, cfg)


load_approved_auto_series()

session = requests.Session()
session.headers.update(HEADERS)


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", value, flags=re.I)
    return " ".join(value.split()).strip()


def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(8):
        try:
            response = session.get(url, timeout=30)
            if response.status_code == 429:
                retry_header = response.headers.get("Retry-After")
                try:
                    retry_after = float(retry_header) if retry_header else 0
                except (TypeError, ValueError):
                    retry_after = 0
                delay = max(retry_after, min(90, 8 + attempt * 10))
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


def source_url(cfg: dict) -> str:
    return f"{BASE}/{cfg['slug']}"


def paths(key: str) -> dict:
    safe = re.sub(r"[^a-z0-9-]+", "-", key.lower()).strip("-")
    return {
        "catalog": DIST / f"licensed-fwn-{safe}.js",
        "cover": ASSET_DIR / f"fwn-{safe}.jpg",
        "prefix": f"data/fwn-{safe}-chapters-",
        "glob": f"fwn-{safe}-chapters-*.js",
        "global": "FWN_" + re.sub(r"[^A-Z0-9]+", "_", safe.upper()) + "_CHAPTERS",
    }


def detect_latest(raw: str, cfg: dict) -> int:
    slug = re.escape(cfg["slug"])
    numbers = {int(n) for n in re.findall(slug + r"/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"/chapter-(\d+)", raw, flags=re.I)}
    if not numbers:
        numbers = {int(n) for n in re.findall(r"\bChapter\s+(\d+)\b", raw, flags=re.I)}
    if not numbers:
        raise RuntimeError(f"{cfg['title']}: could not detect chapter numbers on source page")
    return max(numbers)


def find_status(soup: BeautifulSoup) -> str:
    for text_value in soup.stripped_strings:
        value = clean_text(text_value)
        if value == "Completed":
            return "Completed"
        if value in {"OnGoing", "Ongoing"}:
            return "Ongoing"
    return "Ongoing"


def find_author(soup: BeautifulSoup, fallback: str) -> str:
    page_text = " ".join(clean_text(value) for value in soup.stripped_strings if clean_text(value))
    match = re.search(r"\bAuthor\s*:\s*(.+?)(?=\s+(?:Genre|Status|View|SUMMARY|Summary|Latest|Chapter)\b|$)", page_text, flags=re.I)
    if match:
        author = clean_text(match.group(1))
        if author and len(author) <= 160:
            return author
    return fallback


def find_synopsis(soup: BeautifulSoup, fallback: str) -> str:
    marker = None
    for heading in soup.find_all(["h1", "h2", "h3", "h4", "strong"]):
        if clean_text(heading.get_text(" ", strip=True)).upper() == "SUMMARY":
            marker = heading
            break

    if marker is not None:
        parts = []
        for node in marker.next_elements:
            if node is marker or getattr(node, "name", None) in {"script", "style"}:
                continue
            if not isinstance(node, str):
                continue
            value = clean_text(node)
            if not value or value == "SUMMARY":
                continue
            low = value.lower()
            if low in {"see all", "chapter list", "add to library"}:
                break
            if low.startswith(("6 latest chapters", "latest chapters", "chapter list")):
                break
            if value not in parts:
                parts.append(value)
            if sum(len(part) for part in parts) >= 1800:
                break
        synopsis = " ".join(parts).strip()
        synopsis = re.sub(r"\s+See all$", "", synopsis, flags=re.I)
        if len(synopsis) >= 80:
            return synopsis[:2500]

    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        value = clean_text(meta["content"])
        if len(value) >= 80:
            return value[:2500]
    return fallback


def content_container(soup: BeautifulSoup):
    selectors = [
        "div#article", "div.txt", ".chapter-content", ".reading-content",
        ".entry-content", "[class*='chapter-content']", "[class*='reading-content']",
        "article", "main",
    ]
    candidates = []
    seen = set()
    for selector in selectors:
        for node in soup.select(selector):
            if id(node) in seen:
                continue
            seen.add(id(node))
            text_value = clean_text(node.get_text(" ", strip=True))
            pchars = sum(len(clean_text(p.get_text(" ", strip=True))) for p in node.find_all("p"))
            score = pchars * 3 + len(text_value)
            if len(text_value) >= 300:
                candidates.append((score, node))
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def parse_chapter(cfg: dict, number: int) -> dict:
    raw = get(f"{source_url(cfg)}/chapter-{number}")
    soup = BeautifulSoup(raw, "html.parser")
    article = content_container(soup)
    if article is None:
        raise RuntimeError(f"{cfg['title']} Chapter {number}: content container not found")

    for node in article.select(
        "script, style, noscript, nav, aside, footer, form, "
        "div[id^='bg-ssp-'], div[id^='pf-'], p sub, .comments, .comment"
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
        if low.startswith(("previous chapter", "next chapter", "bookmark", "copyright ©")):
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
            if low.startswith(("previous chapter", "next chapter", "bookmark", "copyright ©")):
                continue
            paragraphs.append(value)

    characters = sum(len(p) for p in paragraphs)
    if len(paragraphs) < 3 or characters < 300:
        raise RuntimeError(
            f"{cfg['title']} Chapter {number}: only {len(paragraphs)} blocks / {characters} characters found"
        )

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


def load_existing(key: str, p: dict) -> list[dict]:
    chapters = []
    for path in sorted(DATA_DIR.glob(p["glob"])):
        raw = path.read_text(encoding="utf-8")
        match = re.search(r"\.concat\((.*)\);\s*$", raw, flags=re.S)
        if not match:
            raise RuntimeError(f"{key}: could not parse {path}")
        part = json.loads(match.group(1))
        if not isinstance(part, list):
            raise RuntimeError(f"{key}: invalid chapter payload in {path}")
        chapters.extend(part)
    numbers = [int(c.get("number", 0)) for c in chapters]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError(f"{key}: existing chapter data is not a clean 1..N sequence")
    return chapters


def write_chunks(p: dict, chapters: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    count = math.ceil(len(chapters) / CHUNK_CAPACITY)
    basename = p["prefix"].split("/")[-1]
    for index in range(1, count + 1):
        part = chapters[(index - 1) * CHUNK_CAPACITY:index * CHUNK_CAPACITY]
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        path = DATA_DIR / f"{basename}{index:02d}.js"
        path.write_text(
            f"window.{p['global']}=(window.{p['global']}||[]).concat({payload});\n",
            encoding="utf-8",
        )
    for old in DATA_DIR.glob(p["glob"]):
        match = re.search(r"(\d+)\.js$", old.name)
        if match and int(match.group(1)) > count:
            old.unlink()


def title_key(value: str) -> str:
    return "".join(ch for ch in clean_text(value).casefold() if ch.isalnum())


def cover_url(raw: str, cfg: dict) -> str:
    soup = BeautifulSoup(raw, "html.parser")
    expected = title_key(cfg["title"])
    for image in soup.find_all("img"):
        labels = [title_key(image.get(attr) or "") for attr in ("alt", "title")]
        if expected and expected in labels:
            src = image.get("data-src") or image.get("data-original") or image.get("src")
            if src and not src.startswith("data:"):
                return urljoin(source_url(cfg), src)
    raise RuntimeError(f"{cfg['title']}: matching novel cover not found")


def jpeg_cover(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as image:
        image.load()
        image = ImageOps.exif_transpose(image)
        if image.width < 100 or image.height < 150 or image.height <= image.width:
            raise ValueError("Expected a portrait novel cover")
        image = image.convert("RGB")
        output = BytesIO()
        image.save(output, format="JPEG", quality=92)
        return output.getvalue()


def ensure_cover(raw: str, cfg: dict, p: dict) -> None:
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
    temp = p["cover"].with_suffix(".jpg.tmp")
    temp.write_bytes(data)
    temp.replace(p["cover"])


def previous_updated(catalog: Path) -> str:
    if not catalog.exists():
        return datetime.now(timezone.utc).date().isoformat()
    match = re.search(r'"updated":"([^"]+)"', catalog.read_text(encoding="utf-8"))
    return match.group(1) if match else datetime.now(timezone.utc).date().isoformat()


def write_catalog(key: str, cfg: dict, p: dict, chapters: list[dict], status: str, synopsis: str, updated: str, author: str) -> None:
    metadata = [
        {"number": c["number"], "title": c["title"], "paragraphs": ["Loading chapter…"], "lazy": True}
        for c in chapters
    ]
    novel = {
        "id": cfg["id"],
        "title": cfg["title"],
        "author": author,
        "genre": cfg["genre"],
        "tags": cfg["tags"],
        "status": status,
        "cover": p["cover"].relative_to(DIST).as_posix(),
        "updated": updated,
        "sample": False,
        "synopsis": synopsis,
        "license": {"type": "Authorized publication"},
        "source": "FreeWebNovel",
        "sourceUrl": source_url(cfg),
        "lazyChunks": {
            "prefix": p["prefix"],
            "capacity": CHUNK_CAPACITY,
            "global": p["global"],
        },
        "chapters": metadata,
    }
    p["catalog"].write_text(
        "(() => {\n  const novel = "
        + json.dumps(novel, ensure_ascii=False, separators=(",", ":"))
        + ";\n  const index = window.NOVELS.findIndex(n => n.id === novel.id);\n"
        + "  if (index >= 0) window.NOVELS[index] = novel;\n"
        + "  else window.NOVELS.push(novel);\n})();\n",
        encoding="utf-8",
    )


def ensure_index_registration(key: str) -> None:
    index_path = DIST / "index.html"
    html = index_path.read_text(encoding="utf-8")
    tag = f'<script defer src="licensed-fwn-{key}.js"></script>'
    if tag in html:
        return
    anchor = '<script defer src="licensed-innkeeper.js"></script>'
    if anchor not in html:
        raise RuntimeError("Could not locate FreeWebNovel script anchor in index.html")
    index_path.write_text(html.replace(anchor, anchor + tag), encoding="utf-8")


def import_series(key: str) -> None:
    cfg = SERIES[key]
    p = paths(key)
    raw = get(source_url(cfg))
    soup = BeautifulSoup(raw, "html.parser")
    latest = detect_latest(raw, cfg)
    chapters = load_existing(key, p)
    before = len(chapters)

    print(f"{cfg['title']}: NovelNest has {before}; source reports {latest}.", flush=True)
    if latest < before:
        print(
            f"{cfg['title']}: source currently reports fewer chapters than NovelNest; keeping all {before}.",
            flush=True,
        )
        latest = before

    target = min(latest, before + BATCH_SIZE)
    for number in range(before + 1, target + 1):
        chapters.append(parse_chapter(cfg, number))
        if number % 10 == 0 or number == target:
            print(f"{cfg['title']}: imported {number}/{latest}", flush=True)
        if number < target:
            time.sleep(REQUEST_DELAY)

    numbers = [int(c.get("number", 0)) for c in chapters]
    if numbers != list(range(1, len(chapters) + 1)):
        raise RuntimeError(f"{cfg['title']}: missing, duplicated, or out-of-order chapters")

    ensure_cover(raw, cfg, p)
    write_chunks(p, chapters)
    updated = datetime.now(timezone.utc).date().isoformat() if len(chapters) > before else previous_updated(p["catalog"])
    source_status = find_status(soup)
    status = source_status if len(chapters) >= latest else "Ongoing"
    synopsis = find_synopsis(
        soup,
        f"{cfg['title']} is an authorized FreeWebNovel title available to read on NovelNest.",
    )
    write_catalog(key, cfg, p, chapters, status, synopsis, updated, find_author(soup, cfg["author"]))
    ensure_index_registration(key)

    if len(chapters) < latest:
        print(
            f"{cfg['title']}: checkpoint complete at {len(chapters)}/{latest}; "
            f"the next checkpoint will continue from Chapter {len(chapters) + 1}.",
            flush=True,
        )
    else:
        print(f"{cfg['title']}: caught up at {len(chapters)} chapters.", flush=True)


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] == "--keys":
        print("\n".join(SERIES))
        return
    if len(sys.argv) == 2 and sys.argv[1] == "--keys":
        print("\n".join(SERIES))
        return
    if len(sys.argv) != 2 or sys.argv[1] not in SERIES:
        raise SystemExit("Usage: python scripts/import_freewebnovel_batch.py <series-key>|--keys")
    import_series(sys.argv[1])


if __name__ == "__main__":
    main()
