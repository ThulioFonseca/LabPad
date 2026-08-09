"""Top-processes collector: which processes use the most CPU / memory.

The dashboard's CPU and Memory gauges answer "how busy is the host?" but never
"what is making it busy?" — the first question you actually ask when a wall
display shows CPU pinned at 90%. This collector returns the heaviest processes
so the System modal can name the culprit.

It is deliberately NOT part of the 5s /api/metrics loop. Measuring per-process
CPU needs a short sampling window (psutil returns 0.0 on the FIRST read of each
process), so it runs only on demand — when a human opens the System modal, via
the /api/processes route. That keeps the always-on iPad 2 polling path cheap and
confines the one-off ~0.3s sample to a real user interaction.

Degrades gracefully: returns empty lists if psutil cannot enumerate processes.
"""
import time

import psutil

# Sampling window for per-process CPU%. psutil.Process.cpu_percent(None) returns
# the busy fraction since the PREVIOUS call on that process, so the first read is
# always 0.0 — we prime every process, wait this long, then read again. Kept
# short so the on-demand request stays snappy while still giving a usable value.
_CPU_SAMPLE_S = 0.3

# Errors raised when a process vanishes or is unreadable mid-scan — expected on a
# live system (short-lived processes come and go) and simply skipped.
_SKIP = (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess)


def collect(limit=5):
    """Return the top processes by CPU and by memory.

    {"by_cpu": [...], "by_mem": [...], "sampled_ms": int}
    each row: {"pid", "name", "cpu_percent", "mem_bytes", "mem_percent"}

    ``cpu_percent`` is normalised to the WHOLE machine (0..100 across every
    core), matching the system CPU gauge — psutil reports a per-core figure that
    can exceed 100, which would be confusing sitting next to that gauge.
    """
    empty = {"by_cpu": [], "by_mem": [], "sampled_ms": 0}

    try:
        cores = psutil.cpu_count() or 1
    except Exception:
        return empty

    # First pass: prime the CPU counter for every process we can touch.
    procs = []
    try:
        for proc in psutil.process_iter():
            try:
                proc.cpu_percent(None)
                procs.append(proc)
            except _SKIP:
                continue
    except Exception:
        return empty

    time.sleep(_CPU_SAMPLE_S)

    # Second pass: read the CPU delta accumulated over the sample window plus the
    # instantaneous memory footprint.
    rows = []
    for proc in procs:
        try:
            cpu = proc.cpu_percent(None) / cores
            name = proc.name() or "?"
            mem_bytes = getattr(proc.memory_info(), "rss", 0) or 0
            mem_pct = proc.memory_percent()
            pid = proc.pid
        except _SKIP:
            continue
        except Exception:
            continue
        rows.append({
            "pid": pid,
            "name": name,
            "cpu_percent": round(cpu, 1),
            "mem_bytes": int(mem_bytes),
            "mem_percent": round(mem_pct, 1),
        })

    by_cpu = sorted(rows, key=lambda r: r["cpu_percent"], reverse=True)[:limit]
    by_mem = sorted(rows, key=lambda r: r["mem_bytes"], reverse=True)[:limit]
    return {
        "by_cpu": by_cpu,
        "by_mem": by_mem,
        "sampled_ms": int(_CPU_SAMPLE_S * 1000),
    }
