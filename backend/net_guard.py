"""Shared SSRF guard.

Blocks requests whose destination resolves to a private, loopback, link-local
or otherwise non-global address. Used by the /api/article route and by the
article collector to validate every hop of a redirect chain (a public URL can
302 to http://localhost/ or the cloud metadata endpoint).
"""
import ipaddress
import socket

try:
    from urllib.parse import urlparse
except ImportError:  # pragma: no cover - Python 2 fallback
    from urlparse import urlparse


def is_private_host(host):
    """True if the hostname resolves to a non-global address (or can't resolve).

    Resolution failure returns True (block) as a precaution.
    """
    if not host:
        return True
    try:
        ip_str = socket.gethostbyname(host)
        addr = ipaddress.ip_address(ip_str)
    except Exception:
        return True
    return (addr.is_private or addr.is_loopback
            or addr.is_link_local or not addr.is_global)


def is_private_url(url):
    """True if the URL's host points to a private/non-global address."""
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return True
    return is_private_host(host)
