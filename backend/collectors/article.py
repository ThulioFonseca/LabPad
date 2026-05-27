"""Reader mode: fetch article URL and return cleaned HTML.

Uses trafilatura (state-of-the-art news content extraction) to remove ads,
menus, "also read", etc., while preserving paragraphs, headings, and lists.
Also returns metadata (title, author, date, hostname, og:image).

In-memory cache with short TTL: reopening the same article skips the fetch.
"""
import logging
import re
import time

from collectors.http_log import fetch as _http_fetch

try:
    from trafilatura import extract, extract_metadata
    _HAS_TRAFILATURA = True
except ImportError:
    _HAS_TRAFILATURA = False
    logging.warning("trafilatura not installed — /api/article will be unavailable")

_TIMEOUT = 10
_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 HomelabMonitor/1.0")
_CACHE_TTL = 600    # 10 min
_CACHE_MAX = 50
# Pattern in BYTES — work with response.content (not decoded) to preserve
# original charset and let trafilatura detect via <meta>.
_META_REFRESH = re.compile(
    rb'<meta[^>]+http-equiv=["\']refresh["\'][^>]+url=([^"\'>\s]+)',
    re.IGNORECASE)

_cache = {}


def _cache_put(url, data):
    if len(_cache) >= _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k]["time"])
        del _cache[oldest]
    _cache[url] = {"time": time.time(), "data": data}


def _cache_get(url):
    entry = _cache.get(url)
    if entry and (time.time() - entry["time"]) < _CACHE_TTL:
        return entry["data"]
    return None


def _fetch(url):
    """GET with HTTP redirects. Return bytes (NOT str) — sites often omit
    charset in headers, and requests defaults to ISO-8859-1, breaking special
    chars. Trafilatura detects charset via <meta charset> / sniffing on bytes.
    If final destination is news.google.com (interstitial), try to follow
    meta-refresh."""
    response = _http_fetch(url, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
    content = response.content
    final_url = response.url
    if "news.google.com" in final_url:
        match = _META_REFRESH.search(content[:8192])
        if match:
            target = match.group(1).decode('ascii', errors='replace')
            response = _http_fetch(target, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
            content = response.content
            final_url = response.url
    return content, final_url


def get(url):
    """Return {title, image, html, site, author, date, url} or {error: ...}."""
    cached = _cache_get(url)
    if cached is not None:
        return cached
    if not _HAS_TRAFILATURA:
        return {"error": "trafilatura nao instalado no container"}
    try:
        content, final_url = _fetch(url)
    except Exception as exc:
        return {"error": "Falha ao baixar: " + str(exc)}

    body = extract(content, url=final_url, output_format='html',
                   include_images=False, include_links=False,
                   favor_recall=True)
    if not body:
        return {"error": "Nao foi possivel extrair o conteudo desta pagina"}

    meta = None
    try:
        meta = extract_metadata(content, default_url=final_url)
    except Exception as exc:
        logging.debug("[article] extract_metadata falhou: %s", exc)

    out = {
        "title":  (getattr(meta, "title", None) or "") if meta else "",
        "image":  (getattr(meta, "image", None) or None) if meta else None,
        "html":   body,
        "site":   ((getattr(meta, "sitename", None) or getattr(meta, "hostname", None) or "")
                   if meta else ""),
        "author": (getattr(meta, "author", None) or None) if meta else None,
        "date":   (getattr(meta, "date", None) or None) if meta else None,
        "url":    final_url,
    }
    _cache_put(url, out)
    return out
