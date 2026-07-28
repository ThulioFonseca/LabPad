"""Collector for Docker container metrics (via read-only mounted socket)."""
import json
import re
from concurrent.futures import ThreadPoolExecutor

import docker


_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')

# Docker embeds the last exit code in the human status string it returns on the
# container LIST endpoint (e.g. "Exited (137) 5 minutes ago", "Restarting (1) 3
# seconds ago"). Parsing it here means we never pay for an extra per-container
# inspect() call just to learn whether a stopped container crashed.
_EXIT_RE = re.compile(r'(?:Exited|Restarting|Dead)\s*\((\d+)\)')

_client = None
_runtime_cache = {}


def _exit_code_from_status(status_msg):
    """Exit code Docker embeds in the human status string, or None if absent.

    'Exited (137) 5 minutes ago' -> 137,  'Up 2 hours' -> None.
    """
    if not status_msg:
        return None
    m = _EXIT_RE.search(status_msg)
    return int(m.group(1)) if m else None


def _health_from_status(status_msg):
    """Healthcheck verdict Docker embeds in the status string, or None.

    'Up 2 hours (healthy)' -> 'healthy',  'Up 5s (health: starting)' -> 'starting'.
    Only present when the image defines a HEALTHCHECK.
    """
    if not status_msg:
        return None
    s = status_msg.lower()
    if '(unhealthy)' in s:
        return 'unhealthy'
    if 'health: starting' in s:
        return 'starting'
    if '(healthy)' in s:
        return 'healthy'
    return None


def _is_failed(status, exit_code, health):
    """True when a container is in a genuine failure state — NOT merely stopped.

    A homelab operator wants the wall display to shout about crashes, crash
    loops, and failing healthchecks; it must stay quiet about containers that
    were stopped on purpose. So a clean exit (code 0), 'created', and 'paused'
    are deliberately NOT failures; 'dead'/'restarting', a non-zero exit, and an
    'unhealthy' healthcheck are.
    """
    if health == 'unhealthy':
        return True
    if status in ('dead', 'restarting'):
        return True
    if status == 'exited' and exit_code not in (None, 0):
        return True
    return False


def _sort_key(item):
    """Ordering for the container list shown in the modal.

    Genuine failures come first, so a crashed / crash-looping / unhealthy
    container floats to the TOP of the list instead of being buried
    alphabetically at the bottom (a 'dead' or 'exited (137)' container is not
    running, so the old 'running-first, then name' order pushed exactly the
    thing the operator needs to see out of sight — often below the fold on the
    wall display). After failures come the running containers, then everything
    else; each group stays alphabetical by name.

    This mirrors the summary card's failure-first philosophy (see _is_failed):
    the operator taps the Docker card through to this list precisely to
    investigate, so what is broken must be the first thing they land on.
    """
    return (
        not item.get("failed"),            # False (failed) sorts before True
        item.get("status") != "running",   # then running before stopped
        (item.get("name") or "").lower(),  # then alphabetical within each group
    )


def _client_get():
    global _client
    if _client is None:
        # timeout=10 prevents a hung Docker daemon call from blocking the metrics
        # loop for 60s (SDK default), which would cause XHR timeout.
        _client = docker.from_env(timeout=10)
    return _client


def _runtime():
    """Docker daemon version — memoized (doesn't change at runtime)."""
    if not _runtime_cache:
        try:
            v = _client_get().version() or {}
            _runtime_cache["docker_version"] = v.get("Version", "?")
        except Exception:
            _runtime_cache["docker_version"] = "?"
    return _runtime_cache


def _cpu_percent(stats):
    """CPU% using same criteria as `docker stats` (delta cpu vs delta system)."""
    try:
        cpu = stats["cpu_stats"]
        pre = stats["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        sys_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus")
        if not online:
            online = len(cpu["cpu_usage"].get("percpu_usage") or []) or 1
        if sys_delta > 0 and cpu_delta >= 0:
            return round((cpu_delta / sys_delta) * online * 100.0, 1)
    except (KeyError, TypeError, ZeroDivisionError):
        pass
    return 0.0


def _mem(stats):
    """Memory used (excluding cache), limit, and percentage."""
    mem = stats.get("memory_stats", {}) or {}
    usage = mem.get("usage", 0) or 0
    detail = mem.get("stats", {}) or {}
    cache = detail.get("cache")
    if cache is None:
        cache = detail.get("inactive_file", 0) or 0
    used = usage - cache
    if used < 0:
        used = usage
    limit = mem.get("limit", 0) or 0
    percent = round(used / limit * 100.0, 1) if limit else None
    return used, limit, percent


def _net(stats):
    nets = stats.get("networks") or {}
    recv = sent = 0
    for iface in nets.values():
        recv += iface.get("rx_bytes", 0) or 0
        sent += iface.get("tx_bytes", 0) or 0
    return recv, sent


def _one(container):
    """Collect metrics from a single container. Runs in parallel (see collect())."""
    item = {
        "name": container.name,
        "id": container.short_id,
        "status": container.status,
        "image": "",
        "cpu_percent": None,
        "mem_used": None,
        "mem_limit": None,
        "mem_percent": None,
        "net_rx": None,
        "net_tx": None,
        "exit_code": None,
        "health": None,
        "failed": False,
    }
    try:
        tags = container.image.tags
        item["image"] = tags[0] if tags else container.image.short_id
    except Exception:
        pass

    # Read the exit code / healthcheck verdict from the list payload's human
    # status string (no extra inspect call). Guarded: on any parse hiccup the
    # container is treated as NOT failed, so the display never cries wolf.
    try:
        status_msg = container.attrs.get("Status", "") or ""
    except Exception:
        status_msg = ""
    item["exit_code"] = _exit_code_from_status(status_msg)
    item["health"] = _health_from_status(status_msg)
    item["failed"] = _is_failed(container.status, item["exit_code"], item["health"])

    if container.status == "running":
        try:
            raw = container.stats(stream=False)
            stats = json.loads(raw) if isinstance(raw, (bytes, str)) else raw
            item["cpu_percent"] = _cpu_percent(stats)
            used, limit, percent = _mem(stats)
            item["mem_used"] = used
            item["mem_limit"] = limit
            item["mem_percent"] = percent
            recv, sent = _net(stats)
            item["net_rx"] = recv
            item["net_tx"] = sent
        except Exception:
            pass
    return item


def collect():
    client = _client_get()
    containers = client.containers.list(all=True)
    if not containers:
        return {"list": [], "runtime": _runtime()}

    # `stats(stream=False)` takes ~1s per container; parallelize to fit the cycle.
    workers = min(8, len(containers))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        items = list(pool.map(_one, containers))

    # Failures first (so a crash / unhealthy container is at the top of the
    # modal), then running, then stopped — each group alphabetical. See _sort_key.
    items.sort(key=_sort_key)
    return {"list": items, "runtime": _runtime()}


def get_logs(container_id, tail=200):
    """Return the last `tail` lines of logs from a container.

    Clean ANSI codes (colors) — they'd become garbage in a <pre>.
    Errors become {"error": ...} for the frontend to display.
    """
    try:
        c = _client_get().containers.get(container_id)
        raw = c.logs(tail=tail, timestamps=False, stdout=True, stderr=True)
        if isinstance(raw, (bytes, bytearray)):
            text = raw.decode('utf-8', errors='replace')
        else:
            text = str(raw)
        return {"name": c.name, "logs": _ANSI_RE.sub('', text)}
    except Exception as exc:
        return {"error": str(exc)}
