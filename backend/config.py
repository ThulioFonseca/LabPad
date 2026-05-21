"""Configuracao do backend do Homelab Monitor.

Todos os valores podem ser sobrescritos por variaveis de ambiente
(definidas em docker-compose.yml).
"""
import os


def _env(name, default):
    value = os.environ.get(name)
    return value if value not in (None, "") else default


# --- Servidor HTTP -----------------------------------------------------------
PORT = int(_env("MONITOR_PORT", "8723"))
HOST_BIND = _env("MONITOR_BIND", "0.0.0.0")

# Intervalo sugerido de atualizacao (ms). Apenas informativo: exposto em
# /api/metrics; quem manda no polling e o refreshMs do static/config.js.
REFRESH_MS = int(_env("MONITOR_REFRESH_MS", "5000"))

# TTL do cache de /api/metrics (segundos). Evita recoletar tudo a cada request.
CACHE_TTL = float(_env("MONITOR_CACHE_TTL", "2.0"))


# --- Acesso ao host ----------------------------------------------------------
# Raiz do host montada dentro do container (ver volume em docker-compose.yml).
HOST_ROOT = _env("HOST_ROOT", "/rootfs")

# Arquivo com o hostname do host (bind-mount em docker-compose.yml).
HOST_HOSTNAME_FILE = _env("HOST_HOSTNAME_FILE", "/host-hostname")

# Pontos de montagem exibidos como "disco".
# Cada item: (rotulo exibido, caminho real dentro do container).
# Para mostrar tambem /dados do host, adicione:
#     ("/dados", HOST_ROOT + "/dados")
DISK_PATHS = [
    ("/", HOST_ROOT),
]


# --- Feeds externos: Agenda e Noticias ---------------------------------------
# Fuso horario (formato IANA, ex.: America/Sao_Paulo). Usado pela agenda.
TIMEZONE = _env("TZ", "America/Sao_Paulo")

# Agenda: URL .ics de um calendario Outlook publicado. Vazio = secao desativada.
CALENDAR_ICS_URL = _env("CALENDAR_ICS_URL", "")
# Quantos dias a frente exibir.
CALENDAR_DAYS = int(_env("CALENDAR_DAYS", "3"))
# Teto de eventos exibidos (evita estourar a tela).
CALENDAR_MAX_EVENTS = int(_env("CALENDAR_MAX_EVENTS", "12"))

# Noticias: URL de um feed RSS/Atom. Vazio = secao desativada.
NEWS_RSS_URL = _env("NEWS_RSS_URL", "")
# Quantas noticias exibir.
NEWS_LIMIT = int(_env("NEWS_LIMIT", "5"))

# Feeds externos sao lentos e mudam pouco: cache longo (segundos).
FEEDS_CACHE_TTL = float(_env("FEEDS_CACHE_TTL", "900"))
