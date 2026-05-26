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
import notifications
import settings
from collectors import article, calendar_feed, containers, host, news, sensors, weather

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

# Cache de feeds externos (agenda + noticias + clima). Mantido por um thread
# scheduler que roda independentemente de requests, com backoff por feed em
# caso de falha — garante "tenta de novo ate voltar" mesmo sem ninguem polando.
_feeds_lock = threading.Lock()

# Ultimo dado bom por feed — servido enquanto a fonte estiver indisponivel.
_last_good_feeds = {}

# Jobs do scheduler. Cada feed roda independente dos outros, com seu proprio
# ciclo de retry. Fallback e o dict devolvido por _safe() quando o coletor
# levanta exception (alem do "error" adicionado).
_FEED_JOBS = {
    "calendar": (calendar_feed.collect, {"events": [], "configured": True}),
    "news":     (news.collect,          {"items": [],  "configured": True}),
    "weather":  (weather.collect,       {"configured": False}),
}

# Estado por feed: epoch do proximo run, contador de falhas consecutivas e
# ultimo resultado bruto (mesmo com erro, para diagnostico via /api/feeds).
_feeds_next_run = {k: 0.0 for k in _FEED_JOBS}
_feeds_failures = {k: 0   for k in _FEED_JOBS}
_feeds_last     = {k: None for k in _FEED_JOBS}

# Sinaliza o scheduler para acordar imediatamente (settings change etc.).
_scheduler_wakeup = threading.Event()


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


def _scheduler_loop():
    """Mantem o cache de feeds quente em background.

    Cada feed e re-coletado quando vence seu proximo_run. Sucesso volta o
    intervalo para FEEDS_CACHE_TTL. Falha aplica backoff exponencial limitado:
    60s, 120s, 240s, ..., teto FEEDS_RETRY_MAX_S. Como a thread e daemon, ela
    morre junto com o processo — nao precisa de mecanismo de stop explicito.
    """
    while True:
        now = time.time()
        due = [k for k, t in _feeds_next_run.items() if t <= now]
        for key in due:
            fn, fallback = _FEED_JOBS[key]
            data = _safe(fn, fallback)
            with _feeds_lock:
                prev_failures = _feeds_failures[key]
                _feeds_last[key] = data
                if "error" not in data:
                    _last_good_feeds[key] = data
                    _feeds_failures[key] = 0
                    delay = config.FEEDS_CACHE_TTL
                    # Recuperacao apos pelo menos uma falha → notifica.
                    if prev_failures > 0:
                        notifications.add(
                            "info", key,
                            "Feed [%s] recuperado" % key,
                            "Coleta voltou ao normal apos %d falha(s) consecutiva(s)."
                            % prev_failures)
                    # Clima servido pelo fallback met.no → degradacao (warning).
                    elif key == "weather" and data.get("_source") == "met.no":
                        notifications.add(
                            "warning", "weather",
                            "Clima em modo degradado (met.no)",
                            "Open-Meteo indisponivel; usando met.no como fonte secundaria.")
                else:
                    _feeds_failures[key] += 1
                    delay = min(
                        config.FEEDS_RETRY_MIN_S * (2 ** (_feeds_failures[key] - 1)),
                        config.FEEDS_RETRY_MAX_S,
                    )
                    logging.info("Feed [%s] retry #%d agendado em %.0fs",
                                 key, _feeds_failures[key], delay)
                    # So notifica na PRIMEIRA falha da serie — backoff cuida
                    # do resto sem encher a fila.
                    if prev_failures == 0:
                        notifications.add(
                            "error", key,
                            "Falha na integracao: %s" % key,
                            data.get("error", "?"))
                _feeds_next_run[key] = time.time() + delay
        # Acorda no proximo vencimento (ou imediatamente via _scheduler_wakeup).
        sleep_s = max(1.0, min(_feeds_next_run.values()) - time.time())
        _scheduler_wakeup.wait(timeout=sleep_s)
        _scheduler_wakeup.clear()


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
    # Apenas le o cache mantido pelo scheduler. Para cada feed prefere o
    # ultimo dado bom; se nunca houve sucesso, serve o ultimo resultado bruto
    # (com "error") — assim o frontend sabe distinguir cold-fail de stale.
    with _feeds_lock:
        result = {}
        for key in _FEED_JOBS:
            good = _last_good_feeds.get(key)
            if good is not None:
                result[key] = good
            elif _feeds_last.get(key) is not None:
                result[key] = _feeds_last[key]
            else:
                result[key] = dict(_FEED_JOBS[key][1])
        result["meta"] = {"time": time.time()}

    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/article")
def article_route():
    """Modo leitura: baixa a URL e devolve o conteudo principal limpo."""
    url = (request.args.get("url") or "").strip()
    if not url or len(url) > 1000:
        return jsonify({"error": "url invalida"}), 400
    if not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({"error": "url precisa comecar com http(s)://"}), 400
    data = article.get(url)
    status = 502 if "error" in data else 200
    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response, status


@app.route("/api/containers/<container_id>/logs")
def container_logs(container_id):
    """Devolve as ultimas N linhas de log de um container Docker."""
    tail = request.args.get("tail", default=200, type=int)
    tail = max(10, min(tail, 1000))
    data = containers.get_logs(container_id, tail=tail)
    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/notifications")
def get_notifications():
    """Lista de notificacoes nao lidas (mais recentes primeiro)."""
    items = notifications.list_unread()
    response = jsonify({"items": items, "unread_count": len(items)})
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/notifications/<int:nid>/read", methods=["POST"])
def read_notification(nid):
    """Marca uma notificacao como lida (remove da sidebar)."""
    if not notifications.mark_read(nid):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "unread_count": notifications.unread_count()})


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
    """Limpa caches afetados quando uma fonte muda (cidade, URL etc.) e
    agenda re-coleta imediata do(s) feed(s) afetado(s)."""
    affected = set()
    if prev["weather"]["city"] != new["weather"]["city"]:
        weather._geo_cache.clear()
        affected.add("weather")
    if prev["calendar"]["url"] != new["calendar"]["url"]:
        affected.add("calendar")
    if prev["news"]["url"] != new["news"]["url"]:
        affected.add("news")
    if prev.get("system", {}).get("timezone") != new.get("system", {}).get("timezone"):
        # Timezone afeta os horarios apresentados pela agenda.
        affected.add("calendar")

    if not affected:
        return
    with _feeds_lock:
        for key in affected:
            _last_good_feeds.pop(key, None)
            _feeds_last[key] = None
            _feeds_failures[key] = 0
            _feeds_next_run[key] = 0.0
    # Acorda o scheduler para coletar agora, sem esperar o proximo tick.
    _scheduler_wakeup.set()


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


# Scheduler de feeds: roda em background, independente de requests. Iniciado
# ao importar o modulo, vale tanto para `python app.py` quanto para gunicorn
# (cada worker tera seu proprio scheduler; aceitavel — sao requests externos
# leves e os caches sao por processo de qualquer forma).
threading.Thread(target=_scheduler_loop, daemon=True, name="feeds-scheduler").start()


if __name__ == "__main__":
    print("Homelab Monitor: http://%s:%s" % (config.HOST_BIND, config.PORT))
    app.run(host=config.HOST_BIND, port=config.PORT, threaded=True)
