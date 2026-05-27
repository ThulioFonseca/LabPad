"""Smoke tests for the sensors collector.

sensors.collect() degrades gracefully when /sys doesn't expose temperatures
(VMs, CI without real hardware). The test verifies structure is correct
regardless of environment.
"""


def test_collect_retorna_campos_obrigatorios():
    from collectors import sensors
    data = sensors.collect()
    assert "cpu_temp" in data
    assert "all" in data


def test_cpu_temp_none_ou_numero():
    from collectors import sensors
    data = sensors.collect()
    cpu_temp = data["cpu_temp"]
    assert cpu_temp is None or isinstance(cpu_temp, (int, float))


def test_all_e_lista():
    from collectors import sensors
    data = sensors.collect()
    assert isinstance(data["all"], list)


def test_entradas_de_sensor_tem_campos():
    from collectors import sensors
    data = sensors.collect()
    for entry in data["all"]:
        assert "chip" in entry
        assert "label" in entry
        assert "current" in entry
