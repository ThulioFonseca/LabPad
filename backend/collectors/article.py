"""Reader mode: fetch article URL and return cleaned HTML.

Uses trafilatura (state-of-the-art news content extraction) to remove ads,
menus, "also read", etc., while preserving paragraphs, headings, and lists.
Also returns metadata (title, author, date, hostname, og:image).

In-memory cache with short TTL: reopening the same article skips the fetch.
"""
import logging
import re
import time

try:
    from urllib.parse import urljoin
except ImportError:  # pragma: no cover - Python 2 fallback
    from urlparse import urljoin

import net_guard
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

_MAX_REDIRECTS = 5
_REDIRECT_CODES = (301, 302, 303, 307, 308)

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


def _fetch_following(url):
    """Follow redirects one hop at a time, re-validating every target against
    the SSRF guard. requests is told NOT to auto-follow so no intermediate host
    escapes the check (a public URL can 302 to http://localhost/ or a cloud
    metadata endpoint). Returns the final response object."""
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        if net_guard.is_private_url(current):
            raise ValueError("URL not allowed (private/internal destination)")
        response = _http_fetch(current, headers={"User-Agent": _UA},
                               timeout=_TIMEOUT, allow_redirects=False)
        if response.status_code in _REDIRECT_CODES:
            location = response.headers.get("location")
            if not location:
                return response
            current = urljoin(current, location)
            continue
        return response
    raise ValueError("Too many redirects")


def _fetch(url):
    """Fetch article bytes (NOT str) — sites often omit charset in headers, and
    requests defaults to ISO-8859-1, breaking special chars. Trafilatura detects
    charset via <meta charset> / sniffing on bytes. If final destination is
    news.google.com (interstitial), try to follow meta-refresh (also validated)."""
    response = _fetch_following(url)
    content = response.content
    final_url = response.url
    if "news.google.com" in final_url:
        match = _META_REFRESH.search(content[:8192])
        if match:
            target = urljoin(final_url, match.group(1).decode('ascii', errors='replace'))
            response = _fetch_following(target)
            content = response.content
            final_url = response.url
    return content, final_url


def get(url):
    """Return {title, image, html, site, author, date, url} or {error: ...}."""
    cached = _cache_get(url)
    if cached is not None:
        return cached
    if not _HAS_TRAFILATURA:
        return {"error": "trafilatura not installed in container"}
    try:
        content, final_url = _fetch(url)
    except Exception as exc:
        return {"error": "Download failed: " + str(exc)}

    body = extract(content, url=final_url, output_format='html',
                   include_images=False, include_links=False,
                   favor_recall=True)
    if not body:
        return {"error": "Could not extract content from this page"}

    meta = None
    try:
        meta = extract_metadata(content, default_url=final_url)
    except Exception as exc:
        logging.debug("[article] extract_metadata failed: %s", exc)

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
