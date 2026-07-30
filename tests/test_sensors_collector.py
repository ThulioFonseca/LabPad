"""Smoke tests for the sensors collector.

sensors.collect() degrades gracefully when /sys doesn't expose temperatures
(VMs, CI without real hardware). The test verifies structure is correct
regardless of environment.
"""
from types import SimpleNamespace


def _entry(current, label=""):
    """Minimal stand-in for a psutil shwtemp reading (has .current / .label)."""
    return SimpleNamespace(current=current, label=label)


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


# --- _hottest: report the hottest core, not the first/package reading --------

def test_hottest_picks_max_reading():
    from collectors import sensors
    # coretemp exposes a cool package first, then a throttling core.
    entries = [_entry(65.0, "Package id 0"),
               _entry(72.0, "Core 0"),
               _entry(91.0, "Core 1")]
    assert sensors._hottest(entries) == 91.0


def test_hottest_ignores_unknown_readings():
    from collectors import sensors
    entries = [_entry(None, "Core 0"), _entry(58.0, "Core 1"), _entry(None)]
    assert sensors._hottest(entries) == 58.0


def test_hottest_all_unknown_is_none():
    from collectors import sensors
    assert sensors._hottest([_entry(None), _entry(None)]) is None


def test_hottest_empty_is_none():
    from collectors import sensors
    assert sensors._hottest([]) is None


def test_collect_uses_hottest_core(monkeypatch):
    from collectors import sensors
    # A single core throttling well above a cooler package: the previous
    # entries[0] logic would have reported the 60C package and stayed green,
    # hiding the thermal event the Temp gauge exists to catch.
    fake = {
        "coretemp": [_entry(60.0, "Package id 0"),
                     _entry(63.0, "Core 0"),
                     _entry(93.0, "Core 1")],
    }
    monkeypatch.setattr(sensors.psutil, "sensors_temperatures",
                        lambda: fake, raising=False)
    data = sensors.collect()
    assert data["cpu_temp"] == 93.0


def test_collect_falls_through_chip_with_only_unknown(monkeypatch):
    from collectors import sensors
    # First preferred chip present but reports only unknown readings; the
    # representative temperature must come from the next preferred chip.
    fake = {
        "coretemp": [_entry(None, "Package id 0")],
        "k10temp":  [_entry(55.0, "Tctl")],
    }
    monkeypatch.setattr(sensors.psutil, "sensors_temperatures",
                        lambda: fake, raising=False)
    data = sensors.collect()
    assert data["cpu_temp"] == 55.0


def test_collect_fallback_to_non_preferred_chip(monkeypatch):
    from collectors import sensors
    # No preferred CPU chip at all: fall back to the hottest reading of the
    # first chip that reports anything.
    fake = {
        "nct6779": [_entry(40.0, "SYSTIN"), _entry(48.0, "CPUTIN")],
    }
    monkeypatch.setattr(sensors.psutil, "sensors_temperatures",
                        lambda: fake, raising=False)
    data = sensors.collect()
    assert data["cpu_temp"] == 48.0
