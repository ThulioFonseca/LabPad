"""Temperature/sensor collector.

Degrades gracefully: if the host does not expose sensors (VM, /sys unavailable),
returns cpu_temp=None and the dashboard shows "unavailable".
"""
import psutil

# Preferred chips for picking the representative CPU temperature.
_CPU_CHIPS = ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz")


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

    # Representative CPU temperature.
    cpu_temp = None
    for chip in _CPU_CHIPS:
        if temps.get(chip):
            cpu_temp = temps[chip][0].current
            break
    if cpu_temp is None:
        for entries in temps.values():
            if entries:
                cpu_temp = entries[0].current
                break

    out["cpu_temp"] = round(cpu_temp, 1) if cpu_temp is not None else None
    return out
