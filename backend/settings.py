"""Store mutavel de configuracoes: defaults do .env + overrides em JSON.

Os defaults sao lidos de `config.py` (variaveis de ambiente). Overrides ficam
em `/data/settings.json` (volume), gravados pelo painel da engrenagem (PUT
/api/settings) e persistem entre restarts. Operacoes sao thread-safe.

Para campos novos, basta acrescentar uma chave em `_DEFAULTS` e expor no
endpoint de settings + na validacao em `app.py`.
"""
import json
import logging
import os
import threading

import config

_SETTINGS_PATH = os.environ.get("SETTINGS_PATH", "/data/settings.json")
_lock = threading.Lock()
_overrides = {}

# Defaults vem do .env (config.py). Cada secao e um dict.
_DEFAULTS = {
    "weather":  {"city": config.WEATHER_CITY},
    "calendar": {"url": config.CALENDAR_ICS_URL, "days": config.CALENDAR_DAYS},
    "news":     {"url": config.NEWS_RSS_URL, "limit": config.NEWS_LIMIT},
}


def _load():
    """Le o JSON do disco. Silencioso em caso de arquivo ausente/invalido."""
    global _overrides
    try:
        with open(_SETTINGS_PATH, "r") as fh:
            data = json.load(fh)
        _overrides = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        _overrides = {}


def _save():
    """Persiste o estado atual no disco (escrita atomica via .tmp + rename)."""
    try:
        directory = os.path.dirname(_SETTINGS_PATH) or "."
        os.makedirs(directory, exist_ok=True)
        tmp = _SETTINGS_PATH + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(_overrides, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, _SETTINGS_PATH)
    except OSError as exc:
        logging.warning("Nao foi possivel persistir settings.json (%s): %s",
                        _SETTINGS_PATH, exc)


def _merge(defaults, overrides):
    """Merge raso por secao (weather/calendar/news)."""
    out = {}
    for section_key, section in defaults.items():
        merged = dict(section)
        if isinstance(overrides.get(section_key), dict):
            merged.update(overrides[section_key])
        out[section_key] = merged
    return out


def get_effective():
    """Estado efetivo (defaults + overrides), thread-safe."""
    with _lock:
        return _merge(_DEFAULTS, _overrides)


def get(section, key, default=None):
    """Atalho: get('weather', 'city', '')."""
    eff = get_effective()
    return eff.get(section, {}).get(key, default)


def update(partial):
    """Aplica/persiste overrides parciais. Devolve (prev, new) para que o
    caller possa invalidar caches afetados (cidade nova, URL diferente etc.)."""
    if not isinstance(partial, dict):
        return get_effective(), get_effective()
    with _lock:
        prev = _merge(_DEFAULTS, _overrides)
        for section_key, values in partial.items():
            if not isinstance(values, dict):
                continue
            current = dict(_overrides.get(section_key, {}))
            current.update(values)
            _overrides[section_key] = current
        _save()
        new = _merge(_DEFAULTS, _overrides)
    return prev, new


_load()
