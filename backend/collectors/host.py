"""Coletor de metricas do host: CPU, memoria, disco, rede, load, uptime, SO."""
import socket
import time

import psutil

import config

# Estado para calcular a taxa de rede entre duas coletas consecutivas.
_net_prev = {"time": None, "recv": 0, "sent": 0}


def _read_os_name():
    """Nome amigavel do SO, lido de /etc/os-release (montado do host)."""
    try:
        with open("/etc/os-release", "r") as fh:
            for line in fh:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return "Linux"


def _read_hostname():
    """Hostname do host, lido do arquivo bind-montado; cai pro do container."""
    try:
        with open(config.HOST_HOSTNAME_FILE, "r") as fh:
            name = fh.read().strip()
            if name:
                return name
    except OSError:
        pass
    return socket.gethostname()


def _disks():
    out = []
    for label, path in config.DISK_PATHS:
        try:
            usage = psutil.disk_usage(path)
            out.append({
                "label": label,
                "percent": round(usage.percent, 1),
                "used": usage.used,
                "total": usage.total,
            })
        except OSError:
            out.append({
                "label": label, "percent": None, "used": None, "total": None,
            })
    return out


def _net_rates():
    """Taxa de rede (bytes/s) calculada pelo delta desde a coleta anterior."""
    counters = psutil.net_io_counters()
    now = time.time()
    recv_rate = sent_rate = 0.0
    if _net_prev["time"] is not None:
        dt = now - _net_prev["time"]
        if dt > 0:
            recv_rate = max(counters.bytes_recv - _net_prev["recv"], 0) / dt
            sent_rate = max(counters.bytes_sent - _net_prev["sent"], 0) / dt
    _net_prev["time"] = now
    _net_prev["recv"] = counters.bytes_recv
    _net_prev["sent"] = counters.bytes_sent
    return recv_rate, sent_rate


def collect():
    cpu = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    recv_rate, sent_rate = _net_rates()

    load = [None, None, None]
    try:
        load = [round(value, 2) for value in psutil.getloadavg()]
    except (AttributeError, OSError):
        pass

    return {
        "hostname": _read_hostname(),
        "os": _read_os_name(),
        "cpu_percent": round(cpu, 1),
        "cpu_count": psutil.cpu_count() or 1,
        "mem_percent": round(mem.percent, 1),
        "mem_used": mem.used,
        "mem_total": mem.total,
        "disk": _disks(),
        "net_rx": recv_rate,
        "net_tx": sent_rate,
        "load": load,
        "uptime": max(time.time() - psutil.boot_time(), 0),
    }
