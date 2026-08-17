"""News collector from an RSS/Atom feed."""
import calendar as _calendar
import datetime
import re

import feedparser

from collectors.http_log import fetch as _http_fetch
import settings

_TIMEOUT = 12
_UA = "Mozilla/5.0 (LabPad)"
_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)


def _image(entry):
    """Extract the URL of the first image in the item, if any."""
    thumbs = entry.get("media_thumbnail")
    if thumbs and thumbs[0].get("url"):
        return thumbs[0]["url"]
    media = entry.get("media_content")
    if media:
        for m in media:
            if m.get("medium") == "image" or m.get("type", "").startswith("image/"):
                if m.get("url"):
                    return m["url"]
    for link in entry.get("links", []):
        if (link.get("rel") == "enclosure"
                and link.get("type", "").startswith("image/")
                and link.get("href")):
            return link["href"]
    # First <img> inside the summary/content HTML (e.g. g1.com feeds).
    html = entry.get("summary", "")
    if not html and entry.get("content"):
        try:
            html = entry["content"][0].get("value", "")
        except (IndexError, AttributeError, KeyError):
            html = ""
    match = _IMG_RE.search(html or "")
    if match:
        return match.group(1)
    return None


def _entry_epoch(entry):
    """Publication time of an entry as a Unix timestamp, or None when the feed
    gives no parseable date. Prefers 'published' over 'updated'."""
    when = entry.get("published_parsed") or entry.get("updated_parsed")
    if not when:
        return None
    try:
        return _calendar.timegm(when)
    except (TypeError, ValueError, OverflowError):
        return None


def _sorted_newest_first(entries):
    """Return the feed entries ordered newest-first by publication time.

    RSS/Atom feeds are NOT guaranteed to be sorted newest-first: some
    publishers list oldest-first, and others emit an arbitrary order. The
    dashboard only shows the first `limit` items, so on an unsorted feed the
    raw `entries[:limit]` slice can pin *stale* headlines to the always-on
    wall display while fresher stories never appear. Sorting by publication
    time fixes that regardless of feed order.

    Entries with no parseable date keep their original feed order and sink
    below every dated entry (a missing date shouldn't jump an item to the
    top). Python's sort is stable, so dated entries that share a timestamp —
    and all undated entries — retain their original relative order.
    """
    decorated = list(enumerate(entries))
    # Ascending sort key: dated entries by -epoch (newest first); undated
    # entries get +inf so they land last. The original index breaks ties
    # while preserving feed order (stable sort keeps it, but being explicit
    # keeps the intent obvious).
    def _key(pair):
        idx, entry = pair
        epoch = _entry_epoch(entry)
        if epoch is None:
            return (1, idx)
        return (0, -epoch, idx)
    decorated.sort(key=_key)
    return [entry for _idx, entry in decorated]


def _age_label(published_struct):
    """Relative label ('15 min ago', 'yesterday', ...) from a feedparser
    time.struct_time (always UTC)."""
    if not published_struct:
        return ""
    epoch = _calendar.timegm(published_struct)
    published = datetime.datetime.fromtimestamp(epoch, tz=datetime.timezone.utc)
    now = datetime.datetime.now(datetime.timezone.utc)
    seconds = (now - published).total_seconds()
    if seconds < 0:
        seconds = 0
    if seconds < 3600:
        return "%d min ago" % max(int(seconds // 60), 1)
    if seconds < 86400:
        return "%d h ago" % int(seconds // 3600)
    days = int(seconds // 86400)
    return "yesterday" if days == 1 else ("%d days ago" % days)


def collect():
    url = settings.get("news", "url", "")
    if not url:
        return {"items": [], "configured": False}

    response = _http_fetch(url, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
    parsed = feedparser.parse(response.content)

    limit = settings.get("news", "limit", 5)
    entries = _sorted_newest_first(parsed.entries or [])
    items = []
    for entry in entries[:limit]:
        when = entry.get("published_parsed") or entry.get("updated_parsed")
        items.append({
            "title": entry.get("title", "(no title)"),
            "link": entry.get("link", ""),
            "age": _age_label(when),
            "image": _image(entry),
        })

    source = ""
    feed = getattr(parsed, "feed", None)
    if feed:
        source = feed.get("title", "")
    return {"items": items, "configured": True, "source": source}
