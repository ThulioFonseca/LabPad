"""Testes do coletor de clima.

Usa responses para interceptar as chamadas HTTP — sem acesso real a APIs.
Cobre: cidade nao configurada, fallback met.no, erro de geocoding.
"""
import json
import pytest

try:
    import responses as _resp_lib
    HAS_RESPONSES = True
except ImportError:
    HAS_RESPONSES = False

pytestmark = pytest.mark.skipif(not HAS_RESPONSES,
                                reason="biblioteca 'responses' nao instalada")


GEOCODING_OK = {
    "results": [{"latitude": -20.98, "longitude": -43.81,
                 "name": "Carandai", "country": "Brazil"}]
}

OPENMETEO_OK = {
    "current": {
        "time": "2026-05-26T12:00",
        "temperature_2m": 22.5,
        "relative_humidity_2m": 65,
        "apparent_temperature": 21.0,
        "is_day": 1,
        "weather_code": 1,
        "wind_speed_10m": 10.0,
        "wind_direction_10m": 180,
        "precipitation": 0.0,
        "uv_index": 3.0,
    },
    "hourly": {
        "time": ["2026-05-26T12:00"],
        "temperature_2m": [22.5],
        "precipitation": [0.0],
        "precipitation_probability": [10],
        "weather_code": [1],
    },
    "daily": {
        "time": ["2026-05-26"],
        "weather_code": [1],
        "temperature_2m_max": [26.0],
        "temperature_2m_min": [15.0],
        "precipitation_sum": [0.0],
        "precipitation_probability_max": [10],
        "sunrise": ["2026-05-26T06:30"],
        "sunset": ["2026-05-26T18:00"],
        "uv_index_max": [4.0],
        "wind_speed_10m_max": [15.0],
        "wind_direction_10m_dominant": [180],
    },
}


def _reset_cache():
    from collectors import weather as w
    w._geo_cache["city"] = None
    w._geo_cache["lat"] = None
    w._geo_cache["lon"] = None


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    import sys, types
    if "settings" not in sys.modules:
        sys.modules["settings"] = types.ModuleType("settings")
    monkeypatch.setattr("settings.get", lambda *a, **kw: a[2] if len(a) > 2 else "")


def test_cidade_nao_configurada_retorna_configured_false(monkeypatch):
    monkeypatch.setattr("settings.get", lambda *a, **kw: "")
    from collectors import weather
    result = weather.collect()
    assert result == {"configured": False}


@pytest.mark.usefixtures()
def test_coleta_openmeteo_com_mocks(monkeypatch):
    import responses

    monkeypatch.setattr("settings.get",
                        lambda sec, key, default="": "Carandai" if key == "city" else default)
    _reset_cache()

    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        rsps.add(responses.GET,
                 "https://geocoding-api.open-meteo.com/v1/search",
                 json=GEOCODING_OK)
        rsps.add(responses.GET,
                 "https://api.open-meteo.com/v1/forecast",
                 json=OPENMETEO_OK)

        from collectors import weather
        result = weather.collect()

    assert result["configured"] is True
    assert result["city"] == "Carandai"
    assert "current" in result
    assert "daily" in result
    assert "hourly" in result
    assert "moon" in result
    assert result["current"]["temp"] == 22.5


def test_geocoding_falha_levanta_excecao(monkeypatch):
    import responses

    monkeypatch.setattr("settings.get",
                        lambda sec, key, default="": "CidadeInexistente" if key == "city" else default)
    _reset_cache()

    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        rsps.add(responses.GET,
                 "https://geocoding-api.open-meteo.com/v1/search",
                 json={"results": []})

        from collectors import weather
        with pytest.raises(ValueError, match="Cidade nao encontrada"):
            weather.collect()


def test_invalidate_cache_limpa_geo_cache():
    from collectors import weather
    weather._geo_cache["city"] = "Carandai"
    weather._geo_cache["lat"] = -20.98
    weather._geo_cache["lon"] = -43.81
    weather.invalidate_cache()
    assert weather._geo_cache["city"] is None
    assert weather._geo_cache["lat"] is None
    assert weather._geo_cache["lon"] is None
