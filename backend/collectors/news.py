"""Coletor de noticias a partir de um feed RSS/Atom."""
import calendar as _calendar
import datetime
import re

import feedparser
import requests

import settings

_TIMEOUT = 12
_UA = "Mozilla/5.0 (HomelabMonitor)"
_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)


def _image(entry):
    """Extrai a URL da primeira imagem do item, se houver."""
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
    # Primeira <img> dentro do HTML do resumo/conteudo (caso do g1).
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
    url = settings.get("news", "url", "")
    if not url:
        return {"items": [], "configured": False}

    response = requests.get(url, timeout=_TIMEOUT, headers={"User-Agent": _UA})
    response.raise_for_status()
    parsed = feedparser.parse(response.content)

    limit = settings.get("news", "limit", 5)
    items = []
    for entry in parsed.entries[:limit]:
        when = entry.get("published_parsed") or entry.get("updated_parsed")
        items.append({
            "title": entry.get("title", "(sem titulo)"),
            "link": entry.get("link", ""),
            "age": _age_label(when),
            "image": _image(entry),
        })

    source = ""
    feed = getattr(parsed, "feed", None)
    if feed:
        source = feed.get("title", "")
    return {"items": items, "configured": True, "source": source}
