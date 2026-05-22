"""Homelab Monitor — servidor Flask.

Serve o dashboard estatico e a API de metricas. Roda dentro de um container;
ver Dockerfile / docker-compose.yml.
"""
import os
import threading
import time

from flask import Flask, jsonify, send_from_directory

import config
from collectors import calendar_feed, containers, host, news, sensors, weather

STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"
)

app = Flask(__name__, static_folder=None)

# Cache curto: varias aberturas/recargas nao recoletam tudo a cada request.
_cache = {"time": 0.0, "data": None}
_cache_lock = threading.Lock()

# Cache longo dos feeds externos (agenda + noticias): mudam pouco e sao lentos.
_feeds_cache = {"time": 0.0, "data": None}
_feeds_lock = threading.Lock()


def _safe(collect_fn, fallback):
    """Roda um coletor isolando falhas — um erro nunca derruba o JSON inteiro."""
    try:
        return collect_fn()
    except Exception as exc:  # resiliencia proposital
        result = dict(fallback)
        result["error"] = str(exc)
        return result


def _build_metrics():
    return {
        "host": _safe(host.collect, {}),
        "sensors": _safe(sensors.collect, {"cpu_temp": None, "all": []}),
        "containers": _safe(containers.collect, {"list": []}),
        "meta": {"time": time.time(), "refresh_ms": config.REFRESH_MS},
    }


def _build_feeds():
    # fallback configured=True -> uma falha de rede aparece como "erro ao ler",
    # nao como "nao configurado" (esse so quando a URL esta vazia).
    return {
        "calendar": _safe(calendar_feed.collect, {"events": [], "configured": True}),
        "news": _safe(news.collect, {"items": [], "configured": True}),
        "weather": _safe(weather.collect, {"configured": False}),
        "meta": {"time": time.time()},
    }


@app.route("/api/metrics")
def metrics():
    # Lê o cache sem bloquear a coleta: verifica se está fresco sob o lock,
    # coleta FORA do lock (operação lenta), e só então atualiza sob o lock.
    # Isso evita que uma coleta lenta (Docker socket, psutil) bloqueie todas
    # as requisições subsequentes pelo tempo do timeout do SDK (60 s padrão).
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
        fresh = (
            _feeds_cache["data"] is not None
            and (now - _feeds_cache["time"]) < config.FEEDS_CACHE_TTL
        )
        if not fresh:
            _feeds_cache["data"] = _build_feeds()
            _feeds_cache["time"] = now
        response = jsonify(_feeds_cache["data"])
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "time": time.time()})


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html", max_age=0)


@app.route("/<path:path>")
def static_files(path):
    # max_age=0: editar config.js / theme.css e recarregar mostra a mudanca.
    return send_from_directory(STATIC_DIR, path, max_age=0)


if __name__ == "__main__":
    print("Homelab Monitor: http://%s:%s" % (config.HOST_BIND, config.PORT))
    app.run(host=config.HOST_BIND, port=config.PORT, threaded=True)
