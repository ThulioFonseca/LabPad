"""Smoke tests for the host collector.

Verifies that collect() returns the expected structure without depending on
real hardware state — just ensures fields exist and have correct types.
The module uses psutil, which works on any Linux/macOS environment.
"""
import pytest


def test_collect_retorna_campos_obrigatorios():
    from collectors import host
    data = host.collect()
    campos = ("hostname", "os", "cpu_percent", "cpu_count",
              "mem_percent", "mem_used", "mem_total",
              "disk", "net_rx", "net_tx", "load", "uptime", "info")
    for c in campos:
        assert c in data, "campo '%s' ausente" % c


def test_cpu_percent_no_intervalo():
    from collectors import host
    data = host.collect()
    assert 0.0 <= data["cpu_percent"] <= 100.0


def test_mem_total_positivo():
    from collectors import host
    data = host.collect()
    assert data["mem_total"] > 0


def test_uptime_positivo():
    from collectors import host
    data = host.collect()
    assert data["uptime"] > 0


def test_disk_lista():
    from collectors import host
    data = host.collect()
    assert isinstance(data["disk"], list)


def test_net_rates_nao_negativas():
    from collectors import host
    data = host.collect()
    assert data["net_rx"] >= 0
    assert data["net_tx"] >= 0


def test_load_lista_de_tres():
    from collectors import host
    data = host.collect()
    assert isinstance(data["load"], list)
    assert len(data["load"]) == 3


def test_info_campos():
    from collectors import host
    data = host.collect()
    info = data["info"]
    for c in ("kernel", "arch", "cpu_model", "cpu_count_physical",
              "python_version", "interfaces"):
        assert c in info, "info.%s ausente" % c
