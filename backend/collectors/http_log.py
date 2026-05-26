"""Wrapper HTTP com logging centralizado para todos os coletores externos.

Cada request externo aparece nos docker logs com:
  HTTP GET <url>
    -> <status> (<tempo>s) <snippet da resposta, truncado em 500 chars>
"""
import logging
import time

import requests as _req

_TRUNCATE = 500   # max chars da resposta exibidos no log


def fetch(url, headers=None, timeout=10):
    """GET com logging completo. Levanta HTTPError em nao-2xx."""
    logging.info("HTTP GET %s", url)
    t0 = time.time()

    resp = _req.get(url, headers=headers or {}, timeout=timeout)
    elapsed = time.time() - t0

    try:
        text = resp.text
        snippet = text[:_TRUNCATE] + (" ...[truncado]" if len(text) > _TRUNCATE else "")
    except Exception:
        snippet = "<corpo binario>"

    if resp.ok:
        logging.info("  -> %d (%.2fs) %s", resp.status_code, elapsed, snippet)
    else:
        logging.warning("  -> %d (%.2fs) %s", resp.status_code, elapsed, snippet)

    resp.raise_for_status()
    return resp
