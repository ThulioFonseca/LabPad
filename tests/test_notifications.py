"""Testes do store de notificacoes.

Valida: add, dedup, mark_read, list_unread, unread_count, teto de MAX itens.
"""
import importlib
import sys


def _fresh():
    """Reimporta o modulo para garantir estado limpo entre testes."""
    if "notifications" in sys.modules:
        del sys.modules["notifications"]
    return importlib.import_module("notifications")


def test_add_retorna_id():
    n = _fresh()
    nid = n.add("error", "weather", "Falha", "detalhe")
    assert isinstance(nid, int)
    assert nid > 0


def test_list_unread_retorna_item():
    n = _fresh()
    n.add("error", "calendar", "Falha agenda", "url invalida")
    items = n.list_unread()
    assert len(items) == 1
    assert items[0]["severity"] == "error"
    assert items[0]["source"] == "calendar"
    assert items[0]["read_at"] is None


def test_dedup_nao_cria_duplicata_enquanto_nao_lida():
    n = _fresh()
    id1 = n.add("error", "news", "Falha", "")
    id2 = n.add("error", "news", "Falha", "")
    assert id2 is None
    assert n.unread_count() == 1


def test_dedup_permite_nova_apos_lida():
    n = _fresh()
    id1 = n.add("error", "news", "Falha", "")
    n.mark_read(id1)
    id2 = n.add("error", "news", "Falha novamente", "")
    assert id2 is not None
    assert n.unread_count() == 1


def test_mark_read_remove_da_fila_unread():
    n = _fresh()
    nid = n.add("warning", "weather", "Degradado", "")
    assert n.unread_count() == 1
    result = n.mark_read(nid)
    assert result is True
    assert n.unread_count() == 0


def test_mark_read_id_inexistente_retorna_false():
    n = _fresh()
    assert n.mark_read(99999) is False


def test_severidades_distintas_sao_tratadas_independente():
    n = _fresh()
    n.add("error",   "weather", "Falha",    "")
    n.add("warning", "weather", "Alerta",   "")
    n.add("info",    "weather", "Info",     "")
    assert n.unread_count() == 3


def test_teto_max_descarta_mais_antigas():
    n = _fresh()
    n._MAX = 5
    for i in range(10):
        # fonte diferente a cada iteracao para nao deduplicar
        n.add("info", "src-%d" % i, "Titulo %d" % i, "")
    assert len(n._items) <= 5


def test_campos_obrigatorios_presentes():
    n = _fresh()
    nid = n.add("error", "calendar", "Titulo", "Detalhe longo")
    item = n.list_unread()[0]
    for campo in ("id", "severity", "source", "title", "detail", "created_at", "read_at"):
        assert campo in item, "campo '%s' ausente" % campo
    assert item["id"] == nid
    assert item["title"] == "Titulo"
    assert item["detail"] == "Detalhe longo"
