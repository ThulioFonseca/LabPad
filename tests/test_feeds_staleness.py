"""Tests for the per-feed staleness reported by GET /api/feeds (meta.stale).

The scheduler serves the last GOOD calendar/news/weather payload indefinitely
while a source is down, so the frontend needs a signal to tell cached (stale)
data from live data on the always-on wall display. /api/feeds reports, per feed:

    meta.stale[<feed>] = {"stale": bool, "failures": int, "age_s": float|None}

`stale` is True ONLY when we are serving real last-good data AND the most recent
collection attempt failed — a cold, never-successful feed is not "stale".

Loads app.py with the heavy collectors stubbed (same approach as
test_image_route.py / test_settings_validation.py); the route is exercised end
to end against directly-seeded scheduler state.
"""
import importlib
import os
import sys
import types

import pytest

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


def _seed(calendar=None, news=None, weather=None):
    """Directly seed scheduler state for a deterministic /api/feeds read.

    Each arg is a dict describing a feed's state, or None to leave it empty:
      {"good": <payload|None>, "last": <raw|None>, "failures": int,
       "good_age_s": <float|None>}
    Holds the real lock and parks next_run in the future so the background
    scheduler thread never races the seeded values during the test.
    """
    now = _app_mod.time.time()
    spec = {"calendar": calendar, "news": news, "weather": weather}
    with _app_mod._feeds_lock:
        for key, cfg in spec.items():
            _app_mod._feeds_next_run[key] = now + 10000.0
            cfg = cfg or {}
            _app_mod._last_good_feeds[key] = cfg.get("good")
            if cfg.get("good") is None:
                _app_mod._last_good_feeds.pop(key, None)
            _app_mod._feeds_last[key] = cfg.get("last")
            _app_mod._feeds_failures[key] = cfg.get("failures", 0)
            age = cfg.get("good_age_s")
            _app_mod._last_good_time[key] = (now - age) if age is not None else None


@pytest.fixture
def client():
    _app_mod.app.config["TESTING"] = True
    with _app_mod.app.test_client() as c:
        yield c


def _stale(resp, key):
    return resp.get_json()["meta"]["stale"][key]


def test_meta_reports_stale_for_every_feed(client):
    _seed()
    body = client.get("/api/feeds").get_json()
    assert set(body["meta"]["stale"]) == {"calendar", "news", "weather"}


def test_healthy_feed_is_not_stale(client):
    # Fresh good data, no failures → live, not stale.
    _seed(calendar={"good": {"events": [1], "configured": True},
                    "failures": 0, "good_age_s": 30.0})
    info = _stale(client.get("/api/feeds"), "calendar")
    assert info["stale"] is False
    assert info["failures"] == 0
    assert 0 <= info["age_s"] < 120


def test_failing_feed_with_cached_data_is_stale_with_age(client):
    # Source is down (failures > 0) but we still serve the last-good payload:
    # this is exactly the case the badge must flag.
    _seed(news={"good": {"items": [1], "configured": True},
                "last": {"items": [], "configured": True, "error": "boom"},
                "failures": 3, "good_age_s": 7200.0})
    info = _stale(client.get("/api/feeds"), "news")
    assert info["stale"] is True
    assert info["failures"] == 3
    assert 7000 < info["age_s"] < 7400


def test_cold_feed_never_successful_is_not_stale(client):
    # Never collected successfully (no last-good): the frontend shows a hard
    # "Could not read..." state, so this must NOT be reported as merely stale.
    _seed(calendar={"good": None,
                    "last": {"events": [], "configured": True, "error": "boom"},
                    "failures": 2, "good_age_s": None})
    info = _stale(client.get("/api/feeds"), "calendar")
    assert info["stale"] is False
    assert info["age_s"] is None


def test_recovered_feed_clears_stale(client):
    # A feed that failed then recovered: failures back to 0, still serving good
    # data → not stale (the badge disappears).
    _seed(weather={"good": {"configured": True}, "failures": 0,
                   "good_age_s": 10.0})
    info = _stale(client.get("/api/feeds"), "weather")
    assert info["stale"] is False


def test_served_payload_is_still_the_last_good_data(client):
    # Staleness metadata must not change WHICH payload is served: a failing feed
    # still returns its last-good body next to the stale flag.
    _seed(news={"good": {"items": [{"title": "cached"}], "configured": True},
                "last": {"items": [], "configured": True, "error": "boom"},
                "failures": 1, "good_age_s": 100.0})
    body = client.get("/api/feeds").get_json()
    assert body["news"]["items"][0]["title"] == "cached"
    assert body["meta"]["stale"]["news"]["stale"] is True
