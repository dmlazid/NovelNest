"""Safety gate for automatically discovered novel titles.

Permission to republish does not by itself satisfy Google Publisher Policies.
New automatically discovered titles stay pending until explicitly reviewed.
Owner-selected, explicitly reviewed titles can import without enabling automatic
candidate promotion. Previously published titles can update chapters.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = {"akknovel": "akk", "freewebnovel": "fwn"}


def is_published_auto_title(source: str, key: str, root: Path = ROOT) -> bool:
    """Only consider a title published if the catalog exists AND the site loads it."""
    if source not in PREFIX or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
        return False
    name = f"licensed-{PREFIX[source]}-{key}.js"
    catalog = root / "dist" / name
    index = root / "dist" / "index.html"
    if not catalog.is_file() or not index.is_file():
        return False
    html = index.read_text(encoding="utf-8")
    return f'src="{name}"' in html or f"src='{name}'" in html


def may_import_auto_title(source: str, key: str, root: Path = ROOT) -> bool:
    """Default-deny NEW automatic titles, while allowing updates to published ones."""
    if is_published_auto_title(source, key, root):
        return True
    policy_path = root / "scripts" / "auto_import_policy.json"
    if not policy_path.is_file():
        return False
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    reviewed = policy.get("reviewed_new_title_keys", {}).get(source, [])
    sourcewide = policy.get("sources", {}).get(source, {}).get("sourcewide_authorized") is True
    # An explicit review key authorizes this owner-selected title even when
    # bulk discovery/promotion is paused. Never allow unreviewed candidates.
    return (
        sourcewide
        and isinstance(reviewed, list)
        and key in reviewed
    )
