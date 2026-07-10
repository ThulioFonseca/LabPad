"""Centralized HTTP logging wrapper for all external collectors.

Each external request appears in docker logs as:
  HTTP GET <url>
    -> <status> (<elapsed>s) <response snippet, truncated at 500 chars>
"""
import logging
import time

import requests as _req

_TRUNCATE = 500   # max chars of the response shown in the log


def fetch(url, headers=None, timeout=10, allow_redirects=True):
    """GET with full logging. Raises HTTPError on non-2xx.

    Pass allow_redirects=False to receive 3xx responses untouched — the caller
    can then validate each redirect target (SSRF guard) before following it.
    """
    logging.info("HTTP GET %s", url)
    t0 = time.time()

    resp = _req.get(url, headers=headers or {}, timeout=timeout,
                    allow_redirects=allow_redirects)
    elapsed = time.time() - t0

    try:
        text = resp.text
        snippet = text[:_TRUNCATE] + (" ...[truncated]" if len(text) > _TRUNCATE else "")
    except Exception:
        snippet = "<binary body>"

    if resp.ok:
        logging.info("  -> %d (%.2fs) %s", resp.status_code, elapsed, snippet)
    else:
        logging.warning("  -> %d (%.2fs) %s", resp.status_code, elapsed, snippet)

    resp.raise_for_status()
    return resp
