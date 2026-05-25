"""Coletor de clima via Open-Meteo (gratis, sem chave) e fase lunar local."""
import json
import time

try:
    from urllib.request import urlopen, Request
    from urllib.error import URLError
except ImportError:
    from urllib2 import urlopen, Request, URLError

import settings

_TIMEOUT = 8


def _at(arr, i, default=None):
    """Indexacao defensiva: lista vazia ou indice fora -> default."""
    try:
        return arr[i]
    except (IndexError, TypeError):
        return default


def _round_v(v, ndigits=1):
    return None if v is None else round(v, ndigits)


def _round_at(arr, i, ndigits=1):
    return _round_v(_at(arr, i), ndigits)


def _hhmm(iso_dt):
    """'2026-05-23T06:14' -> '06:14'."""
    if not iso_dt or "T" not in iso_dt:
        return None
    return iso_dt.split("T", 1)[1][:5]

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
    city = settings.get("weather", "city", "")
    if not city:
        return {"configured": False}

    lat, lon = _resolve_city(city)

    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
        "is_day,weather_code,wind_speed_10m,wind_direction_10m,precipitation,uv_index"
        "&hourly=temperature_2m,precipitation,precipitation_probability,weather_code"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
        "precipitation_sum,precipitation_probability_max,sunrise,sunset,"
        "uv_index_max,wind_speed_10m_max,wind_direction_10m_dominant"
        "&forecast_days=7&timezone=auto"
    ).format(lat=lat, lon=lon)

    data = _fetch(url)

    # --- Proximas 24h (a partir da hora atual) ---
    cur = data.get("current", {}) or {}
    now_str = cur.get("time", "")
    hourly = data.get("hourly", {}) or {}
    ht = hourly.get("time", []) or []
    try:
        h0 = ht.index(now_str)
    except ValueError:
        h0 = 0
    hourly_out = []
    for i, t in enumerate(ht[h0:h0 + 24]):
        hourly_out.append({
            "time":   t,
            "temp":   _round_at(hourly.get("temperature_2m", []), h0 + i),
            "precip": _round_at(hourly.get("precipitation", []), h0 + i),
            "prob":   _at(hourly.get("precipitation_probability", []), h0 + i),
            "code":   _at(hourly.get("weather_code", []), h0 + i, 0),
        })

    # --- Diaria (hoje + 6 dias seguintes) ---
    daily = data.get("daily", {}) or {}
    dt = daily.get("time", []) or []
    daily_out = []
    for i in range(min(7, len(dt))):
        daily_out.append({
            "date":        dt[i],
            "code":        _at(daily.get("weather_code", []), i, 0),
            "high":        _round_at(daily.get("temperature_2m_max", []), i),
            "low":         _round_at(daily.get("temperature_2m_min", []), i),
            "precip_sum":  _round_at(daily.get("precipitation_sum", []), i),
            "precip_prob": _at(daily.get("precipitation_probability_max", []), i),
            "sunrise":     _hhmm(_at(daily.get("sunrise", []), i)),
            "sunset":      _hhmm(_at(daily.get("sunset", []), i)),
            "uv_max":      _round_at(daily.get("uv_index_max", []), i),
            "wind_max":    _round_at(daily.get("wind_speed_10m_max", []), i),
            "wind_dir":    _at(daily.get("wind_direction_10m_dominant", []), i),
        })

    return {
        "configured": True,
        "city": city,
        "current": {
            "temp":       round(cur.get("temperature_2m", 0), 1),
            "humidity":   cur.get("relative_humidity_2m"),
            "feels_like": _round_v(cur.get("apparent_temperature")),
            "is_day":     cur.get("is_day", 1) == 1,
            "code":       cur.get("weather_code", 0),
            "wind_speed": _round_v(cur.get("wind_speed_10m")),
            "wind_dir":   cur.get("wind_direction_10m"),
            "precip":     _round_v(cur.get("precipitation")),
            "uv":         _round_v(cur.get("uv_index")),
        },
        "hourly": hourly_out,
        "daily":  daily_out,
        "moon":   _moon(),
    }
