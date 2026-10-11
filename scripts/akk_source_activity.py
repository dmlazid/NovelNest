"""AkkNovel source chapter tracking: detect source growth, never import activity.

AkkNovel currently exposes latest chapters and status, but no dependable
chapter publication timestamp on the public series pages. We therefore
record when NEW source chapter growth was first detected, not when imported.
"""
import re
from urllib.parse import urlparse
from bs4 import BeautifulSoup, NavigableString, Tag

FIVE_DAYS = 5*86400


def relative_seconds(label):
    """Only parse ages explicitly reported by AkkNovel (never local timestamps)."""
    value = " ".join(label.lower().split()).strip()
    if value in ("just now", "now"):
        return 0
    if value == "yesterday":
        return 86400
    match = re.fullmatch(r"(?:(an?|one)|([1-9][0-9]{0,2}))\s+(second|minute|hour|day|week)s?\s+ago", value)
    if not match:
        return None
    number = int(match.group(2)) if match.group(2) else 1
    unit = match.group(3)
    return number * {"second":1,"minute":60,"hour":3600,"day":86400,"week":604800}[unit]


def latest_updated_homepage(html):
    """Map series slugs to ages from AkkNovel's own *Latest Updated* list only."""
    soup = BeautifulSoup(html, "html.parser")
    heading = next((tag for tag in soup.find_all(["h1","h2","h3","h4"])
                    if tag.get_text(" ", strip=True).lower() == "latest updated"), None)
    if heading is None:
        return {}
    reports = {}
    current = None
    ongoing = False
    for node in heading.next_elements:
        if isinstance(node, Tag):
            if node.name == "footer" or (node.name in ("h1","h2","h3") and node is not heading):
                break
            if node.name == "a":
                parsed = urlparse(node.get("href") or "")
                slug = re.fullmatch(r"/series/([a-z0-9-]+)/?", parsed.path)
                if slug and (not parsed.netloc or parsed.netloc in ("akknovel.com","www.akknovel.com")):
                    current = slug.group(1)
                    ongoing = False
        elif isinstance(node, NavigableString):
            value = " ".join(str(node).split())
            if value.lower() in ("ongoing", "on going", "completed"):
                ongoing = value.lower() != "completed"
            age = relative_seconds(value)
            if current and ongoing and age is not None and age < FIVE_DAYS:
                reports[current] = age
                current = None
                ongoing = False
    return reports


def source_update(novel, html, observed, previous=None, homepage_age=None):
    if novel.get("source") != "AkkNovel":
        return None
    url = urlparse(str(novel.get("sourceUrl", "")))
    if url.scheme != "https" or url.hostname not in ("www.akknovel.com", "akknovel.com"):
        return None
    m = re.fullmatch(r"/series/([a-z0-9-]+)/?", url.path)
    if not m:
        return None
    slug = m.group(1)
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    if not heading:
        return None
    after = []
    for piece in heading.next_elements:
        if isinstance(piece, str) and piece.strip():
            after.append(piece.strip())
        if len(after) >= 15 or any(p.lower() == "bookmark" for p in after):
            break
    statuses = [p.lower() for p in after if p.lower() in ("ongoing", "on going", "completed")]
    if not statuses:
        return None
    ongoing = statuses[0] != "completed"

    # Count chapters in THIS novel, not recommendation/sidebar chapter links.
    # AkkNovel chapter URLs are /series/{slug}/chapter-N[optional-suffix].
    chapter_re = re.compile(r"^/series/" + re.escape(slug) + r"/chapter-(\d+)(?:[-/?#]|$)", re.I)
    chapters = []
    for link in soup.find_all("a", href=True):
        parsed = urlparse(link["href"])
        if parsed.hostname and parsed.hostname not in ("akknovel.com","www.akknovel.com"):
            continue
        hit = chapter_re.match(parsed.path)
        if not hit:
            continue
        number = int(hit.group(1))
        if number < 1 or number > 1000000:
            continue
        label = " ".join(link.get_text(" ", strip=True).split())[:180]
        label = re.sub(r"^Last chapter:\s*", "", label, flags=re.I)
        # Match displayed 'Ch.282Settling Old Grudges Today', and spaced variants.
        label = re.sub(r"^(?:Ch\.?|Chapter)\s*" + str(number) + r"\s*[:.\-–—]?\s*", "", label, flags=re.I).strip()
        chapters.append((number,label))
    if not chapters:
        return None
    tip,title = max(chapters, key=lambda x:(x[0],len(x[1])))
    title = (f"Chapter {tip}: {title}" if title else f"Chapter {tip}")[:180]
    old = previous if isinstance(previous,dict) else {}
    old_tip = max(
        int(novel.get("sourceObservedChapter") or 0),
        int(old.get("sourceScanObservedTip") or 0)
    )
    # The first visit is only a baseline when no earlier source observation
    # exists; this does not turn the importer checkpoint into a release.
    release = {
        "sourceScanObservedTip": max(tip,old_tip),
        "sourceScanObservedAt": observed,
        "sourceScanIsOngoing": ongoing,
        "sourceIsOngoing": ongoing
    }
    prior_number = int(old.get("sourceReleaseNumber") or 0)
    prior_time = str(old.get("sourceReleaseAt") or "")
    if old_tip > 0 and tip > old_tip:
        release.update(sourceReleaseNumber=tip,sourceReleaseTitle=title,
                       sourceReleaseAt=observed,sourceIsOngoing=ongoing)
    elif prior_number > 0 and prior_time and ongoing:
        release.update(sourceReleaseNumber=prior_number,
                       sourceReleaseTitle=str(old.get("sourceReleaseTitle") or title),
                       sourceReleaseAt=prior_time,sourceIsOngoing=True)
    if ongoing and type(homepage_age) is int and 0 <= homepage_age < FIVE_DAYS:
        release.update(sourceActivityVerified=True, sourceActivityIsOngoing=True,
                       sourceActivityObservedAt=observed, sourceActivityAgeSeconds=homepage_age,
                       sourceActivityChapter=tip, sourceActivityTitle=title,
                       sourceActivityProvenance="AkkNovel Latest Updated listing + series chapter tip")
    elif old.get("sourceActivityVerified") and old.get("sourceActivityIsOngoing") and ongoing:
        # Preserve last observed source activity if homepage entry rotates out.
        # Client computes its age from its original observation; it expires naturally.
        release.update({key:old[key] for key in ("sourceActivityVerified",
            "sourceActivityIsOngoing","sourceActivityObservedAt",
            "sourceActivityAgeSeconds","sourceActivityChapter",
            "sourceActivityTitle","sourceActivityProvenance") if key in old})
    return release
