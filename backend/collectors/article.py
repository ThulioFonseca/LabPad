"""Modo leitura: baixa a URL de uma noticia e devolve HTML limpo.

Usa trafilatura (estado-da-arte em extracao de conteudo de noticias) para
remover ads, menus, "leia tambem" etc., preservando paragrafos, subtitulos e
listas. Devolve tambem metadata (titulo, autor, data, hostname, og:image).

Cache em memoria com TTL curto: reabrir a mesma materia nao refaz o fetch.
"""
import logging
import re
import time

import requests

try:
    from trafilatura import extract, extract_metadata
    _HAS_TRAFILATURA = True
except ImportError:
    _HAS_TRAFILATURA = False
    logging.warning("trafilatura nao instalado — /api/article ficara indisponivel")

_TIMEOUT = 10
_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 HomelabMonitor/1.0")
_CACHE_TTL = 600    # 10 min
_CACHE_MAX = 50
_META_REFRESH = re.compile(
    r'<meta[^>]+http-equiv=["\']refresh["\'][^>]+url=([^"\'>\s]+)',
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
    """GET com redirects HTTP. Se o destino final ainda for news.google.com
    (interstitial), tenta seguir o meta-refresh uma vez (handles RSS do
    Google News que aponta para um wrapper antes do publisher real)."""
    response = requests.get(url, timeout=_TIMEOUT,
                            headers={"User-Agent": _UA})
    response.raise_for_status()
    html = response.text
    final_url = response.url
    if "news.google.com" in final_url:
        match = _META_REFRESH.search(html[:8192])
        if match:
            target = match.group(1)
            response = requests.get(target, timeout=_TIMEOUT,
                                    headers={"User-Agent": _UA})
            response.raise_for_status()
            html = response.text
            final_url = response.url
    return html, final_url


def get(url):
    """Devolve {title, image, html, site, author, date, url} ou {error: ...}."""
    cached = _cache_get(url)
    if cached is not None:
        return cached
    if not _HAS_TRAFILATURA:
        return {"error": "trafilatura nao instalado no container"}
    try:
        html, final_url = _fetch(url)
    except requests.RequestException as exc:
        return {"error": "Falha ao baixar: " + str(exc)}

    body = extract(html, url=final_url, output_format='html',
                   include_images=False, include_links=False,
                   favor_recall=True)
    if not body:
        return {"error": "Nao foi possivel extrair o conteudo desta pagina"}

    meta = None
    try:
        meta = extract_metadata(html, default_url=final_url)
    except Exception:
        pass

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
