"""Tests for the shared SSRF guard.

The guard protects /api/article and the image proxy, both of which fetch
attacker-influenced URLs (an RSS feed or a redirect chain can point anywhere).
The dangerous cases are the ones a naive single-IPv4 resolve misses: hosts that
resolve over IPv6 only, and hosts whose record set mixes a public address with
an internal one so the check and the eventual connect can disagree.

``socket.getaddrinfo`` is monkeypatched so the tests never touch real DNS and
stay deterministic. Its return shape is
``[(family, type, proto, canonname, sockaddr), ...]`` where sockaddr[0] is the
IP string — that is all the guard reads.
"""
import socket

import net_guard


def _resolver(*ip_strings):
    """Build a fake getaddrinfo returning the given IPs (v4 and/or v6)."""
    def fake(host, *args, **kwargs):
        infos = []
        for ip in ip_strings:
            family = socket.AF_INET6 if ":" in ip else socket.AF_INET
            sockaddr = (ip, 0, 0, 0) if family == socket.AF_INET6 else (ip, 0)
            infos.append((family, socket.SOCK_STREAM, 0, "", sockaddr))
        return infos
    return fake


# --- Public destinations are allowed -------------------------------------

def test_allows_a_public_ipv4(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("93.184.216.34"))
    assert net_guard.is_private_host("example.com") is False


def test_allows_a_public_ipv6(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("2606:2800:220:1:248:1893:25c8:1946"))
    assert net_guard.is_private_host("example.com") is False


# --- Private / internal IPv4 is blocked ----------------------------------

def test_blocks_loopback_ipv4(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("127.0.0.1"))
    assert net_guard.is_private_host("localhost") is True


def test_blocks_rfc1918_ipv4(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("192.168.1.10"))
    assert net_guard.is_private_host("router.lan") is True


def test_blocks_cloud_metadata_endpoint(monkeypatch):
    """169.254.169.254 is the classic SSRF target on most cloud providers."""
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("169.254.169.254"))
    assert net_guard.is_private_host("metadata") is True


# --- IPv6 blind spot: the whole reason for getaddrinfo -------------------

def test_blocks_ipv6_loopback(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("::1"))
    assert net_guard.is_private_host("v6.local") is True


def test_blocks_ipv6_link_local(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("fe80::1"))
    assert net_guard.is_private_host("v6.local") is True


def test_blocks_ipv6_unique_local(monkeypatch):
    """ULA fc00::/7 — private, but gethostbyname never resolved AAAA to see it."""
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("fd00::1"))
    assert net_guard.is_private_host("v6.local") is True


def test_blocks_ipv4_mapped_ipv6_metadata(monkeypatch):
    """::ffff:169.254.169.254 must be unwrapped, not treated as opaque v6."""
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("::ffff:169.254.169.254"))
    assert net_guard.is_private_host("sneaky") is True


# --- Multi-record bypass: any bad address blocks the whole host ----------

def test_blocks_when_a_public_record_hides_an_internal_one(monkeypatch):
    """A host resolving to [public, loopback] must be blocked: the HTTP client
    may connect to either, so the check has to consider the whole set."""
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("93.184.216.34", "127.0.0.1"))
    assert net_guard.is_private_host("rebind.example") is True


def test_blocks_when_a_public_v4_hides_an_internal_v6(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo",
                        _resolver("93.184.216.34", "::1"))
    assert net_guard.is_private_host("mixed.example") is True


# --- Resolution failures fail closed -------------------------------------

def test_blocks_when_resolution_raises(monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror("name or service not known")
    monkeypatch.setattr(socket, "getaddrinfo", boom)
    assert net_guard.is_private_host("does-not-exist.invalid") is True


def test_blocks_when_nothing_resolves(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver())
    assert net_guard.is_private_host("empty.example") is True


def test_blocks_an_empty_host():
    assert net_guard.is_private_host("") is True
    assert net_guard.is_private_host(None) is True


# --- URL-level wrapper ----------------------------------------------------

def test_is_private_url_extracts_and_checks_the_host(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("127.0.0.1"))
    assert net_guard.is_private_url("http://localhost:8080/secret") is True


def test_is_private_url_allows_a_public_host(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("93.184.216.34"))
    assert net_guard.is_private_url("https://example.com/article") is False


def test_is_private_url_blocks_an_ipv6_literal_url(monkeypatch):
    """urlparse strips the brackets; the guard still resolves and blocks ::1."""
    monkeypatch.setattr(socket, "getaddrinfo", _resolver("::1"))
    assert net_guard.is_private_url("http://[::1]/") is True
