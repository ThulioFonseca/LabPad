"""Tests for GET /api/image.

Loads app.py with the heavy collectors stubbed (same approach as
test_settings_validation.py) but keeps the REAL image_proxy, so the route is
exercised end to end with only the network call replaced.
"""
import io
import importlib
import os
import sys
import types

import pytest
from PIL import Image

_STUB_MODULES = (
    "notifications", "settings", "config",
    "collectors.article", "collectors.calendar_feed",
    "collectors.containers", "collectors.host",
    "collectors.news", "collectors.sensors", "collectors.weather",
)
_added = []
for _mod in _STUB_MODULES:
    if _mod not in sys.modules:
        sys.modules[_mod] = types.ModuleType(_mod)
        _added.append(_mod)

for _coll in ("collectors.calendar_feed", "collectors.news", "collectors.weather"):
    if not hasattr(sys.modules[_coll], "collect"):
        sys.modules[_coll].collect = lambda: {}

for _name, _val in (("FEEDS_CACHE_TTL", 900.0), ("FEEDS_RETRY_MIN_S", 60.0),
                    ("FEEDS_RETRY_MAX_S", 600.0), ("CACHE_TTL", 2.0),
                    ("REFRESH_MS", 5000)):
    if not hasattr(sys.modules["config"], _name):
        setattr(sys.modules["config"], _name, _val)

_app_path = os.path.join(os.path.dirname(__file__), "..", "backend", "app.py")
_spec = importlib.util.spec_from_file_location("app", _app_path)
_app_mod = importlib.util.module_from_spec(_spec)
try:
    _spec.loader.exec_module(_app_mod)
finally:
    import collectors as _collectors_pkg
    for _mod in _added:
        stub = sys.modules.pop(_mod, None)
        if _mod.startswith("collectors."):
            _sub = _mod.split(".", 1)[1]
            if getattr(_collectors_pkg, _sub, None) is stub:
                try:
                    delattr(_collectors_pkg, _sub)
                except AttributeError:
                    pass


def _encode(width, height):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (10, 90, 160)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def client():
    _app_mod.image_proxy.clear_cache()
    _app_mod.app.config["TESTING"] = True
    with _app_mod.app.test_client() as c:
        yield c
    _app_mod.image_proxy.clear_cache()


def test_serves_a_downscaled_jpeg(client, monkeypatch):
    monkeypatch.setattr(_app_mod.image_proxy, "_fetch_bytes",
                        lambda url: _encode(2000, 1000))

    resp = client.get("/api/image?url=https://example.com/a.jpg&w=100")

    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "image/jpeg"
    assert Image.open(io.BytesIO(resp.data)).width == 100


def test_sets_a_long_cache_header_so_the_ipad_refetches_rarely(client, monkeypatch):
    monkeypatch.setattr(_app_mod.image_proxy, "_fetch_bytes",
                        lambda url: _encode(800, 400))

    resp = client.get("/api/image?url=https://example.com/a.jpg&w=100")

    assert "max-age" in resp.headers.get("Cache-Control", "")


def test_rejects_a_missing_url(client):
    assert client.get("/api/image?w=100").status_code == 400


def test_rejects_an_internal_url(client):
    resp = client.get("/api/image?url=http://localhost/a.jpg&w=100")

    assert resp.status_code == 400


def test_reports_upstream_failure_as_bad_gateway(client, monkeypatch):
    def boom(url):
        raise ValueError("upstream returned 404")

    monkeypatch.setattr(_app_mod.image_proxy, "_fetch_bytes", boom)

    resp = client.get("/api/image?url=https://example.com/gone.jpg&w=100")

    assert resp.status_code == 502
