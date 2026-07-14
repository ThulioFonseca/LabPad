"""Tests for the host health monitor (backend/health.py).

Validates: threshold levels, transition-only alerting, severities, recovery,
hysteresis (no flapping), per-disk independence, missing readings ignored,
and the global enable flag. Each test starts from a clean module state so the
in-memory state machines and the notification store don't leak across tests.
"""
import importlib
import sys


def _fresh():
    """Re-import health + notifications with clean in-memory state."""
    for name in ("health", "notifications"):
        if name in sys.modules:
            del sys.modules[name]
    notifications = importlib.import_module("notifications")
    health = importlib.import_module("health")
    return health, notifications


def _metrics(mem=None, temp=None, disk=None):
    """Build a minimal metrics dict shaped like app._build_metrics()."""
    return {
        "host": {"mem_percent": mem, "disk": disk or []},
        "sensors": {"cpu_temp": temp},
    }


def test_normal_readings_raise_nothing():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=40, temp=50,
                             disk=[{"label": "/", "percent": 30}]))
    assert notif.unread_count() == 0


def test_memory_warning_fires_warning_severity():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=92))          # default warn=90, crit=97
    items = notif.list_unread()
    assert len(items) == 1
    assert items[0]["severity"] == "warning"
    assert items[0]["source"] == "health:memory"


def test_memory_critical_fires_error_severity():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=98))          # >= crit 97
    items = notif.list_unread()
    assert len(items) == 1
    assert items[0]["severity"] == "error"


def test_same_level_does_not_refire():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=92))
    health.evaluate(_metrics(mem=93))          # still warning, no new alert
    assert notif.unread_count() == 1


def test_escalation_warning_to_critical_fires_again():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=92))          # warning
    health.evaluate(_metrics(mem=98))          # escalates to critical
    severities = sorted(n["severity"] for n in notif.list_unread())
    assert severities == ["error", "warning"]


def test_recovery_fires_info():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=98))          # critical
    health.evaluate(_metrics(mem=40))          # back to normal
    infos = [n for n in notif.list_unread() if n["severity"] == "info"]
    assert len(infos) == 1
    assert "back to normal" in infos[0]["title"]


def test_hysteresis_prevents_flap_just_below_threshold():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=92))          # warning tripped
    # Drop to 89: below warn(90) but within the 3-point hysteresis margin
    # (clears only under 87) — must NOT emit a recovery yet.
    health.evaluate(_metrics(mem=89))
    assert notif.unread_count() == 1
    assert all(n["severity"] != "info" for n in notif.list_unread())


def test_hysteresis_clears_once_past_margin():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=92))          # warning
    health.evaluate(_metrics(mem=86))          # under warn(90) - margin(3)=87
    infos = [n for n in notif.list_unread() if n["severity"] == "info"]
    assert len(infos) == 1


def test_disks_tracked_independently():
    health, notif = _fresh()
    health.evaluate(_metrics(disk=[
        {"label": "/", "percent": 96},         # critical
        {"label": "/data", "percent": 30},     # ok
    ]))
    items = notif.list_unread()
    assert len(items) == 1
    assert items[0]["source"] == "health:disk:/"
    assert items[0]["severity"] == "error"


def test_missing_reading_is_ignored():
    health, notif = _fresh()
    health.evaluate(_metrics(mem=None, temp=None))
    assert notif.unread_count() == 0


def test_temperature_threshold():
    health, notif = _fresh()
    health.evaluate(_metrics(temp=88))         # default crit 85
    items = notif.list_unread()
    assert len(items) == 1
    assert items[0]["source"] == "health:temperature"
    assert items[0]["severity"] == "error"


def test_disabled_flag_suppresses_all_alerts():
    health, notif = _fresh()
    import config
    prev = config.HEALTH_ALERTS_ENABLED
    config.HEALTH_ALERTS_ENABLED = False
    try:
        health.evaluate(_metrics(mem=99, temp=99,
                                 disk=[{"label": "/", "percent": 99}]))
        assert notif.unread_count() == 0
    finally:
        config.HEALTH_ALERTS_ENABLED = prev


def test_evaluate_never_raises_on_malformed_input():
    health, _ = _fresh()
    # Missing keys / wrong shapes must be swallowed, not propagated.
    health.evaluate({})
    health.evaluate({"host": None, "sensors": None})
