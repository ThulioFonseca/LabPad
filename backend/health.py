"""Host health monitor: raise a notification when a host resource crosses a
configured threshold, and a recovery notice when it returns to normal.

This complements the feed scheduler's integration alerts in app.py. Those
cover *external* sources failing (calendar/news/weather); this covers the
*host itself* getting into trouble — a disk filling up, memory pressure, or
an overheating CPU. On an always-on wall display those are exactly the events
you want surfaced as a notification instead of having to notice a red gauge.

Stateful by design: each metric is a small state machine (ok -> warning ->
critical). A notification fires only on a level *transition*, so a value
sitting at 96% does not re-alert every collection cycle; returning to normal
fires a single 'info' recovery. To avoid flapping when a value hovers on a
boundary, a tripped level only clears once the value falls a configurable
margin below the threshold (hysteresis).

In-memory only, like notifications.py — a restart clears the state and the
first cycle re-establishes it from live readings.
"""
import logging
import threading

import config
import notifications

# Level ordering. Higher = worse.
_OK, _WARNING, _CRITICAL = 0, 1, 2

# Severity string handed to notifications.add() for each level.
_SEVERITY = {_WARNING: "warning", _CRITICAL: "error"}
_LEVEL_NAME = {_WARNING: "warning", _CRITICAL: "critical"}

_lock = threading.Lock()
# {metric_key: level} — last level we alerted on. Absent means "ok / unseen".
_state = {}


def _fmt(value):
    """Compact number: no trailing '.0', otherwise one decimal."""
    return ("%.0f" % value) if float(value).is_integer() else ("%.1f" % value)


def _evaluate_level(value, warn, crit, prev):
    """Resolve the level for `value`, applying hysteresis relative to `prev`.

    Rising is immediate (cross warn -> warning, cross crit -> critical), but a
    level only clears once the value drops HEALTH_HYSTERESIS below the trip
    threshold — so a metric oscillating around a boundary does not spam
    alert/recovery pairs.
    """
    if value is None:
        return None
    margin = config.HEALTH_HYSTERESIS
    warn_clear = warn - margin
    crit_clear = crit - margin
    if prev == _CRITICAL:
        if value >= crit_clear:
            return _CRITICAL
        return _WARNING if value >= warn_clear else _OK
    if prev == _WARNING:
        if value >= crit:
            return _CRITICAL
        return _WARNING if value >= warn_clear else _OK
    # prev == _OK
    if value >= crit:
        return _CRITICAL
    return _WARNING if value >= warn else _OK


def _check(key, label, value, unit, warn, crit):
    """Advance one metric's state machine and notify on a level transition.

    Caller must hold _lock. `key` is the notification source suffix; distinct
    keys track independently (e.g. one per disk mount point).
    """
    if value is None:
        return
    prev = _state.get(key, _OK)
    level = _evaluate_level(value, warn, crit, prev)
    if level is None or level == prev:
        return
    _state[key] = level
    source = "health:" + key
    if level == _OK:
        notifications.add(
            "info", source,
            "%s back to normal" % label,
            "%s is %s%s, below the %s%s warning threshold."
            % (label, _fmt(value), unit, _fmt(warn), unit))
    else:
        threshold = crit if level == _CRITICAL else warn
        notifications.add(
            _SEVERITY[level], source,
            "%s %s" % (label, _LEVEL_NAME[level]),
            "%s is at %s%s (%s threshold %s%s)."
            % (label, _fmt(value), unit,
               _LEVEL_NAME[level], _fmt(threshold), unit))


def evaluate(metrics):
    """Inspect a freshly-built metrics dict and raise/clear health alerts.

    Called from app._build_metrics() right after collection. Best-effort: any
    failure here is logged and swallowed so it can never break the metrics
    response the dashboard depends on.
    """
    if not config.HEALTH_ALERTS_ENABLED:
        return
    try:
        host = metrics.get("host") or {}
        sensors = metrics.get("sensors") or {}
        with _lock:
            _check("memory", "Memory usage", host.get("mem_percent"), "%",
                   config.HEALTH_MEM_WARN, config.HEALTH_MEM_CRIT)
            _check("temperature", "CPU temperature", sensors.get("cpu_temp"),
                   "°C", config.HEALTH_TEMP_WARN, config.HEALTH_TEMP_CRIT)
            # One independent state machine per disk mount point.
            seen = set()
            for disk in host.get("disk") or []:
                label = disk.get("label") or "?"
                key = "disk:" + label
                seen.add(key)
                _check(key, "Disk %s" % label, disk.get("percent"), "%",
                       config.HEALTH_DISK_WARN, config.HEALTH_DISK_CRIT)
            # Forget disks that disappeared (unmounted) so state doesn't leak.
            for key in [k for k in _state
                        if k.startswith("disk:") and k not in seen]:
                _state.pop(key, None)
    except Exception as exc:
        logging.warning("health.evaluate failed: %s", exc)
