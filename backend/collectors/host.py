"""Host metrics collector: CPU, memory, disk, network, load, uptime, OS."""
import os
import platform
import socket
import sys
import threading
import time

import psutil

import config

# System filesystems that do not represent user disks.
_SKIP_FSTYPES = frozenset([
    'tmpfs', 'devtmpfs', 'sysfs', 'proc', 'cgroup', 'cgroup2',
    'pstore', 'bpf', 'hugetlbfs', 'mqueue', 'debugfs', 'fusectl',
    'configfs', 'efivarfs', 'securityfs', 'squashfs', 'tracefs',
    'autofs', 'ramfs', 'overlay', 'fuse.lxcfs',
])

# Mount point prefixes to skip.
_SKIP_MOUNTS = (
    '/proc', '/sys', '/dev', '/run', '/snap',
    '/var/lib/docker', '/var/lib/kubelet', '/boot/efi',
)

# State for calculating network rate between two consecutive reads.
_net_prev = {"time": None, "recv": 0, "sent": 0}
_net_lock = threading.Lock()

# Initialise the CPU counter; the first call with interval=None returns 0.0
# (no previous reference) — discard it here so the first real read
# already returns a meaningful percentage.
psutil.cpu_percent(interval=None)


def _read_os_name():
    """Friendly OS name, read from /etc/os-release (bind-mounted from host)."""
    try:
        with open("/etc/os-release", "r") as fh:
            for line in fh:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return "Linux"


def _read_hostname():
    """Host hostname, read from the bind-mounted file; falls back to container's."""
    try:
        with open(config.HOST_HOSTNAME_FILE, "r") as fh:
            name = fh.read().strip()
            if name:
                return name
    except OSError:
        pass
    return socket.gethostname()


def _cpu_model():
    """CPU model (first 'model name' line from /proc/cpuinfo)."""
    try:
        with open("/proc/cpuinfo", "r") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "?"


def _interfaces():
    """List of host network interfaces (network_mode: host)."""
    out = []
    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
    except Exception:
        return out
    for name in sorted(addrs.keys()):
        if name == "lo":
            continue
        ipv4 = mac = None
        for entry in addrs[name]:
            family = getattr(entry, "family", None)
            if family == socket.AF_INET and ipv4 is None:
                ipv4 = entry.address
            elif family == psutil.AF_LINK and mac is None:
                mac = entry.address
        st = stats.get(name)
        out.append({
            "name": name,
            "ipv4": ipv4,
            "mac": mac,
            "mtu": getattr(st, "mtu", None) if st else None,
            "speed_mbps": getattr(st, "speed", None) if st else None,
            "is_up": getattr(st, "isup", None) if st else None,
        })
    return out


# OS, hostname, core count, CPU model, kernel: don't change at runtime — read once.
_static_cache = {}


def _static():
    if not _static_cache:
        uname = os.uname()
        _static_cache["os"] = _read_os_name()
        _static_cache["hostname"] = _read_hostname()
        _static_cache["cpu_count"] = psutil.cpu_count() or 1
        _static_cache["cpu_count_physical"] = (
            psutil.cpu_count(logical=False) or _static_cache["cpu_count"])
        _static_cache["cpu_model"] = _cpu_model()
        _static_cache["kernel"] = uname.release
        _static_cache["arch"] = uname.machine
        _static_cache["python_version"] = sys.version.split()[0]
    return _static_cache


def _disks():
    """Auto-discover real host partitions via /proc/1/mounts (pid: host).

    Reads the mount table of host process 1 (accessible because the container
    uses pid: host), filters out system partitions, and translates each mount
    point into the rootfs mounted at config.HOST_ROOT.
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
        # Fallback: use DISK_PATHS from config.py
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

    # / first, then alphabetical
    out.sort(key=lambda d: (d['label'] != '/', d['label']))
    return out


def _disk_worst(disks):
    """Return the single fullest partition (highest percent), or None.

    The aggregate percentage below averages every mount together, so a single
    partition filling to capacity — a classic homelab failure, e.g. a full "/"
    that stops services — stays invisible behind a big, mostly-empty data disk.
    Tracking the worst mount lets the Disk card colour by the real risk instead
    of the flattering all-mounts average. Partitions with an unknown percent are
    ignored.
    """
    worst = None
    for d in disks:
        pct = d.get('percent')
        if pct is None:
            continue
        if worst is None or pct > worst['percent']:
            worst = d
    return worst


def _net_rates():
    """Network rate (bytes/s) calculated from the delta since the previous read."""
    iface = config.NETWORK_IFACE
    if iface:
        per_nic = psutil.net_io_counters(pernic=True)
        counters = per_nic.get(iface) or psutil.net_io_counters()
    else:
        counters = psutil.net_io_counters()
    now = time.time()
    recv_rate = sent_rate = 0.0
    with _net_lock:
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
    # Fullest single partition — so the Disk card can flag a full mount that the
    # aggregate above averages away (see _disk_worst).
    worst = _disk_worst(disks)

    static = _static()
    info = {
        "kernel": static["kernel"],
        "arch": static["arch"],
        "cpu_model": static["cpu_model"],
        "cpu_count_physical": static["cpu_count_physical"],
        "python_version": static["python_version"],
        "interfaces": _interfaces(),
    }
    return {
        "hostname": static["hostname"],
        "os": static["os"],
        "cpu_percent": round(cpu, 1),
        "cpu_count": static["cpu_count"],
        "mem_percent": round(mem.percent, 1),
        "mem_used": mem.used,
        "mem_total": mem.total,
        "disk": disks,
        "disk_agg_percent": agg_percent,
        "disk_agg_used": agg_used,
        "disk_agg_total": agg_total,
        "disk_max_percent": worst['percent'] if worst else None,
        "disk_max_label": worst['label'] if worst else None,
        "net_rx": recv_rate,
        "net_tx": sent_rate,
        "load": load,
        "uptime": max(time.time() - psutil.boot_time(), 0),
        "info": info,
    }
