"""Tests for PUT /api/settings validation.

Validates _validate_settings() from app.py in isolation — without starting the
Flask server. Covers accepted fields and rejection rules.
"""
import sys
import os
import types
import importlib

import flask

# Stub the collector/service modules app.py imports (not needed to test pure
# validation). The stubs are installed ONLY for the duration of the module
# load, then removed — otherwise they leak into sys.modules and break the real
# collector tests (host/sensors/weather) when the whole suite runs together.
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

# app.py accesses these at module level when building the _FEED_JOBS dict.
# Stubs must expose a callable `collect` before exec_module runs.
for _coll in ("collectors.calendar_feed", "collectors.news", "collectors.weather"):
    if not hasattr(sys.modules[_coll], "collect"):
        sys.modules[_coll].collect = lambda: {}

# Importing app.py starts the background feeds scheduler (daemon thread), which
# reads these numeric config values. Provide them on the stub so the thread
# doesn't raise AttributeError and emit an unhandled-thread warning.
for _name, _val in (("FEEDS_CACHE_TTL", 900.0), ("FEEDS_RETRY_MIN_S", 60.0),
                    ("FEEDS_RETRY_MAX_S", 600.0), ("CACHE_TTL", 2.0),
                    ("REFRESH_MS", 5000)):
    if not hasattr(sys.modules["config"], _name):
        setattr(sys.modules["config"], _name, _val)

# Load only the validation function without starting the server.
_app_path = os.path.join(os.path.dirname(__file__), "..", "backend", "app.py")
_spec = importlib.util.spec_from_file_location("app", _app_path)
_app_mod = importlib.util.module_from_spec(_spec)
try:
    _spec.loader.exec_module(_app_mod)
    _validate = _app_mod._validate_settings
finally:
    # Undo the stubbing so a later test can import the real modules. Also drop
    # the attribute the `from collectors import ...` in app.py set on the
    # package, so `from collectors import weather` re-imports the real one.
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


def test_payload_vazio_aceito():
    assert "error" not in _validate({})


def test_weather_city_aceito():
    result = _validate({"weather": {"city": "Carandai"}})
    assert result.get("weather", {}).get("city") == "Carandai"


def test_weather_city_truncado_a_100():
    city = "x" * 200
    result = _validate({"weather": {"city": city}})
    assert len(result["weather"]["city"]) == 100


def test_calendar_url_invalida_rejeitada():
    result = _validate({"calendar": {"url": "ftp://invalido"}})
    assert "error" in result


def test_calendar_url_vazia_aceita():
    result = _validate({"calendar": {"url": ""}})
    assert "error" not in result


def test_calendar_url_https_aceita():
    result = _validate({"calendar": {"url": "https://exemplo.com/cal.ics"}})
    assert "error" not in result


def test_calendar_days_fora_do_intervalo():
    assert "error" in _validate({"calendar": {"days": 0}})
    assert "error" in _validate({"calendar": {"days": 31}})


def test_calendar_days_valido():
    result = _validate({"calendar": {"days": 7}})
    assert result.get("calendar", {}).get("days") == 7


def test_news_limit_fora_do_intervalo():
    assert "error" in _validate({"news": {"limit": 0}})
    assert "error" in _validate({"news": {"limit": 51}})


def test_news_limit_valido():
    result = _validate({"news": {"limit": 10}})
    assert result.get("news", {}).get("limit") == 10


def test_payload_nao_dict_rejeitado():
    assert "error" in _validate("string invalida")
    assert "error" in _validate(None)
    assert "error" in _validate([1, 2, 3])


def test_timezone_invalido_rejeitado():
    result = _validate({"system": {"timezone": "Nao/Existe"}})
    assert "error" in result


def test_timezone_valido():
    result = _validate({"system": {"timezone": "America/Sao_Paulo"}})
    assert "error" not in result
