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
