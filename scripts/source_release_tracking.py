"""Detect source chapter growth, not downloaded back-catalog chapters."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

def previous(path: Path) -> dict:
    if not path.is_file():
        return {}
    m = re.search(r"const novel\s*=\s*(\{.*?\});\s*const index\s*=", path.read_text(encoding="utf-8"), re.S)
    if not m:
        return {}
    try:
        value = json.loads(m.group(1))
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}

def source_release_metadata(path: Path, tip: int, status: str, title: str = "", now=None) -> dict:
    if type(tip) is not int or tip < 1:
        raise ValueError("Invalid source chapter tip")
    old = previous(path)
    seen = old.get("sourceObservedChapter")
    seen = seen if type(seen) is int and seen > 0 else 0
    ongoing = status.lower().strip() in ("ongoing", "on going")
    n = old.get("sourceReleaseNumber")
    n = n if type(n) is int and n > 0 else 0
    first = old.get("sourceReleaseFirst")
    first = first if type(first) is int and 0 < first <= n else 0
    at = str(old.get("sourceReleaseAt") or "")
    label = str(old.get("sourceReleaseTitle") or "")[:180]
    # The first poll establishes a baseline, never a release.
    if seen and tip > seen and ongoing:
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            raise ValueError("Release detection time must have timezone")
        at = now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        first = min(first or seen + 1, seen + 1)
        n, label = tip, str(title or f"Chapter {tip}").strip()[:180]
    elif not ongoing or tip < seen:
        n, first, at, label = 0, 0, "", ""
    return dict(sourceObservedChapter=max(tip, seen), sourceIsOngoing=ongoing,
                sourceReleaseNumber=n, sourceReleaseFirst=first,
                sourceReleaseAt=at, sourceReleaseTitle=label)
