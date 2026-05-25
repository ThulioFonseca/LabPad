"""Homelab Monitor — servidor Flask.

Serve o dashboard estatico e a API de metricas. Roda dentro de um container;
ver Dockerfile / docker-compose.yml.
"""
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, jsonify, request, send_from_directory

import config
import settings
from collectors import calendar_feed, containers, host, news, sensors, weather

STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"
)

app = Flask(__name__, static_folder=None)
# app.logger nao tem handlers no modo dev — usa o root logger diretamente.
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    force=True)
# Propaga logs da app para o root logger onde os handlers estao configurados.
app.logger.setLevel(logging.INFO)
app.logger.propagate = True

# Cache curto: varias aberturas/recargas nao recoletam tudo a cada request.
_cache = {"time": 0.0, "data": None}
_cache_lock = threading.Lock()

# Cache longo dos feeds externos (agenda + noticias): mudam pouco e sao lentos.
_feeds_cache = {"time": 0.0, "data": None}
_feeds_lock = threading.Lock()

# Ultimo dado bom por componente de feed — serve dado stale se fetch falhar.
_last_good_feeds = {}


def _safe(collect_fn, fallback):
    """Roda um coletor isolando falhas. Loga o erro para aparecer em docker logs."""
    try:
        return collect_fn()
    except Exception as exc:
        name = getattr(collect_fn, "__module__", None) or getattr(collect_fn, "__name__", "?")
        # Usa logging diretamente (root logger) — garantido no docker logs.
        logging.warning("Coletor [%s] falhou: %s", name, exc)
        result = dict(fallback)
        result["error"] = str(exc)
        return result


def _run_parallel(jobs):
    """jobs: {chave: (collect_fn, fallback)} -> {chave: resultado}.

    Roda os coletores em paralelo (cada um isolado por _safe): o tempo total
    passa a ser o do coletor mais lento, nao a soma de todos.
    """
    results = {}
    with ThreadPoolExecutor(max_workers=len(jobs)) as executor:
        futures = {key: executor.submit(_safe, fn, fallback)
                   for key, (fn, fallback) in jobs.items()}
        for key in jobs:
            results[key] = futures[key].result()
    return results


def _build_metrics():
    data = _run_parallel({
        "host":       (host.collect, {}),
        "sensors":    (sensors.collect, {"cpu_temp": None, "all": []}),
        "containers": (containers.collect, {"list": []}),
    })
    data["meta"] = {"time": time.time(), "refresh_ms": config.REFRESH_MS}
    return data


def _build_feeds():
    # Cada feed chama uma API externa lenta — roda os tres em paralelo para o
    # tempo total ser o do mais lento (agenda), nao a soma.
    raw = _run_parallel({
        "calendar": (calendar_feed.collect, {"events": [], "configured": True}),
        "news":     (news.collect, {"items": [], "configured": True}),
        "weather":  (weather.collect, {"configured": False}),
    })

    result = {}
    for key, data in raw.items():
        if "error" not in data:
            _last_good_feeds[key] = data
            result[key] = data
        elif key in _last_good_feeds:
            logging.warning("Feed [%s] com erro, servindo ultimo dado bom. Erro: %s",
                            key, data.get("error", "?"))
            result[key] = _last_good_feeds[key]
        else:
            logging.warning("Feed [%s] falhou sem dado previo disponivel: %s",
                            key, data.get("error", "?"))
            result[key] = data
    result["meta"] = {"time": time.time()}
    return result


@app.route("/api/metrics")
def metrics():
    with _cache_lock:
        now = time.time()
        if _cache["data"] is not None and (now - _cache["time"]) < config.CACHE_TTL:
            response = jsonify(_cache["data"])
            response.headers["Cache-Control"] = "no-store"
            return response

    data = _build_metrics()

    with _cache_lock:
        _cache["data"] = data
        _cache["time"] = time.time()

    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/feeds")
def feeds():
    with _feeds_lock:
        now = time.time()
        if (_feeds_cache["data"] is not None
                and (now - _feeds_cache["time"]) < config.FEEDS_CACHE_TTL):
            response = jsonify(_feeds_cache["data"])
            response.headers["Cache-Control"] = "no-store"
            return response

    data = _build_feeds()

    with _feeds_lock:
        if (_feeds_cache["data"] is None
                or (time.time() - _feeds_cache["time"]) >= config.FEEDS_CACHE_TTL):
            _feeds_cache["data"] = data
            _feeds_cache["time"] = time.time()
        data = _feeds_cache["data"]

    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/containers/<container_id>/logs")
def container_logs(container_id):
    """Devolve as ultimas N linhas de log de um container Docker."""
    tail = request.args.get("tail", default=200, type=int)
    tail = max(10, min(tail, 1000))
    data = containers.get_logs(container_id, tail=tail)
    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/client-error", methods=["POST"])
def client_error():
    """Recebe erros JavaScript do browser e os loga no docker logs."""
    try:
        body = request.get_json(force=True, silent=True) or {}
        msg = body.get("message", "?")
        src = body.get("source", "?")
        line = body.get("lineno", "?")
        ctx = body.get("context", "")
        logging.error("JS-ERROR [%s:%s] %s%s", src, line, msg,
                      (" | ctx: " + ctx) if ctx else "")
    except Exception:
        pass
    return jsonify({"ok": True})


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "time": time.time()})


def _validate_settings(body):
    """Valida e normaliza o payload do PUT /api/settings.

    Devolve um dict com {secao: {chave: valor}} contendo SOMENTE os campos
    validos do payload. Em caso de erro de validacao, devolve {"error": ...}.
    """
    if not isinstance(body, dict):
        return {"error": "payload invalido"}
    clean = {}

    w = body.get("weather") or {}
    if "city" in w:
        clean.setdefault("weather", {})["city"] = str(w["city"]).strip()[:100]

    c = body.get("calendar") or {}
    if "url" in c:
        u = str(c["url"]).strip()[:500]
        if u and not (u.startswith("http://") or u.startswith("https://")):
            return {"error": "calendar.url precisa comecar com http(s)://"}
        clean.setdefault("calendar", {})["url"] = u
    if "days" in c:
        try:
            d = int(c["days"])
        except (TypeError, ValueError):
            return {"error": "calendar.days deve ser inteiro"}
        if d < 1 or d > 30:
            return {"error": "calendar.days fora do intervalo 1..30"}
        clean.setdefault("calendar", {})["days"] = d

    n = body.get("news") or {}
    if "url" in n:
        u = str(n["url"]).strip()[:500]
        if u and not (u.startswith("http://") or u.startswith("https://")):
            return {"error": "news.url precisa comecar com http(s)://"}
        clean.setdefault("news", {})["url"] = u
    if "limit" in n:
        try:
            lim = int(n["limit"])
        except (TypeError, ValueError):
            return {"error": "news.limit deve ser inteiro"}
        if lim < 1 or lim > 50:
            return {"error": "news.limit fora do intervalo 1..50"}
        clean.setdefault("news", {})["limit"] = lim

    sy = body.get("system") or {}
    if "timezone" in sy:
        tz = str(sy["timezone"]).strip()[:100]
        if tz:
            try:
                from zoneinfo import ZoneInfo
                ZoneInfo(tz)
            except Exception:
                return {"error": "system.timezone invalido (use IANA, ex: America/Sao_Paulo)"}
        clean.setdefault("system", {})["timezone"] = tz

    return clean


def _invalidate_settings_caches(prev, new):
    """Limpa caches afetados quando uma fonte muda (cidade, URL etc.)."""
    if prev["weather"]["city"] != new["weather"]["city"]:
        weather._geo_cache.clear()
        _last_good_feeds.pop("weather", None)
    if prev["calendar"]["url"] != new["calendar"]["url"]:
        _last_good_feeds.pop("calendar", None)
    if prev["news"]["url"] != new["news"]["url"]:
        _last_good_feeds.pop("news", None)
    if prev.get("system", {}).get("timezone") != new.get("system", {}).get("timezone"):
        # Timezone afeta os horarios apresentados pela agenda.
        _last_good_feeds.pop("calendar", None)
    # Forca rebuild no proximo GET /api/feeds.
    with _feeds_lock:
        _feeds_cache["data"] = None
        _feeds_cache["time"] = 0.0


@app.route("/api/settings", methods=["GET"])
def get_settings():
    response = jsonify(settings.get_effective())
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/settings", methods=["PUT"])
def put_settings():
    body = request.get_json(force=True, silent=True)
    cleaned = _validate_settings(body)
    if "error" in cleaned:
        return jsonify(cleaned), 400
    prev, new = settings.update(cleaned)
    _invalidate_settings_caches(prev, new)
    logging.info("Settings atualizadas: %s", list(cleaned.keys()))
    return jsonify(new)


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html", max_age=0)


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path, max_age=0)


if __name__ == "__main__":
    print("Homelab Monitor: http://%s:%s" % (config.HOST_BIND, config.PORT))
    app.run(host=config.HOST_BIND, port=config.PORT, threaded=True)
