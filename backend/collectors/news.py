"""Coletor de noticias a partir de um feed RSS/Atom."""
import calendar as _calendar
import datetime

import feedparser
import requests

import config

_TIMEOUT = 12
_UA = "Mozilla/5.0 (HomelabMonitor)"


def _age_label(published_struct):
    """Rotulo relativo ('ha 15 min', 'ontem', ...) a partir do time.struct_time
    do feedparser (sempre em UTC)."""
    if not published_struct:
        return ""
    epoch = _calendar.timegm(published_struct)
    published = datetime.datetime.fromtimestamp(epoch, tz=datetime.timezone.utc)
    now = datetime.datetime.now(datetime.timezone.utc)
    seconds = (now - published).total_seconds()
    if seconds < 0:
        seconds = 0
    if seconds < 3600:
        return "ha %d min" % max(int(seconds // 60), 1)
    if seconds < 86400:
        return "ha %d h" % int(seconds // 3600)
    days = int(seconds // 86400)
    return "ontem" if days == 1 else ("ha %d dias" % days)


def collect():
    url = config.NEWS_RSS_URL
    if not url:
        return {"items": [], "configured": False}

    response = requests.get(url, timeout=_TIMEOUT, headers={"User-Agent": _UA})
    response.raise_for_status()
    parsed = feedparser.parse(response.content)

    items = []
    for entry in parsed.entries[:config.NEWS_LIMIT]:
        when = entry.get("published_parsed") or entry.get("updated_parsed")
        items.append({
            "title": entry.get("title", "(sem titulo)"),
            "link": entry.get("link", ""),
            "age": _age_label(when),
        })

    source = ""
    feed = getattr(parsed, "feed", None)
    if feed:
        source = feed.get("title", "")
    return {"items": items, "configured": True, "source": source}
