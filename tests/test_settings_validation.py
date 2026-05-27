"""Tests for PUT /api/settings validation.

Validates _validate_settings() from app.py in isolation — without starting the
Flask server. Covers accepted fields and rejection rules.
"""
import sys
import os
import types

# Stub modules that app.py imports but are not needed for this test.
for _mod in ("notifications", "settings", "config",
             "collectors.article", "collectors.calendar_feed",
             "collectors.containers", "collectors.host",
             "collectors.news", "collectors.sensors", "collectors.weather"):
    if _mod not in sys.modules:
        sys.modules[_mod] = types.ModuleType(_mod)

# app.py accesses these at module level when building _FEED_JOBS dict.
# Stubs must expose a callable `collect` before exec_module runs.
for _coll in ("collectors.calendar_feed", "collectors.news", "collectors.weather"):
    if not hasattr(sys.modules[_coll], "collect"):
        sys.modules[_coll].collect = lambda: {}

import importlib
import flask

# Load only the validation function without starting the server.
_app_path = os.path.join(os.path.dirname(__file__), "..", "backend", "app.py")
_spec = importlib.util.spec_from_file_location("app", _app_path)
_app_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_app_mod)
_validate = _app_mod._validate_settings


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
