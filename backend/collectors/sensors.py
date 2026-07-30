"""Temperature/sensor collector.

Degrades gracefully: if the host does not expose sensors (VM, /sys unavailable),
returns cpu_temp=None and the dashboard shows "unavailable".
"""
import psutil

# Preferred chips for picking the representative CPU temperature.
_CPU_CHIPS = ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz")


def _hottest(entries):
    """Highest current reading among a chip's entries, or None.

    A CPU chip (coretemp / k10temp / ...) exposes a package/Tctl reading plus
    one entry per core. The previous code reported entries[0] — usually the
    package or first core — which can sit cool while a SINGLE core thermal-
    throttles well above it. On an always-on wall display that hides exactly the
    event the Temp gauge exists to catch, so track the hottest core instead.
    This is the thermal analogue of _disk_worst() in host.py: surface the real
    risk, not a flattering aggregate. Entries with an unknown reading are
    ignored.
    """
    hottest = None
    for entry in entries:
        cur = getattr(entry, "current", None)
        if cur is None:
            continue
        if hottest is None or cur > hottest:
            hottest = cur
    return hottest


def collect():
    out = {"cpu_temp": None, "all": []}

    read_fn = getattr(psutil, "sensors_temperatures", None)
    if read_fn is None:
        return out

    try:
        temps = read_fn()
    except Exception:
        return out
    if not temps:
        return out

    # Full list of readings (useful for future widgets).
    flat = []
    for chip, entries in temps.items():
        for entry in entries:
            flat.append({
                "chip": chip,
                "label": entry.label or chip,
                "current": round(entry.current, 1) if entry.current is not None else None,
            })
    out["all"] = flat

    # Representative CPU temperature: the hottest reading of the first preferred
    # CPU chip present, so a single throttling core is not masked by a cooler
    # package temperature (see _hottest). Falls through to the next preferred
    # chip if one reports only unknown readings.
    cpu_temp = None
    for chip in _CPU_CHIPS:
        if temps.get(chip):
            cpu_temp = _hottest(temps[chip])
            if cpu_temp is not None:
                break
    if cpu_temp is None:
        # No known CPU chip: fall back to the hottest reading of the first
        # chip that reports anything (single chip only — never mix a disk/GPU
        # sensor into the CPU figure).
        for entries in temps.values():
            cpu_temp = _hottest(entries)
            if cpu_temp is not None:
                break

    out["cpu_temp"] = round(cpu_temp, 1) if cpu_temp is not None else None
    return out
