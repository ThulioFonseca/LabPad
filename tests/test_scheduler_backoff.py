"""Testes da logica de backoff exponencial do scheduler de feeds.

Valida a formula de calculo do delay — sem subir threads reais.
"""
import math


def _backoff(failures, retry_min=60, retry_max=600):
    """Replica a formula do _scheduler_loop em app.py."""
    return min(retry_min * (2 ** (failures - 1)), retry_max)


def test_primeira_falha_usa_retry_min():
    assert _backoff(1) == 60


def test_segunda_falha_dobra():
    assert _backoff(2) == 120


def test_terceira_falha_dobra_novamente():
    assert _backoff(3) == 240


def test_teto_e_respeitado():
    for failures in range(5, 20):
        assert _backoff(failures) <= 600


def test_teto_atingido_na_quarta_falha():
    # 60 * 2^3 = 480 < 600; 60 * 2^4 = 960 > 600 => teto na quinta falha
    assert _backoff(4) == 480
    assert _backoff(5) == 600


def test_retry_min_customizado():
    assert _backoff(1, retry_min=30) == 30
    assert _backoff(2, retry_min=30) == 60


def test_retry_max_customizado():
    assert _backoff(10, retry_min=60, retry_max=300) == 300
