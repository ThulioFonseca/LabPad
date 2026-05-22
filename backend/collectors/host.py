"""Coletor de metricas do host: CPU, memoria, disco, rede, load, uptime, SO."""
import os
import socket
import time

import psutil

import config

# Filesystems de sistema que nao representam discos do usuario.
_SKIP_FSTYPES = frozenset([
    'tmpfs', 'devtmpfs', 'sysfs', 'proc', 'cgroup', 'cgroup2',
    'pstore', 'bpf', 'hugetlbfs', 'mqueue', 'debugfs', 'fusectl',
    'configfs', 'efivarfs', 'securityfs', 'squashfs', 'tracefs',
    'autofs', 'ramfs', 'overlay', 'fuse.lxcfs',
])

# Prefixos de mount points que devem ser ignorados.
_SKIP_MOUNTS = (
    '/proc', '/sys', '/dev', '/run', '/snap',
    '/var/lib/docker', '/var/lib/kubelet', '/boot/efi',
)

# Estado para calcular a taxa de rede entre duas coletas consecutivas.
_net_prev = {"time": None, "recv": 0, "sent": 0}

# Inicializa o contador de CPU; a primeira leitura com interval=None retorna 0.0
# (sem referencia anterior) — descartamos esse valor aqui para que a primeira
# coleta real ja retorne um percentual significativo.
psutil.cpu_percent(interval=None)


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
    """Auto-descobre particoes reais do host via /proc/1/mounts (pid: host).

    Le a tabela de montagem do processo 1 do host (acessivel porque o
    container usa pid: host) e filtra particoes de sistema, traduzindo
    cada mount point para dentro do rootfs montado em config.HOST_ROOT.
    """
    out = []
    seen_devs = set()
    try:
        with open('/proc/1/mounts', 'r') as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 4:
                    continue
                device, mountpoint, fstype = parts[0], parts[1], parts[2]
                if fstype in _SKIP_FSTYPES:
                    continue
                if any(mountpoint.startswith(p) for p in _SKIP_MOUNTS):
                    continue
                if device in seen_devs:
                    continue
                host_path = config.HOST_ROOT + mountpoint
                if not os.path.isdir(host_path):
                    continue
                try:
                    usage = psutil.disk_usage(host_path)
                    seen_devs.add(device)
                    out.append({
                        'label': mountpoint,
                        'percent': round(usage.percent, 1),
                        'used': usage.used,
                        'total': usage.total,
                    })
                except OSError:
                    pass
    except OSError:
        # Fallback: usa DISK_PATHS configurado em config.py
        for label, path in config.DISK_PATHS:
            try:
                usage = psutil.disk_usage(path)
                out.append({
                    'label': label,
                    'percent': round(usage.percent, 1),
                    'used': usage.used,
                    'total': usage.total,
                })
            except OSError:
                out.append({'label': label, 'percent': None, 'used': None, 'total': None})
        return out

    # / primeiro, depois alfabetico
    out.sort(key=lambda d: (d['label'] != '/', d['label']))
    return out


def _net_rates():
    """Taxa de rede (bytes/s) calculada pelo delta desde a coleta anterior."""
    iface = config.NETWORK_IFACE
    if iface:
        per_nic = psutil.net_io_counters(pernic=True)
        counters = per_nic.get(iface) or psutil.net_io_counters()
    else:
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
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    recv_rate, sent_rate = _net_rates()

    load = [None, None, None]
    try:
        load = [round(value, 2) for value in psutil.getloadavg()]
    except (AttributeError, OSError):
        pass

    disks = _disks()
    agg_used = sum(d['used'] for d in disks if d['used'] is not None)
    agg_total = sum(d['total'] for d in disks if d['total'] is not None)
    agg_percent = round(agg_used / agg_total * 100.0, 1) if agg_total else None

    return {
        "hostname": _read_hostname(),
        "os": _read_os_name(),
        "cpu_percent": round(cpu, 1),
        "cpu_count": psutil.cpu_count() or 1,
        "mem_percent": round(mem.percent, 1),
        "mem_used": mem.used,
        "mem_total": mem.total,
        "disk": disks,
        "disk_agg_percent": agg_percent,
        "disk_agg_used": agg_used,
        "disk_agg_total": agg_total,
        "net_rx": recv_rate,
        "net_tx": sent_rate,
        "load": load,
        "uptime": max(time.time() - psutil.boot_time(), 0),
    }
