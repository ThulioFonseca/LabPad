"""Tests for GET /api/health.

Loads app.py with the heavy collectors stubbed (same approach as
test_image_route.py / test_settings_validation.py). The feed collectors are
stubbed to BLOCK forever, which parks the background scheduler thread inside its
first collect() call so it never writes the module-level `_feeds_*` state — the
tests then drive that state directly and assert the health payload determinist
ically, with no race against the scheduler.
"""
import importlib
import os
import sys
import threading
import types

import pytest

# --- Stub the modules app.py imports, before loading it -----------------------
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

# settings.get(section, field, default) reads from a controllable store so tests
# can flip a feed between "configured" and "off".
_CFG_STORE = {
    "weather":  {"city": "Lisbon"},
    "calendar": {"url": "https://example.com/cal.ics"},
    "news":     {"url": "https://example.com/news.xml"},
}


def _settings_get(section, field, default=None):
    return _CFG_STORE.get(section, {}).get(field, default)


sys.modules["settings"].get = _settings_get
sys.modules["settings"]._store = _CFG_STORE

# Feed collectors block forever: the scheduler parks in its first collect() and
# never touches _feeds_* state, so the tests below stay deterministic.
_BLOCK = threading.Event()


def _blocking_collect():
    _BLOCK.wait()
    return {}


for _coll in ("collectors.calendar_feed", "collectors.news", "collectors.weather"):
    sys.modules[_coll].collect = _blocking_collect

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


def _reset_feed_state():
    """All feeds healthy, configured, freshly successful, idle far from re-run."""
    for key in _app_mod._FEED_JOBS:
        _app_mod._feeds_failures[key] = 0
        _app_mod._feeds_last[key] = None
        _app_mod._feeds_last_success[key] = 1000.0
        _app_mod._last_good_feeds[key] = {"configured": True}
        _app_mod._feeds_next_run[key] = _app_mod.time.time() + 900.0
    _CFG_STORE["weather"]["city"] = "Lisbon"
    _CFG_STORE["calendar"]["url"] = "https://example.com/cal.ics"
    _CFG_STORE["news"]["url"] = "https://example.com/news.xml"


@pytest.fixture
def client():
    _reset_feed_state()
    _app_mod.app.config["TESTING"] = True
    with _app_mod.app.test_client() as c:
        yield c


def test_healthy_payload_shape_and_headers(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.headers.get("Cache-Control") == "no-store"

    body = resp.get_json()
    # Backward-compatible fields kept from the old {ok, time} stub.
    assert body["ok"] is True
    assert isinstance(body["time"], float)
    # New fields.
    assert body["status"] == "ok"
    assert isinstance(body["uptime_s"], float)
    assert set(body["feeds"].keys()) == {"calendar", "news", "weather"}
    for entry in body["feeds"].values():
        assert entry["configured"] is True
        assert entry["ok"] is True
        assert entry["consecutive_failures"] == 0
        assert entry["last_error"] is None


def test_configured_feed_failure_marks_degraded(client):
    _app_mod._feeds_failures["news"] = 3
    _app_mod._feeds_last["news"] = {"error": "http 500"}

    body = client.get("/api/health").get_json()

    assert body["ok"] is True                     # process still answers
    assert body["status"] == "degraded"
    assert body["feeds"]["news"]["ok"] is False
    assert body["feeds"]["news"]["consecutive_failures"] == 3
    assert body["feeds"]["news"]["last_error"] == "http 500"
    # A healthy sibling is unaffected.
    assert body["feeds"]["weather"]["ok"] is True


def test_unconfigured_feed_never_degrades(client):
    # Operator never set a news URL: the feed is "off", not failing — even if a
    # stray failure count lingers, it must not drag the overall status down.
    _CFG_STORE["news"]["url"] = ""
    _app_mod._feeds_failures["news"] = 5
    _app_mod._feeds_last["news"] = {"error": "boom"}

    body = client.get("/api/health").get_json()

    assert body["status"] == "ok"
    assert body["feeds"]["news"]["configured"] is False
    assert body["feeds"]["news"]["ok"] is True
    assert body["feeds"]["news"]["last_error"] is None


def test_weather_metno_fallback_is_soft_degraded(client):
    # Weather answers, but from the met.no fallback — a degraded source.
    _app_mod._last_good_feeds["weather"] = {"configured": True, "_source": "met.no"}

    body = client.get("/api/health").get_json()

    assert body["status"] == "degraded"
    assert body["feeds"]["weather"]["ok"] is True           # still returning data
    assert body["feeds"]["weather"]["degraded_source"] == "met.no"


def test_next_run_in_s_is_non_negative(client):
    # A feed overdue for collection must not report a negative countdown.
    _app_mod._feeds_next_run["calendar"] = _app_mod.time.time() - 42.0

    body = client.get("/api/health").get_json()

    assert body["feeds"]["calendar"]["next_run_in_s"] == 0.0
