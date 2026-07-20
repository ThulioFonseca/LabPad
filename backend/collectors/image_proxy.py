"""Downscaling image proxy.

Feed images arrive at their publisher's original resolution (a measured
sample from g1 was 7086x4724) but the dashboard paints them into a 52px
thumbnail or a 240px-tall slide. Safari 9 on the iPad 2 decodes a CSS
background at the SOURCE resolution, so the display size does not bound the
memory: ten such images decoded to ~200 MB and the tab was killed within
seconds on a 512 MB device.

This module re-encodes each image to the size it is actually drawn at, so
what reaches the iPad is proportional to the box it fills.

The URL comes from an untrusted RSS feed, so every fetch is validated the
same way /api/article is: SSRF guard, scheme check, byte cap, and a pixel
cap so a decompression bomb cannot be decoded on the server either.
"""
import io
import logging
import time

import requests as _req
from PIL import Image

import net_guard

_TIMEOUT = 10
_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 LabPad/1.0")

_MAX_BYTES = 8 * 1024 * 1024    # refuse absurd downloads outright
_MAX_PIXELS = 50 * 1000 * 1000  # decompression-bomb guard (50 MP)
_MIN_WIDTH = 16
_MAX_WIDTH = 1024               # the iPad 2 screen is 1024x768; never exceed it
_QUALITY = 80

_CACHE_TTL = 900    # 15 min — feeds refresh every 10
_CACHE_MAX = 60

_cache = {}


def clear_cache():
    _cache.clear()


def _cache_put(key, value):
    if len(_cache) >= _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k]["time"])
        del _cache[oldest]
    _cache[key] = {"time": time.time(), "value": value}


def _cache_get(key):
    entry = _cache.get(key)
    if entry and (time.time() - entry["time"]) < _CACHE_TTL:
        return entry["value"]
    return None


def _read_capped(chunks, cap):
    """Concatenate chunks, raising as soon as the total exceeds cap.

    Streaming with a running total means an oversized body is abandoned
    mid-download instead of being buffered in full first.
    """
    buf = bytearray()
    for chunk in chunks:
        if not chunk:
            continue
        buf.extend(chunk)
        if len(buf) > cap:
            raise ValueError("image exceeds %d bytes" % cap)
    return bytes(buf)


def _fetch_bytes(url):
    logging.info("HTTP GET (image) %s", url)
    resp = _req.get(url, headers={"User-Agent": _UA}, timeout=_TIMEOUT,
                    stream=True, allow_redirects=False)
    # Redirects are not followed: each hop would need its own SSRF check and
    # feed thumbnails are served directly in practice.
    if resp.status_code >= 300:
        raise ValueError("upstream returned %d" % resp.status_code)
    try:
        return _read_capped(resp.iter_content(64 * 1024), _MAX_BYTES)
    finally:
        resp.close()


def get(url, width):
    """Return {"data": bytes, "content_type": str}, or {"error": str}."""
    if not url or len(url) > 1000:
        return {"error": "invalid url", "status": 400}
    if not (url.startswith("http://") or url.startswith("https://")):
        return {"error": "url must start with http(s)://", "status": 400}
    if net_guard.is_private_url(url):
        return {"error": "url not allowed", "status": 400}

    try:
        width = int(width)
    except (TypeError, ValueError):
        return {"error": "invalid width", "status": 400}
    width = max(_MIN_WIDTH, min(width, _MAX_WIDTH))

    key = (url, width)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    try:
        raw = _fetch_bytes(url)
        img = Image.open(io.BytesIO(raw))

        # Checked from the header, BEFORE load() decodes anything.
        if (img.width * img.height) > _MAX_PIXELS:
            return {"error": "image too large", "status": 502}
        img.load()

        if img.width > width:
            height = max(1, int(round(img.height * float(width) / img.width)))
            img = img.resize((width, height), Image.LANCZOS)

        if img.mode != "RGB":
            img = img.convert("RGB")

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=_QUALITY, optimize=True)
        result = {"data": out.getvalue(), "content_type": "image/jpeg"}
    except Exception as exc:
        logging.warning("image proxy failed for %s: %s", url, exc)
        return {"error": str(exc), "status": 502}

    _cache_put(key, result)
    return result
