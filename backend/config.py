"""Configuration for the Homelab Monitor backend.

All values can be overridden by environment variables
(defined in docker-compose.yml).
"""
import os


def _env(name, default):
    value = os.environ.get(name)
    return value if value not in (None, "") else default


# --- HTTP Server -----------------------------------------------------------
PORT = int(_env("MONITOR_PORT", "8723"))
HOST_BIND = _env("MONITOR_BIND", "0.0.0.0")

# Suggested update interval (ms). Informational only: exposed in /api/metrics;
# polling is controlled by refreshMs in static/config.js.
REFRESH_MS = int(_env("MONITOR_REFRESH_MS", "5000"))

# Cache TTL for /api/metrics (seconds). Avoids re-collecting everything on each request.
CACHE_TTL = float(_env("MONITOR_CACHE_TTL", "2.0"))


# --- Host Access -----------------------------------------------------------
# Host root mounted inside container (see volume in docker-compose.yml).
HOST_ROOT = _env("HOST_ROOT", "/rootfs")

# File containing the host hostname (bind-mounted in docker-compose.yml).
HOST_HOSTNAME_FILE = _env("HOST_HOSTNAME_FILE", "/host-hostname")

# Disk mount points displayed as "disk".
# Each item: (display label, actual path inside container).
# To also show /data from the host, add:
#     ("/data", HOST_ROOT + "/data")
DISK_PATHS = [
    ("/", HOST_ROOT),
]


# --- External Feeds: Calendar and News ----------------------------------------
# Timezone (IANA format, e.g. America/New_York). Used by calendar.
TIMEZONE = _env("TZ", "America/Sao_Paulo")

# Calendar: URL of a published Outlook calendar (.ics). Empty = section disabled.
CALENDAR_ICS_URL = _env("CALENDAR_ICS_URL", "")
# How many days ahead to display.
CALENDAR_DAYS = int(_env("CALENDAR_DAYS", "3"))
# Maximum events displayed (prevents screen overflow).
CALENDAR_MAX_EVENTS = int(_env("CALENDAR_MAX_EVENTS", "12"))

# News: URL of an RSS/Atom feed. Empty = section disabled.
NEWS_RSS_URL = _env("NEWS_RSS_URL", "")
# How many news items to display.
NEWS_LIMIT = int(_env("NEWS_LIMIT", "5"))

# External feeds are slow and change infrequently: long cache (seconds).
FEEDS_CACHE_TTL = float(_env("FEEDS_CACHE_TTL", "900"))
# Exponential backoff when a feed fails (seconds): starts at MIN, doubles on
# each consecutive failure, capped at MAX. Success resets to normal interval
# FEEDS_CACHE_TTL. Default series: 60, 120, 240, 480, 600, 600, ...
FEEDS_RETRY_MIN_S = float(_env("FEEDS_RETRY_MIN_S", "60"))
FEEDS_RETRY_MAX_S = float(_env("FEEDS_RETRY_MAX_S", "600"))

# Network interface to monitor. Empty = sum of all interfaces.
NETWORK_IFACE = _env("MONITOR_NETWORK_IFACE", "")

# Weather: city name to monitor (e.g. New York, Tokyo).
# Empty = section disabled.
WEATHER_CITY = _env("WEATHER_CITY", "")


# --- Health Alerts ---------------------------------------------------------
# Raise a dashboard notification when a host resource crosses a threshold
# (warning/critical) and a recovery notice when it returns to normal. Memory
# and disk are percent; temperature is degrees Celsius. Set HEALTH_ALERTS=0
# to disable entirely.
HEALTH_ALERTS_ENABLED = _env("HEALTH_ALERTS", "1") not in ("0", "false", "no")
HEALTH_MEM_WARN = float(_env("HEALTH_MEM_WARN", "90"))
HEALTH_MEM_CRIT = float(_env("HEALTH_MEM_CRIT", "97"))
HEALTH_DISK_WARN = float(_env("HEALTH_DISK_WARN", "85"))
HEALTH_DISK_CRIT = float(_env("HEALTH_DISK_CRIT", "95"))
HEALTH_TEMP_WARN = float(_env("HEALTH_TEMP_WARN", "75"))
HEALTH_TEMP_CRIT = float(_env("HEALTH_TEMP_CRIT", "85"))
# Hysteresis margin (in the metric's unit): a tripped alert only clears once
# the value falls this far below the threshold, preventing flapping when a
# value hovers on a boundary.
HEALTH_HYSTERESIS = float(_env("HEALTH_HYSTERESIS", "3"))
