"""Coletor de clima via Open-Meteo (gratis, sem chave) e fase lunar local."""
import json
import time

try:
    from urllib.request import urlopen, Request
    from urllib.error import URLError
except ImportError:
    from urllib2 import urlopen, Request, URLError

import config

_TIMEOUT = 8

# Coordenadas resolvidas em cache — so chama geocoding uma vez por processo.
_geo_cache = {"city": None, "lat": None, "lon": None}

# Timestamp Unix do lua nova de referencia (6 Jan 2000 18:14 UTC)
_KNOWN_NEW_MOON = 947182440.0
_LUNAR_CYCLE = 29.53059  # dias


def _moon():
    days = (time.time() - _KNOWN_NEW_MOON) / 86400.0
    fraction = (days % _LUNAR_CYCLE) / _LUNAR_CYCLE  # 0..1
    phase_idx = int(fraction * 8 + 0.5) % 8
    names = [
        'Lua Nova', 'Crescente', 'Quarto Crescente', 'Gibosa Crescente',
        'Lua Cheia', 'Gibosa Minguante', 'Quarto Minguante', 'Minguante',
    ]
    return {"fraction": round(fraction, 3), "name": names[phase_idx], "phase_index": phase_idx}


def _fetch(url):
    req = Request(url, headers={"User-Agent": "Homelab-Monitor/1.0"})
    with urlopen(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _resolve_city(city):
    """Converte nome de cidade em lat/lon via Open-Meteo Geocoding API."""
    if _geo_cache["city"] == city and _geo_cache["lat"] is not None:
        return _geo_cache["lat"], _geo_cache["lon"]

    try:
        from urllib.parse import quote
    except ImportError:
        from urllib import quote

    url = (
        "https://geocoding-api.open-meteo.com/v1/search"
        "?name={name}&count=1&language=pt&format=json"
    ).format(name=quote(city))

    data = _fetch(url)
    results = data.get("results")
    if not results:
        raise ValueError("Cidade nao encontrada: " + city)

    lat = results[0]["latitude"]
    lon = results[0]["longitude"]
    _geo_cache["city"] = city
    _geo_cache["lat"] = lat
    _geo_cache["lon"] = lon
    return lat, lon


def collect():
    city = config.WEATHER_CITY
    if not city:
        return {"configured": False}

    lat, lon = _resolve_city(city)

    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,weather_code"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min"
        "&timezone=auto&forecast_days=6"
    ).format(lat=lat, lon=lon)

    data = _fetch(url)

    cur = data.get("current", {})
    daily = data.get("daily", {})
    times = daily.get("time", [])
    codes = daily.get("weather_code", [])
    highs = daily.get("temperature_2m_max", [])
    lows = daily.get("temperature_2m_min", [])

    # Pula o dia 0 (hoje em daily) e usa os proximos 5 dias
    forecast = []
    for i in range(1, min(6, len(times))):
        forecast.append({
            "date": times[i],
            "code": codes[i] if i < len(codes) else 0,
            "high": round(highs[i], 1) if i < len(highs) else None,
            "low": round(lows[i], 1) if i < len(lows) else None,
        })

    return {
        "configured": True,
        "city": city,
        "current": {
            "temp": round(cur.get("temperature_2m", 0), 1),
            "humidity": cur.get("relative_humidity_2m"),
            "code": cur.get("weather_code", 0),
        },
        "forecast": forecast,
        "moon": _moon(),
    }
