"""LabPad — Flask server.

Serves the static dashboard and metrics API. Runs inside a container;
see Dockerfile / docker-compose.yml.
"""
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, jsonify, request, send_from_directory

import config
import net_guard
import notifications
import settings
from collectors import (article, calendar_feed, containers, host, image_proxy,
                        news, sensors, weather)

STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"
)

app = Flask(__name__, static_folder=None)
# app.logger has no handlers in dev mode — use root logger directly.
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    force=True)
# Propagate app logs to root logger where handlers are configured.
app.logger.setLevel(logging.INFO)
app.logger.propagate = True

# Short cache: repeated reloads don't re-fetch everything on each request.
_cache = {"time": 0.0, "data": None}
_cache_lock = threading.Lock()

# Cache of external feeds (calendar + news + weather). Maintained by a background
# scheduler thread that runs independently of requests, with per-feed backoff on
# failure — ensures "keep trying until recovered" even without client polling.
_feeds_lock = threading.Lock()

# Last good data per feed — served while the source is unavailable.
_last_good_feeds = {}

# Scheduler jobs. Each feed runs independently with its own retry cycle.
# Fallback is the dict returned by _safe() when the collector raises an exception
# (plus the "error" key added by _safe).
_FEED_JOBS = {
    "calendar": (calendar_feed.collect, {"events": [], "configured": True}),
    "news":     (news.collect,          {"items": [],  "configured": True}),
    "weather":  (weather.collect,       {"configured": False}),
}

# State per feed: epoch of next run, consecutive failure count, and last raw
# result (even if errored, for diagnostics via /api/feeds).
_feeds_next_run = {k: 0.0 for k in _FEED_JOBS}
_feeds_failures = {k: 0   for k in _FEED_JOBS}
_feeds_last     = {k: None for k in _FEED_JOBS}
# Epoch of the last SUCCESSFUL collection per feed — so /api/feeds can report how
# old the cached (last-good) data is when the source is currently failing. None
# until the first success.
_last_good_time = {k: None for k in _FEED_JOBS}

# Signal the scheduler to wake immediately (e.g., on settings change).
_scheduler_wakeup = threading.Event()


def _safe(collect_fn, fallback):
    """Run a collector in isolation, catching and logging failures."""
    try:
        return collect_fn()
    except Exception as exc:
        name = getattr(collect_fn, "__module__", None) or getattr(collect_fn, "__name__", "?")
        # Use logging directly (root logger) — guaranteed in docker logs.
        logging.warning("Collector [%s] failed: %s", name, exc)
        result = dict(fallback)
        result["error"] = str(exc)
        return result


def _run_parallel(jobs):
    """jobs: {key: (collect_fn, fallback)} -> {key: result}.

    Run collectors in parallel (each isolated by _safe): total time is the
    slowest collector, not the sum of all.
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
    """Keep the feeds cache warm in the background.

    Each feed is re-collected when its next_run epoch expires. Success resets
    the interval to FEEDS_CACHE_TTL. Failure applies exponential backoff with
    a cap: 60s, 120s, 240s, ..., max FEEDS_RETRY_MAX_S. Since this is a daemon
    thread, it dies with the process — no explicit stop mechanism needed.
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
                    _last_good_time[key] = time.time()
                    _feeds_failures[key] = 0
                    delay = config.FEEDS_CACHE_TTL
                    # Recovery after at least one failure → notify.
                    if prev_failures > 0:
                        notifications.add(
                            "info", key,
                            "Feed [%s] recovered" % key,
                            "Collection returned to normal after %d consecutive failure(s)."
                            % prev_failures)
                    # Weather served by met.no fallback → degraded mode (warning).
                    elif key == "weather" and data.get("_source") == "met.no":
                        notifications.add(
                            "warning", "weather",
                            "Weather in degraded mode (met.no)",
                            "Open-Meteo unavailable; using met.no as fallback source.")
                else:
                    _feeds_failures[key] += 1
                    delay = min(
                        config.FEEDS_RETRY_MIN_S * (2 ** (_feeds_failures[key] - 1)),
                        config.FEEDS_RETRY_MAX_S,
                    )
                    logging.info("[%s] retry #%d: waiting %.0fs",
                                 key, _feeds_failures[key], delay)
                    # Only notify on the FIRST failure in a series — backoff
                    # handles the rest without cluttering the queue.
                    if prev_failures == 0:
                        notifications.add(
                            "error", key,
                            "Integration failure: %s" % key,
                            data.get("error", "?"))
                _feeds_next_run[key] = time.time() + delay
        # Sleep until next expiration (or wake immediately via _scheduler_wakeup).
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
    # Only read the scheduler's cache. For each feed, prefer the last good
    # result; if never successful, serve the last raw result (with "error") —
    # so the frontend can distinguish cold-fail from stale.
    with _feeds_lock:
        now = time.time()
        result = {}
        # Per-feed staleness so the frontend can flag a panel that is showing
        # CACHED (last-good) data because its source is currently failing — on an
        # always-on wall display, days-old calendar/news would otherwise read as
        # live. `stale` is True only when we serve real last-good data AND the
        # most recent collection attempt failed (failures reset to 0 on success);
        # a cold, never-successful feed is NOT "stale" — the frontend already
        # shows it as "Could not read...". `age_s` is how old that cached data is.
        stale = {}
        for key in _FEED_JOBS:
            good = _last_good_feeds.get(key)
            serving_cached = good is not None
            if serving_cached:
                result[key] = good
            elif _feeds_last.get(key) is not None:
                result[key] = _feeds_last[key]
            else:
                result[key] = dict(_FEED_JOBS[key][1])
            failing = _feeds_failures[key] > 0
            lg_time = _last_good_time.get(key)
            stale[key] = {
                "stale": bool(failing and serving_cached),
                "failures": _feeds_failures[key],
                "age_s": (now - lg_time) if lg_time is not None else None,
            }
        result["meta"] = {"time": now, "stale": stale}

    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/article")
def article_route():
    """Reader mode: fetch URL and return cleaned main content."""
    url = (request.args.get("url") or "").strip()
    if not url or len(url) > 1000:
        return jsonify({"error": "invalid url"}), 400
    if not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({"error": "url must start with http(s)://"}), 400
    if net_guard.is_private_url(url):
        return jsonify({"error": "url not allowed"}), 400
    data = article.get(url)
    status = 502 if "error" in data else 200
    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response, status


@app.route("/api/image")
def image_route():
    """Serve a feed image downscaled to the box it is actually drawn in.

    Safari 9 on the iPad 2 decodes a CSS background at the SOURCE resolution,
    so a 7000px-wide press photo behind a 52px thumbnail costs ~127 MB of RAM.
    Ten of them killed the tab within seconds. Never point the frontend at a
    publisher's original image.
    """
    url = (request.args.get("url") or "").strip()
    width = request.args.get("w", default=104, type=int)

    result = image_proxy.get(url, width)
    if "error" in result:
        return jsonify({"error": result["error"]}), result.get("status", 502)

    response = app.response_class(result["data"],
                                  mimetype=result["content_type"])
    # The proxied bytes are derived from an immutable source URL, so the iPad
    # may keep them: every avoided refetch is a decode it does not redo.
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


_CONTAINER_ID_RE = re.compile(r'^[a-zA-Z0-9_.\-]{1,64}$')


@app.route("/api/containers/<container_id>/logs")
def container_logs(container_id):
    """Return the last N lines of logs from a Docker container."""
    if not _CONTAINER_ID_RE.match(container_id):
        return jsonify({"error": "invalid container_id"}), 400
    tail = request.args.get("tail", default=200, type=int)
    tail = max(10, min(tail, 1000))
    data = containers.get_logs(container_id, tail=tail)
    response = jsonify(data)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/notifications")
def get_notifications():
    """List of unread notifications (most recent first)."""
    items = notifications.list_unread()
    response = jsonify({"items": items, "unread_count": len(items)})
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/notifications/<int:nid>/read", methods=["POST"])
def read_notification(nid):
    """Mark a notification as read (remove from sidebar)."""
    if not notifications.mark_read(nid):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "unread_count": notifications.unread_count()})


@app.route("/api/notifications/read-all", methods=["POST"])
def read_all_notifications():
    """Mark every unread notification as read (clear the sidebar)."""
    cleared = notifications.mark_all_read()
    return jsonify({"ok": True, "cleared": cleared,
                    "unread_count": notifications.unread_count()})


@app.route("/api/client-error", methods=["POST"])
def client_error():
    """Receive JavaScript errors from the browser and log them to docker logs."""
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
    """Validate and normalize the PUT /api/settings payload.

    Returns a dict with {section: {key: value}} containing ONLY valid fields
    from the payload. On validation error, returns {"error": ...}.
    """
    if not isinstance(body, dict):
        return {"error": "invalid payload"}
    clean = {}

    w = body.get("weather") or {}
    if "city" in w:
        clean.setdefault("weather", {})["city"] = str(w["city"]).strip()[:100]

    c = body.get("calendar") or {}
    if "url" in c:
        u = str(c["url"]).strip()[:500]
        if u and not (u.startswith("http://") or u.startswith("https://")):
            return {"error": "calendar.url must start with http(s)://"}
        clean.setdefault("calendar", {})["url"] = u
    if "days" in c:
        try:
            d = int(c["days"])
        except (TypeError, ValueError):
            return {"error": "calendar.days must be an integer"}
        if d < 1 or d > 30:
            return {"error": "calendar.days out of range 1..30"}
        clean.setdefault("calendar", {})["days"] = d

    n = body.get("news") or {}
    if "url" in n:
        u = str(n["url"]).strip()[:500]
        if u and not (u.startswith("http://") or u.startswith("https://")):
            return {"error": "news.url must start with http(s)://"}
        clean.setdefault("news", {})["url"] = u
    if "limit" in n:
        try:
            lim = int(n["limit"])
        except (TypeError, ValueError):
            return {"error": "news.limit must be an integer"}
        if lim < 1 or lim > 50:
            return {"error": "news.limit out of range 1..50"}
        clean.setdefault("news", {})["limit"] = lim

    sy = body.get("system") or {}
    if "timezone" in sy:
        tz = str(sy["timezone"]).strip()[:100]
        if tz:
            try:
                from zoneinfo import ZoneInfo
                ZoneInfo(tz)
            except Exception:
                return {"error": "invalid system.timezone (use IANA, e.g. America/New_York)"}
        clean.setdefault("system", {})["timezone"] = tz

    return clean


def _invalidate_settings_caches(prev, new):
    """Clear caches affected when a source changes (city, URL, etc.) and
    schedule immediate re-collection of affected feed(s)."""
    affected = set()
    if prev["weather"]["city"] != new["weather"]["city"]:
        weather.invalidate_cache()
        affected.add("weather")
    if prev["calendar"]["url"] != new["calendar"]["url"]:
        affected.add("calendar")
    if prev["news"]["url"] != new["news"]["url"]:
        affected.add("news")
    if prev.get("system", {}).get("timezone") != new.get("system", {}).get("timezone"):
        # Timezone affects the times displayed by calendar.
        affected.add("calendar")

    if not affected:
        return
    with _feeds_lock:
        for key in affected:
            _last_good_feeds.pop(key, None)
            _feeds_last[key] = None
            _feeds_failures[key] = 0
            _feeds_next_run[key] = 0.0
    # Wake scheduler to collect now, without waiting for next tick.
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
    logging.info("Settings updated: %s", list(cleaned.keys()))
    return jsonify(new)


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html", max_age=0)


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path, max_age=0)


# Feeds scheduler: runs in background, independent of requests. Started on module
# import, works for both `python app.py` and gunicorn (each worker gets its own
# scheduler; acceptable — external requests are light and caches are per-process).
threading.Thread(target=_scheduler_loop, daemon=True, name="feeds-scheduler").start()


if __name__ == "__main__":
    print("LabPad: http://%s:%s" % (config.HOST_BIND, config.PORT))
    app.run(host=config.HOST_BIND, port=config.PORT, threaded=True)
