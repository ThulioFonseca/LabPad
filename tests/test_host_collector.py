"""Smoke tests for the host collector.

Verifies that collect() returns the expected structure without depending on
real hardware state — just ensures fields exist and have correct types.
The module uses psutil, which works on any Linux/macOS environment.
"""
import pytest


def test_collect_retorna_campos_obrigatorios():
    from collectors import host
    data = host.collect()
    campos = ("hostname", "os", "cpu_percent", "cpu_count", "cpu_per_core",
              "mem_percent", "mem_used", "mem_total",
              "disk", "net_rx", "net_tx", "load", "uptime", "info")
    for c in campos:
        assert c in data, "campo '%s' ausente" % c


def test_cpu_percent_no_intervalo():
    from collectors import host
    data = host.collect()
    assert 0.0 <= data["cpu_percent"] <= 100.0


def test_cpu_per_core_lista_e_no_intervalo():
    from collectors import host
    data = host.collect()
    assert isinstance(data["cpu_per_core"], list)
    # Every reported core is a valid 0..100 percentage.
    for v in data["cpu_per_core"]:
        assert 0.0 <= v <= 100.0


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


def test_disk_max_campos_presentes():
    from collectors import host
    data = host.collect()
    assert "disk_max_percent" in data
    assert "disk_max_label" in data
    # Fullest-partition percent, when known, is a valid 0..100 reading.
    if data["disk_max_percent"] is not None:
        assert 0.0 <= data["disk_max_percent"] <= 100.0


def test_disk_worst_picks_fullest_partition():
    from collectors import host
    disks = [
        {"label": "/", "percent": 96.0, "used": 19, "total": 20},
        {"label": "/data", "percent": 12.0, "used": 120, "total": 1000},
    ]
    worst = host._disk_worst(disks)
    assert worst is not None
    assert worst["label"] == "/"
    assert worst["percent"] == 96.0


def test_disk_worst_ignores_unknown_percent():
    from collectors import host
    disks = [
        {"label": "/mnt/x", "percent": None, "used": None, "total": None},
        {"label": "/", "percent": 40.0, "used": 4, "total": 10},
    ]
    worst = host._disk_worst(disks)
    assert worst is not None
    assert worst["label"] == "/"


def test_disk_worst_empty_is_none():
    from collectors import host
    assert host._disk_worst([]) is None
    assert host._disk_worst(
        [{"label": "/", "percent": None, "used": None, "total": None}]) is None
