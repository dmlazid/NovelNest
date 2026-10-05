#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://freewebnovel.com/novel/got-a-gallery-in-the-wild"
COVER_URL = "https://freewebnovel.com/files/article/image/15/15776/15776s.jpg"
CHAPTER_COUNT = 170
CHUNK_SIZE = 17
REQUEST_DELAY = 1.1
DIST = Path("dist")
DATA_DIR = DIST / "data"
ASSET_DIR = DIST / "assets"

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; NovelNestAuthorizedImporter/1.0; +https://github.com/dmlazid/NovelNest)",
    "Accept-Language": "en-US,en;q=0.9",
})

def get(url: str, *, binary: bool = False):
    last = None
    for attempt in range(7):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 429:
                retry_header = r.headers.get("Retry-After")
                try: retry_after = float(retry_header) if retry_header else 0
                except (TypeError, ValueError): retry_after = 0
                delay = max(retry_after, min(90, 15 + attempt * 12))
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
    normalized = unicodedata.normalize("NFKD", value)
    normalized = re.sub(r"f?reewebnovel(?:\s*\.\s*com|\s+com)?", "", normalized, flags=re.I)
    return " ".join(normalized.split()).strip()

def parse_chapter(number: int) -> dict:
    raw = get(f"{BASE}/chapter-{number}")
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.select_one("div#article") or soup.select_one("div.txt")
    if article is None: raise RuntimeError(f"Chapter {number}: content container was not found")
    for node in article.select("script, style, div[id^='bg-ssp-'], div[id^='pf-'], p sub"): node.decompose()
    paragraphs=[]
    for p in article.find_all("p"):
        text=clean_text(p.get_text(" ",strip=True));low=text.lower()
        if not text or "this story originates from" in low or "ensure the author gets the support" in low: continue
        paragraphs.append(text)
    if len(paragraphs)<3:
        paragraphs=[clean_text(t) for t in article.stripped_strings if clean_text(t)]
    if len(paragraphs)<3: raise RuntimeError(f"Chapter {number}: only {len(paragraphs)} text blocks were found")
    title_node=soup.select_one("span.chapter")
    title=clean_text(title_node.get_text(" ",strip=True)) if title_node else f"Chapter {number}"
    return {"title":title or f"Chapter {number}","paragraphs":paragraphs}

def write_js_chunks(chapters:list[dict])->None:
    DATA_DIR.mkdir(parents=True,exist_ok=True)
    for old in DATA_DIR.glob("gallery-chapters-*.js"): old.unlink()
    for start in range(0,len(chapters),CHUNK_SIZE):
        part=chapters[start:start+CHUNK_SIZE];index=start//CHUNK_SIZE+1
        payload=json.dumps(part,ensure_ascii=False,separators=(",",":"))
        (DATA_DIR/f"gallery-chapters-{index:02d}.js").write_text("window.GALLERY_CHAPTERS=(window.GALLERY_CHAPTERS||[]).concat("+payload+");\n",encoding="utf-8")

def write_licensed_catalog()->None:
    content="""(() => {
  const chapters = window.GALLERY_CHAPTERS || [];
  window.NOVELS = [{
    id: 'got-a-gallery-in-the-wild',
    title: 'Got a Gallery in the Wild',
    author: 'Ripper_8410 / 두부두부',
    genre: 'Fantasy',
    tags: ['Fantasy','Action','Adventure','Comedy','Harem','Martial Arts','Supernatural'],
    status: 'Ongoing',
    cover: 'assets/got-a-gallery-in-the-wild.jpg',
    updated: '2026-10-05',
    synopsis: 'I ended up in an unknown place. The only thing I can rely on is this gallery. But there are just too many strange people.',
    license: { type: 'Authorized publication', note: 'Published on NovelNest with permission from the rights holder.' },
    chapters
  }];
})();
"""
    (DIST/"licensed-gallery.js").write_text(content,encoding="utf-8")

def main()->None:
    print(f"Refreshing {CHAPTER_COUNT} authorized chapters...",flush=True)
    chapters=[]
    for number in range(1,CHAPTER_COUNT+1):
        chapters.append(parse_chapter(number));print(f"Fetched chapter {number}/{CHAPTER_COUNT}",flush=True)
        if number<CHAPTER_COUNT: time.sleep(REQUEST_DELAY)
    cover=get(COVER_URL,binary=True)
    if len(cover)<10_000: raise RuntimeError("Downloaded cover image is unexpectedly small")
    ASSET_DIR.mkdir(parents=True,exist_ok=True)
    (ASSET_DIR/"got-a-gallery-in-the-wild.jpg").write_bytes(cover)
    write_js_chunks(chapters);write_licensed_catalog()
    print("Refresh complete: 170 chapters and cover generated.",flush=True)

if __name__=="__main__": main()
