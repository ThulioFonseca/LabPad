"""Tests for the notification store.

Validates: add, dedup, mark_read, list_unread, unread_count, MAX item cap.
"""
import importlib
import sys


def _fresh():
    """Re-import the module to guarantee a clean state between tests."""
    if "notifications" in sys.modules:
        del sys.modules["notifications"]
    return importlib.import_module("notifications")


def test_add_retorna_id():
    n = _fresh()
    nid = n.add("error", "weather", "Failure", "detail")
    assert isinstance(nid, int)
    assert nid > 0


def test_list_unread_retorna_item():
    n = _fresh()
    n.add("error", "calendar", "Calendar failure", "invalid url")
    items = n.list_unread()
    assert len(items) == 1
    assert items[0]["severity"] == "error"
    assert items[0]["source"] == "calendar"
    assert items[0]["read_at"] is None


def test_dedup_nao_cria_duplicata_enquanto_nao_lida():
    n = _fresh()
    id1 = n.add("error", "news", "Failure", "")
    id2 = n.add("error", "news", "Failure", "")
    assert id2 is None
    assert n.unread_count() == 1


def test_dedup_permite_nova_apos_lida():
    n = _fresh()
    id1 = n.add("error", "news", "Failure", "")
    n.mark_read(id1)
    id2 = n.add("error", "news", "Failure again", "")
    assert id2 is not None
    assert n.unread_count() == 1


def test_mark_read_remove_da_fila_unread():
    n = _fresh()
    nid = n.add("warning", "weather", "Degraded", "")
    assert n.unread_count() == 1
    result = n.mark_read(nid)
    assert result is True
    assert n.unread_count() == 0


def test_mark_read_id_inexistente_retorna_false():
    n = _fresh()
    assert n.mark_read(99999) is False


def test_severidades_distintas_sao_tratadas_independente():
    n = _fresh()
    n.add("error",   "weather", "Failure", "")
    n.add("warning", "weather", "Alert",   "")
    n.add("info",    "weather", "Info",    "")
    assert n.unread_count() == 3


def test_teto_max_descarta_mais_antigas():
    n = _fresh()
    n._MAX = 5
    for i in range(10):
        # different source each iteration to avoid deduplication
        n.add("info", "src-%d" % i, "Title %d" % i, "")
    assert len(n._items) <= 5


def test_mark_all_read_limpa_todas_e_retorna_contagem():
    n = _fresh()
    n.add("error",   "weather",  "Failure", "")
    n.add("warning", "calendar", "Alert",   "")
    n.add("info",    "news",     "Info",    "")
    assert n.unread_count() == 3
    cleared = n.mark_all_read()
    assert cleared == 3
    assert n.unread_count() == 0
    assert n.list_unread() == []


def test_mark_all_read_sem_nao_lidas_retorna_zero():
    n = _fresh()
    assert n.mark_all_read() == 0


def test_mark_all_read_nao_afeta_ja_lidas():
    n = _fresh()
    id1 = n.add("error", "weather",  "Failure", "")
    n.add("warning",     "calendar", "Alert",   "")
    n.mark_read(id1)               # one already read
    cleared = n.mark_all_read()    # should only clear the remaining unread one
    assert cleared == 1
    assert n.unread_count() == 0


def test_campos_obrigatorios_presentes():
    n = _fresh()
    nid = n.add("error", "calendar", "Title", "Long detail")
    item = n.list_unread()[0]
    for field in ("id", "severity", "source", "title", "detail", "created_at", "read_at"):
        assert field in item, "field '%s' missing" % field
    assert item["id"] == nid
    assert item["title"] == "Title"
    assert item["detail"] == "Long detail"
