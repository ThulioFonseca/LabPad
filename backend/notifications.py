"""Store de notificacoes em memoria. Thread-safe. Sem persistencia em disco
(restart limpa a fila — adequado para um dashboard sempre-aberto).

Severidades suportadas:
- 'error'   → falha de integracao (destaque vermelho na UI)
- 'warning' → degradacao (destaque amarelo)
- 'info'    → eventos gerais, como recuperacao (sem destaque)
"""
import itertools
import threading
import time


_MAX = 200                    # teto: descarta as mais antigas alem disso
_lock = threading.Lock()
_items = []                   # list[dict] — mais recentes no inicio
_seq = itertools.count(1)     # ids monotonicos

# Dedup de transicoes: se a ultima do mesmo (source, severity) ainda esta
# nao-lida, nao cria uma duplicata.
_last_key = {}                # {(source, severity): id}


def add(severity, source, title, detail=""):
    """Cria uma notificacao. Devolve o id (int) ou None se for deduplicada."""
    key = (source, severity)
    with _lock:
        last_id = _last_key.get(key)
        if (last_id is not None and _items
                and _items[0]["id"] == last_id
                and _items[0]["read_at"] is None):
            return None
        nid = next(_seq)
        _items.insert(0, {
            "id":         nid,
            "severity":   severity,
            "source":     source,
            "title":      title,
            "detail":     detail or "",
            "created_at": time.time(),
            "read_at":    None,
        })
        _last_key[key] = nid
        if len(_items) > _MAX:
            del _items[_MAX:]
        return nid


def list_unread():
    with _lock:
        return [dict(n) for n in _items if n["read_at"] is None]


def list_all(limit=50):
    with _lock:
        return [dict(n) for n in _items[:limit]]


def mark_read(nid):
    with _lock:
        for n in _items:
            if n["id"] == nid:
                if n["read_at"] is None:
                    n["read_at"] = time.time()
                return True
        return False


def unread_count():
    with _lock:
        return sum(1 for n in _items if n["read_at"] is None)
