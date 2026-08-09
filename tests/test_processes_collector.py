"""Smoke tests for the top-processes collector.

processes.collect() enumerates live host processes and samples per-process CPU
over a short window. It must degrade gracefully (empty lists, never raise) and
always return a well-formed structure — the /api/processes route serves it
straight to the wall display.
"""


def test_collect_retorna_estrutura():
    from collectors import processes
    data = processes.collect()
    assert "by_cpu" in data
    assert "by_mem" in data
    assert "sampled_ms" in data
    assert isinstance(data["by_cpu"], list)
    assert isinstance(data["by_mem"], list)


def test_respeita_limit():
    from collectors import processes
    data = processes.collect(limit=3)
    assert len(data["by_cpu"]) <= 3
    assert len(data["by_mem"]) <= 3


def test_linhas_tem_campos_e_tipos():
    from collectors import processes
    data = processes.collect()
    for row in data["by_cpu"] + data["by_mem"]:
        assert "pid" in row
        assert "name" in row
        assert "cpu_percent" in row
        assert "mem_bytes" in row
        assert "mem_percent" in row
        assert isinstance(row["pid"], int)
        assert isinstance(row["name"], str)
        assert isinstance(row["cpu_percent"], (int, float))
        assert isinstance(row["mem_bytes"], int)
        assert isinstance(row["mem_percent"], (int, float))


def test_by_cpu_ordenado_desc():
    from collectors import processes
    data = processes.collect()
    cpus = [r["cpu_percent"] for r in data["by_cpu"]]
    assert cpus == sorted(cpus, reverse=True)


def test_by_mem_ordenado_desc():
    from collectors import processes
    data = processes.collect()
    mems = [r["mem_bytes"] for r in data["by_mem"]]
    assert mems == sorted(mems, reverse=True)


def test_cpu_percent_normalizado_ao_total():
    """cpu_percent is normalised across all cores (0..100-ish), matching the
    system CPU gauge — not the per-core figure psutil returns, which can exceed
    100. Allow a small margin for transient over-100 rounding on a busy host."""
    from collectors import processes
    data = processes.collect()
    for row in data["by_cpu"]:
        assert row["cpu_percent"] >= 0
        assert row["cpu_percent"] <= 105
