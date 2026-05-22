"""Coletor de metricas dos containers Docker (via socket montado :ro)."""
import json
from concurrent.futures import ThreadPoolExecutor

import docker

_client = None
_runtime_cache = {}


def _client_get():
    global _client
    if _client is None:
        # timeout=10 evita que uma chamada travada ao Docker daemon bloqueie o
        # loop de métricas por 60s (padrão do SDK), o que causaria timeout no XHR.
        _client = docker.from_env(timeout=10)
    return _client


def _runtime():
    """Versao do Docker daemon — memoizada (nao muda em runtime)."""
    if not _runtime_cache:
        try:
            v = _client_get().version() or {}
            _runtime_cache["docker_version"] = v.get("Version", "?")
        except Exception:
            _runtime_cache["docker_version"] = "?"
    return _runtime_cache


def _cpu_percent(stats):
    """CPU% no mesmo criterio do `docker stats` (delta cpu vs delta sistema)."""
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
    """Memoria usada (descontando cache), limite e percentual."""
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
    """Coleta de um unico container. Roda em paralelo (ver collect())."""
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
    }
    try:
        tags = container.image.tags
        item["image"] = tags[0] if tags else container.image.short_id
    except Exception:
        pass

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

    # `stats(stream=False)` leva ~1s por container; paraleliza para caber no ciclo.
    workers = min(8, len(containers))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        items = list(pool.map(_one, containers))

    # Ativos primeiro, depois ordem alfabetica.
    items.sort(key=lambda c: (c["status"] != "running", c["name"].lower()))
    return {"list": items, "runtime": _runtime()}
