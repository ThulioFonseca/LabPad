"""Mutable settings store: .env defaults + JSON overrides.

Defaults are read from `config.py` (environment variables). Overrides live in
`/data/settings.json` (mounted volume), written by the settings panel (PUT
/api/settings), and persist across restarts. Operations are thread-safe.

For new fields, just add a key to `_DEFAULTS` and expose it in the settings
endpoint + validation in `app.py`.
"""
import json
import logging
import os
import threading

import config

_SETTINGS_PATH = os.environ.get("SETTINGS_PATH", "/data/settings.json")
_lock = threading.Lock()
_overrides = {}

# Defaults from config.py (which reads from .env with hardcoded fallbacks).
# config.py is just bootstrap — users edit everything via the settings panel,
# and overrides are stored in /data/settings.json.
_DEFAULTS = {
    "weather":  {"city": config.WEATHER_CITY},
    "calendar": {"url": config.CALENDAR_ICS_URL, "days": config.CALENDAR_DAYS},
    "news":     {"url": config.NEWS_RSS_URL, "limit": config.NEWS_LIMIT},
    "system":   {"timezone": config.TIMEZONE},
}


def _load():
    """Read JSON from disk. Silent if file is missing or invalid."""
    global _overrides
    try:
        with open(_SETTINGS_PATH, "r") as fh:
            data = json.load(fh)
        _overrides = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        _overrides = {}


def _save():
    """Persist current state to disk (atomic write via .tmp + rename)."""
    try:
        directory = os.path.dirname(_SETTINGS_PATH) or "."
        os.makedirs(directory, exist_ok=True)
        tmp = _SETTINGS_PATH + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(_overrides, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, _SETTINGS_PATH)
    except OSError as exc:
        logging.warning("Failed to persist settings.json (%s): %s",
                        _SETTINGS_PATH, exc)


def _merge(defaults, overrides):
    """Shallow merge per section (weather/calendar/news)."""
    out = {}
    for section_key, section in defaults.items():
        merged = dict(section)
        if isinstance(overrides.get(section_key), dict):
            merged.update(overrides[section_key])
        out[section_key] = merged
    return out


def get_effective():
    """Effective state (defaults + overrides), thread-safe."""
    with _lock:
        return _merge(_DEFAULTS, _overrides)


def get(section, key, default=None):
    """Shortcut: get('weather', 'city', '')."""
    eff = get_effective()
    return eff.get(section, {}).get(key, default)


def update(partial):
    """Apply/persist partial overrides. Return (prev, new) so caller can
    invalidate affected caches (new city, different URL, etc.)."""
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
