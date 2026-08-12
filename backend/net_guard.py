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


def _addr_is_blocked(ip_str):
    """True if a single resolved IP must not be reached.

    IPv4-mapped IPv6 addresses (e.g. ``::ffff:169.254.169.254``) are unwrapped
    to their embedded IPv4 first — otherwise the metadata endpoint or loopback
    would sneak through the v6 form, since ``IPv6Address('::ffff:127.0.0.1')``
    is not itself flagged ``is_loopback``. ``not is_global`` is the catch-all
    (covers reserved, unspecified, multicast, ...); the explicit checks are kept
    for clarity and belt-and-suspenders.
    """
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable → block as a precaution
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        addr = mapped
    return (addr.is_private or addr.is_loopback or addr.is_link_local
            or addr.is_reserved or addr.is_multicast or addr.is_unspecified
            or not addr.is_global)


def is_private_host(host):
    """True if the hostname resolves to a non-global address (or can't resolve).

    Resolves the host across BOTH address families (A and AAAA) via
    ``getaddrinfo`` and blocks if ANY resolved address is non-global — not just
    the first IPv4. ``socket.gethostbyname`` alone was an SSRF bypass on two
    fronts: it never sees IPv6, so an AAAA record pointing at ``::1`` / ULA /
    link-local slipped through; and it returns a single address, so a host
    resolving to ``[93.184.216.34, 127.0.0.1]`` could pass the check while the
    HTTP client connected to loopback. Checking every resolved address closes
    both. (A determined attacker can still DNS-rebind between this check and the
    actual connect; enumerating the full set is the strongest guard available
    without pinning the connection to a vetted IP.)

    Resolution failure — or a host that resolves to nothing — returns True
    (block) as a precaution.
    """
    if not host:
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return True
    seen = set()
    for info in infos:
        ip_str = info[4][0]  # sockaddr; [0] is the address for AF_INET/AF_INET6
        if ip_str in seen:
            continue
        seen.add(ip_str)
        if _addr_is_blocked(ip_str):
            return True
    # No address at all resolved → block (nothing safe to reach).
    return not seen


def is_private_url(url):
    """True if the URL's host points to a private/non-global address."""
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return True
    return is_private_host(host)
