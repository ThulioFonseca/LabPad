"""Tests for the container failure-detection helpers.

These parse the exit code / healthcheck verdict out of the human status string
Docker returns on the LIST endpoint (e.g. "Exited (137) 5 minutes ago"), and
decide whether a container is in a genuine failure state. The distinction is
the whole point: the wall display must shout about crashes and crash-loops but
stay quiet about containers stopped on purpose. No Docker daemon is needed —
the helpers are pure string/logic.
"""
import pytest

from collectors import containers


# --- exit-code parsing -------------------------------------------------------

@pytest.mark.parametrize("status_msg, expected", [
    ("Exited (137) 5 minutes ago", 137),
    ("Exited (0) 2 hours ago", 0),
    ("Restarting (1) 3 seconds ago", 1),
    ("Dead (255)", 255),
    ("Up 2 hours", None),
    ("Up 2 hours (healthy)", None),
    ("", None),
    (None, None),
])
def test_exit_code_from_status(status_msg, expected):
    assert containers._exit_code_from_status(status_msg) == expected


# --- healthcheck parsing -----------------------------------------------------

@pytest.mark.parametrize("status_msg, expected", [
    ("Up 2 hours (healthy)", "healthy"),
    ("Up 5 minutes (unhealthy)", "unhealthy"),
    ("Up 10 seconds (health: starting)", "starting"),
    ("Up 2 hours", None),
    ("Exited (0) 1 minute ago", None),
    ("", None),
    (None, None),
])
def test_health_from_status(status_msg, expected):
    assert containers._health_from_status(status_msg) == expected


# --- failure decision --------------------------------------------------------

def test_running_healthy_is_not_failed():
    assert containers._is_failed("running", None, "healthy") is False
    assert containers._is_failed("running", None, None) is False


def test_clean_stop_is_not_failed():
    # Exited 0 (a clean stop or a completed one-shot job) must never alarm.
    assert containers._is_failed("exited", 0, None) is False
    assert containers._is_failed("created", None, None) is False
    assert containers._is_failed("paused", None, None) is False


def test_nonzero_exit_is_failed():
    assert containers._is_failed("exited", 137, None) is True
    assert containers._is_failed("exited", 1, None) is True


def test_crash_loop_and_dead_are_failed():
    assert containers._is_failed("restarting", 1, None) is True
    assert containers._is_failed("dead", None, None) is True


def test_unhealthy_running_is_failed():
    # A container can be up yet failing its healthcheck — still a failure.
    assert containers._is_failed("running", None, "unhealthy") is True


# --- list ordering -----------------------------------------------------------
# The modal list must put genuine failures on top so the operator lands on what
# is broken, not on an alphabetical list with the crash buried at the bottom.

def _names_after_sort(items):
    return [c["name"] for c in sorted(items, key=containers._sort_key)]


def test_failed_containers_sort_to_the_top():
    # 'zzz-crashed' is exited/failed and would land LAST under a plain
    # alphabetical or running-first order; it must come first instead.
    items = [
        {"name": "alpha", "status": "running", "failed": False},
        {"name": "zzz-crashed", "status": "exited", "failed": True},
        {"name": "beta", "status": "running", "failed": False},
    ]
    assert _names_after_sort(items) == ["zzz-crashed", "alpha", "beta"]


def test_unhealthy_running_sorts_above_healthy_running():
    # A running-but-unhealthy container is still a failure and must outrank
    # healthy running containers even though both are 'running'.
    items = [
        {"name": "aaa-ok", "status": "running", "failed": False},
        {"name": "web", "status": "running", "failed": True},
    ]
    assert _names_after_sort(items) == ["web", "aaa-ok"]


def test_running_sorts_above_stopped_when_neither_failed():
    # Cleanly-stopped containers (failed=False) stay below the running ones.
    items = [
        {"name": "stopped-job", "status": "exited", "failed": False},
        {"name": "live", "status": "running", "failed": False},
    ]
    assert _names_after_sort(items) == ["live", "stopped-job"]


def test_ordering_is_alphabetical_within_each_group():
    items = [
        {"name": "Delta", "status": "running", "failed": True},
        {"name": "charlie", "status": "running", "failed": True},
        {"name": "Bravo", "status": "running", "failed": False},
        {"name": "alpha", "status": "running", "failed": False},
        {"name": "Echo", "status": "exited", "failed": False},
    ]
    # failures (case-insensitive) then running-ok then stopped-ok.
    assert _names_after_sort(items) == [
        "charlie", "Delta", "alpha", "Bravo", "Echo",
    ]
