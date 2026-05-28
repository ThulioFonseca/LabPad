"""Tests for the exponential backoff logic of the feed scheduler.

Validates the delay calculation formula — no real threads are started.
"""
import math


def _backoff(failures, retry_min=60, retry_max=600):
    """Replicates the _scheduler_loop formula from app.py."""
    return min(retry_min * (2 ** (failures - 1)), retry_max)


def test_first_failure_uses_retry_min():
    assert _backoff(1) == 60


def test_second_failure_doubles():
    assert _backoff(2) == 120


def test_third_failure_doubles_again():
    assert _backoff(3) == 240


def test_teto_e_respeitado():
    for failures in range(5, 20):
        assert _backoff(failures) <= 600


def test_teto_atingido_na_quarta_falha():
    # 60 * 2^3 = 480 < 600; 60 * 2^4 = 960 > 600 => cap hit on fifth failure
    assert _backoff(4) == 480
    assert _backoff(5) == 600


def test_retry_min_customizado():
    assert _backoff(1, retry_min=30) == 30
    assert _backoff(2, retry_min=30) == 60


def test_retry_max_customizado():
    assert _backoff(10, retry_min=60, retry_max=300) == 300
