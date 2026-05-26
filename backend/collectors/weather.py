"""Coletor de clima via Open-Meteo (primario) com fallback para met.no.

Open-Meteo: gratis, sem chave, 7 dias de previsao.
met.no (Norwegian Meteorological Institute): gratis, sem chave, cobertura global,
  usado automaticamente se Open-Meteo falhar.
Fase lunar calculada localmente (sem API).
"""
import logging
import time
from collections import defaultdict

from collectors.http_log import fetch as _http_fetch
import settings

_TIMEOUT = 8

_METNO_UA = "HomelabMonitor/1.0 thulio50@hotmail.com"

# met.no symbol_code -> WMO weather code (aproximacao)
_METNO_TO_WMO = {
    "clearsky":             0,
    "fair":                 1,
    "partlycloudy":         2,
    "cloudy":               3,
    "fog":                  45,
    "lightrain":            61,
    "rain":                 63,
    "heavyrain":            65,
    "lightrainshowers":     80,
    "rainshowers":          81,
    "heavyrainshowers":     82,
    "lightsleet":           68,
    "sleet":                69,
    "lightsnow":            71,
    "snow":                 73,
    "heavysnow":            75,
    "lightsnowshowers":     85,
    "snowshowers":          86,
    "lightrainandthunder":  95,
    "rainandthunder":       96,
    "heavyrainandthunder":  99,
    "snowandthunder":       99,
}


def _metno_wmo(symbol_code):
    """'lightrainshowers_day' -> WMO int. Desconhecido -> 3 (nublado)."""
    base = (symbol_code or "").split("_")[0]
    return _METNO_TO_WMO.get(base, 3)


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
    return _http_fetch(url, headers={"User-Agent": "Homelab-Monitor/1.0"}, timeout=_TIMEOUT).json()


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


def _fetch_openmeteo(lat, lon):
    """Busca clima no Open-Meteo. Retorna dict estruturado."""
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
        "city": settings.get("weather", "city", ""),
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


def _fetch_metno(lat, lon):
    """Fallback: Norwegian Meteorological Institute (met.no). Sem chave de API."""
    url = (
        "https://api.met.no/weatherapi/locationforecast/2.0/compact"
        "?lat={lat:.4f}&lon={lon:.4f}"
    ).format(lat=lat, lon=lon)

    data = _http_fetch(url, headers={"User-Agent": _METNO_UA}, timeout=_TIMEOUT).json()
    ts = data["properties"]["timeseries"]

    # --- current: primeira entrada ---
    first = ts[0]
    inst  = first["data"]["instant"]["details"]
    nxt1  = first["data"].get("next_1_hours") or {}
    sym   = (nxt1.get("summary") or {}).get("symbol_code", "")
    nxt1d = nxt1.get("details") or {}

    current = {
        "temp":       _round_v(inst.get("air_temperature")),
        "humidity":   inst.get("relative_humidity"),
        "feels_like": None,
        "is_day":     "_day" in sym if sym else True,
        "code":       _metno_wmo(sym),
        "wind_speed": _round_v(inst.get("wind_speed")),
        "wind_dir":   inst.get("wind_from_direction"),
        "precip":     _round_v(nxt1d.get("precipitation_amount")),
        "uv":         _round_v(inst.get("ultraviolet_index_clear_sky")),
    }

    # --- hourly: proximas 24 entradas com next_1_hours ---
    hourly_out = []
    for entry in ts[:48]:
        if len(hourly_out) >= 24:
            break
        h1 = entry["data"].get("next_1_hours")
        if h1 is None:
            continue
        hi    = entry["data"]["instant"]["details"]
        h1d   = h1.get("details") or {}
        sym_h = (h1.get("summary") or {}).get("symbol_code", "")
        hourly_out.append({
            "time":   entry["time"],
            "temp":   _round_v(hi.get("air_temperature")),
            "precip": _round_v(h1d.get("precipitation_amount")),
            "prob":   h1d.get("probability_of_precipitation"),
            "code":   _metno_wmo(sym_h),
        })

    # --- daily: agregar por dia (max/min temp, precip acumulada, symbol) ---
    day_buckets = defaultdict(lambda: {
        "temps": [], "precip": 0.0, "prob": 0, "sym": None
    })
    for entry in ts:
        day = entry["time"][:10]
        hi  = entry["data"]["instant"]["details"]
        t   = hi.get("air_temperature")
        if t is not None:
            day_buckets[day]["temps"].append(t)
        n6  = entry["data"].get("next_6_hours") or {}
        n6d = n6.get("details") or {}
        day_buckets[day]["precip"] += n6d.get("precipitation_amount", 0.0)
        p = n6d.get("probability_of_precipitation")
        if p is not None:
            day_buckets[day]["prob"] = max(day_buckets[day]["prob"], p)
        if day_buckets[day]["sym"] is None:
            sym_6 = (n6.get("summary") or {}).get("symbol_code")
            if sym_6:
                day_buckets[day]["sym"] = sym_6

    daily_out = []
    for day in sorted(day_buckets)[:7]:
        b = day_buckets[day]
        temps = b["temps"]
        daily_out.append({
            "date":        day,
            "code":        _metno_wmo(b["sym"]) if b["sym"] else 3,
            "high":        _round_v(max(temps)) if temps else None,
            "low":         _round_v(min(temps)) if temps else None,
            "precip_sum":  _round_v(b["precip"]),
            "precip_prob": b["prob"] or None,
            "sunrise":     None,
            "sunset":      None,
            "uv_max":      None,
            "wind_max":    None,
            "wind_dir":    None,
        })

    return {
        "configured": True,
        "city":    settings.get("weather", "city", ""),
        "current": current,
        "hourly":  hourly_out,
        "daily":   daily_out,
        "moon":    _moon(),
        "_source": "met.no",
    }


def collect():
    city = settings.get("weather", "city", "")
    if not city:
        return {"configured": False}

    lat, lon = _resolve_city(city)

    try:
        return _fetch_openmeteo(lat, lon)
    except Exception as exc:
        logging.warning("Open-Meteo falhou (%s), tentando met.no como fallback", exc)
        return _fetch_metno(lat, lon)
