"""In-memory notification store. Thread-safe. No disk persistence
(restart clears the queue — suitable for an always-open dashboard).

Supported severities:
- 'error'   → integration failure (red highlight in UI)
- 'warning' → degradation (yellow highlight)
- 'info'    → general events, such as recovery (no highlight)
"""
import itertools
import threading
import time


_MAX = 200                    # cap: discard oldest items beyond this
_lock = threading.Lock()
_items = []                   # list[dict] — most recent first
_seq = itertools.count(1)     # monotonic ids

# Dedup on transitions: if the last notification from the same (source, severity)
# is still unread, don't create a duplicate.
_last_key = {}                # {(source, severity): id}


def add(severity, source, title, detail=""):
    """Create a notification. Returns the id (int) or None if deduplicated."""
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


def mark_all_read():
    """Mark every unread notification as read. Returns how many were cleared."""
    now = time.time()
    with _lock:
        cleared = 0
        for n in _items:
            if n["read_at"] is None:
                n["read_at"] = now
                cleared += 1
        return cleared


def unread_count():
    with _lock:
        return sum(1 for n in _items if n["read_at"] is None)
