#!/usr/bin/env python3
"""Read latest-chapter ages reported by sources, independent of local imports.

Does NOT download/publish chapters, change import timestamps, or invent dates.
Records a source-reported relative age at the time of observation.
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

DIST = Path("dist")
OUTPUT = DIST / "source-activity.js"
SOURCE_RE = re.compile(r"6\s+Latest\s+Chapters\s*\[\s*Updated\s+(just now|yesterday|\d+\s*(?:mins?|minutes?|hours?|days?|weeks?)\s+ago)\s*\]", re.I)
CHAPTER_RE = re.compile(r"/chapter-(\d+)(?:[/?#]|$)", re.I)
UNITS = {"min": 60, "minute": 60, "hour": 3600, "day": 86400, "week": 604800}

def report_seconds(text):
    match = SOURCE_RE.search(text)
    if not match:
        return None
    value = match.group(1).lower().strip()
    if value == "just now":
        return 0
    if value == "yesterday":
        return 86400
    pair = re.fullmatch(r"(\d+)\s*(mins?|minutes?|hours?|days?|weeks?)\s+ago", value)
    if not pair:
        return None
    amount = int(pair.group(1))
    unit = pair.group(2).rstrip("s")
    return amount * UNITS[unit] if amount <= 999 else None

def catalog(path):
    match = re.search(r"const novel\s*=\s*(\{.*?\});\s*const index\s*=", path.read_text(encoding="utf-8"), re.S)
    return json.loads(match.group(1)) if match else None

def source_activity(novel, page, observed):
    if novel.get("source") != "FreeWebNovel":
        return None
    url = novel.get("sourceUrl", "")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "freewebnovel.com" or not parsed.path.startswith("/novel/"):
        return None
    soup = BeautifulSoup(page, "html.parser")
    # Only the series' latest-chapter header counts. Never accept generic
    # updated text from sidebars, page footers or local import metadata.
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    age = report_seconds(text)
    if age is None or age > 7*86400:
        return None
    # Status must belong to the series, before the latest chapter list.
    prefix = text.split("6 Latest Chapters", 1)[0]
    statuses = re.findall(r"\b(OnGoing|Completed)\b", prefix, re.I)
    if not statuses or statuses[-1].lower() != "ongoing":
        return None
    slug = parsed.path.rstrip("/").split("/")[-1]
    # The six latest chapters appear immediately AFTER the latest list heading.
    heading = next((tag for tag in soup.find_all(["h2","h3","h4"]) if "6 Latest Chapters" in tag.get_text(" ",strip=True)), None)
    links = []
    if heading:
        for tag in heading.next_elements:
            if getattr(tag, "name", None) in ("h2", "h3", "h4") and tag is not heading:
                break
            if getattr(tag, "name", None) == "a":
                links.append(tag)
            if len(links) >= 6:
                break
    # Fallback: inspect the first part of the source chapter list, not related books.
    if not links:
        links = soup.select("a[href*='chapter-']")[:12]
    choices = []
    for link in links:
        href = link.get("href") or ""
        if slug not in href and not href.startswith("/chapter-"):
            continue
        m = CHAPTER_RE.search(href)
        if not m:
            continue
        number = int(m.group(1))
        label = " ".join(link.get_text(" ", strip=True).split())[:180]
        if number > 0:
            choices.append((number, label))
    if not choices:
        return None
    number,title = max(choices, key=lambda pair: pair[0])
    return {
        "sourceActivityVerified": True,
        "sourceActivityIsOngoing": True,
        "sourceActivityObservedAt": observed,
        "sourceActivityAgeSeconds": age,
        "sourceActivityChapter": number,
        "sourceActivityTitle": title or f"Chapter {number}"
    }

def read_previous():
    if not OUTPUT.exists():
        return {}
    raw = OUTPUT.read_text(encoding="utf-8")
    match = re.search(r"const reports = (\{.*?\});", raw, re.S)
    if not match:
        return {}
    try:
        value = json.loads(match.group(1))
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}

def serialize(data):
    payload = json.dumps(data, ensure_ascii=False, separators=(",",":" )).replace("<","\\u003c")
    return (
        "// Source-reported chapter activity, not NovelHaven import timestamps.\n"
        "(() => {\n  const reports = "+payload+";\n"
        "  for (const n of window.NOVELS || []) {\n"
        "    if (Object.prototype.hasOwnProperty.call(reports, n.id)) Object.assign(n, reports[n.id]);\n"
        "  }\n})();\n"
    )

def scan():
    index = (DIST / "index.html").read_text(encoding="utf-8")
    existing=read_previous()
    results={}
    session=requests.Session()
    session.headers.update({"User-Agent":"Mozilla/5.0 (compatible; NovelHavenSourceUpdateChecker/1.0)", "Accept-Language":"en-US,en;q=0.9"})
    observed=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
    checked=0
    for path in sorted(DIST.glob("licensed-fwn-*.js")):
        if f'src="{path.name}"' not in index:
            continue
        n = catalog(path)
        if not n or n.get("source")!="FreeWebNovel":
            continue
        url=n.get("sourceUrl","")
        parsed=urlparse(url)
        if parsed.scheme!="https" or parsed.netloc!="freewebnovel.com":
            continue
        checked+=1
        try:
            response=session.get(url,timeout=22)
            response.raise_for_status()
            current=source_activity(n,response.text,observed)
            if current:
                results[n["id"]]=current
                print(f"{n['id']}: source reports chapter {current['sourceActivityChapter']} ~{current['sourceActivityAgeSeconds']}s ago",flush=True)
        except (requests.RequestException, ValueError) as ex:
            # Retain the previous observation for temporary source failures.
            if n["id"] in existing:
                results[n["id"]]=existing[n["id"]]
            print(f"WARNING {n['id']}: {str(ex)[:150]}",file=sys.stderr,flush=True)
        time.sleep(0.15)
    if checked==0:
        raise RuntimeError("No registered FreeWebNovel series found; refusing to overwrite source activity")
    OUTPUT.write_text(serialize(results),encoding="utf-8")
    print(f"Checked {checked} registered series; {len(results)} sources reported activity in the last 7 days.",flush=True)

if __name__=="__main__":
    scan()
