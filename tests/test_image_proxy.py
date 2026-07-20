"""Tests for the image proxy.

Context: news feed images arrive at their original resolution (one measured
sample was 7086x4724 = 127 MB once decoded) and are painted into a 52x52
CSS background. Safari 9 on the iPad 2 decodes at the SOURCE resolution, so
ten of those exhausted the device's 512 MB and the tab was killed within
seconds. The proxy exists to make the bytes the iPad receives proportional
to the box they are drawn in.
"""
import io

import pytest
from PIL import Image

from collectors import image_proxy


def _encode(width, height, fmt="JPEG", color=(120, 30, 40)):
    """Build a real encoded image of the given size (no mocks)."""
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clear_cache():
    image_proxy.clear_cache()
    yield
    image_proxy.clear_cache()


def test_downscales_to_requested_width_preserving_aspect_ratio(monkeypatch):
    monkeypatch.setattr(image_proxy, "_fetch_bytes", lambda url: _encode(2000, 1000))

    out = image_proxy.get("https://example.com/big.jpg", width=100)

    img = Image.open(io.BytesIO(out["data"]))
    assert (img.width, img.height) == (100, 50)


def test_does_not_upscale_an_image_already_smaller_than_the_target(monkeypatch):
    monkeypatch.setattr(image_proxy, "_fetch_bytes", lambda url: _encode(40, 20))

    out = image_proxy.get("https://example.com/small.jpg", width=100)

    img = Image.open(io.BytesIO(out["data"]))
    assert (img.width, img.height) == (40, 20)


def test_collapses_decoded_memory_of_a_realistic_worst_case(monkeypatch):
    """The measured worst offender: 7086x4724 behind a 52px thumbnail."""
    monkeypatch.setattr(image_proxy, "_fetch_bytes", lambda url: _encode(7086, 4724))

    out = image_proxy.get("https://example.com/huge.jpg", width=104)

    img = Image.open(io.BytesIO(out["data"]))
    decoded_bytes = img.width * img.height * 4
    assert decoded_bytes < 100 * 1024   # was ~127 MB at the source resolution


# --- Guards ---------------------------------------------------------------

def test_refuses_a_url_pointing_at_an_internal_address():
    """The URL comes from an untrusted RSS feed, so it is an SSRF vector."""
    out = image_proxy.get("http://localhost/secret.jpg", width=100)

    assert "error" in out
    assert "data" not in out


def test_refuses_a_non_http_scheme():
    out = image_proxy.get("file:///etc/passwd", width=100)

    assert "error" in out


def test_refuses_a_source_whose_pixel_count_exceeds_the_limit(monkeypatch):
    """A decompression bomb must be rejected before it is decoded."""
    monkeypatch.setattr(image_proxy, "_MAX_PIXELS", 1000)
    monkeypatch.setattr(image_proxy, "_fetch_bytes", lambda url: _encode(2000, 1000))

    out = image_proxy.get("https://example.com/bomb.png", width=100)

    assert "error" in out


def test_refuses_a_body_larger_than_the_byte_cap():
    chunks = [b"x" * 1024] * 50

    with pytest.raises(ValueError):
        image_proxy._read_capped(chunks, cap=8 * 1024)


def test_reads_a_body_within_the_byte_cap():
    assert image_proxy._read_capped([b"ab", b"cd"], cap=1024) == b"abcd"


def test_clamps_an_absurd_width_request(monkeypatch):
    monkeypatch.setattr(image_proxy, "_fetch_bytes", lambda url: _encode(2000, 1000))

    out = image_proxy.get("https://example.com/x.jpg", width=999999)

    img = Image.open(io.BytesIO(out["data"]))
    assert img.width <= image_proxy._MAX_WIDTH


# --- Cache ----------------------------------------------------------------

def test_serves_a_repeated_request_from_cache_without_refetching(monkeypatch):
    calls = []

    def counting_fetch(url):
        calls.append(url)
        return _encode(2000, 1000)

    monkeypatch.setattr(image_proxy, "_fetch_bytes", counting_fetch)

    image_proxy.get("https://example.com/a.jpg", width=100)
    image_proxy.get("https://example.com/a.jpg", width=100)

    assert len(calls) == 1


def test_treats_a_different_width_as_a_different_cache_entry(monkeypatch):
    calls = []

    def counting_fetch(url):
        calls.append(url)
        return _encode(2000, 1000)

    monkeypatch.setattr(image_proxy, "_fetch_bytes", counting_fetch)

    image_proxy.get("https://example.com/a.jpg", width=100)
    image_proxy.get("https://example.com/a.jpg", width=240)

    assert len(calls) == 2
