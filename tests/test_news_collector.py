"""Tests for the news collector.

Feeds are parsed by feedparser from bytes; here we feed real RSS/Atom XML
through a stubbed HTTP fetch (no network). The focus is the ordering
guarantee: the dashboard shows only the first `limit` items, so the
collector must return the *newest* items regardless of the feed's own order.
"""
import types

import pytest

from collectors import news


def _stub_fetch(monkeypatch, xml):
    """Make news._http_fetch return an object whose .content is `xml`."""
    resp = types.SimpleNamespace(content=xml.encode("utf-8"))
    monkeypatch.setattr(news, "_http_fetch", lambda *a, **kw: resp)


def _stub_settings(monkeypatch, limit=5):
    def _get(section, key, default=None):
        if key == "url":
            return "https://example.com/rss"
        if key == "limit":
            return limit
        return default
    monkeypatch.setattr("settings.get", _get, raising=False)


def _rss(items):
    """Build a minimal RSS document. `items` is a list of (title, pubDate)."""
    body = "".join(
        "<item><title>%s</title><link>https://ex/%s</link>"
        "<pubDate>%s</pubDate></item>" % (t, t, d)
        for t, d in items
    )
    return ('<?xml version="1.0"?><rss version="2.0"><channel>'
            '<title>Example</title>' + body + '</channel></rss>')


def test_unconfigured_returns_empty(monkeypatch):
    monkeypatch.setattr("settings.get", lambda *a, **kw: "", raising=False)
    result = news.collect()
    assert result == {"items": [], "configured": False}


def test_orders_newest_first_when_feed_is_oldest_first(monkeypatch):
    # Feed deliberately ordered OLDEST-first — the raw slice would show the
    # two oldest headlines; the collector must surface the two newest.
    _stub_settings(monkeypatch, limit=2)
    _stub_fetch(monkeypatch, _rss([
        ("oldest",  "Mon, 01 Jan 2024 08:00:00 GMT"),
        ("middle",  "Tue, 02 Jan 2024 08:00:00 GMT"),
        ("newest",  "Wed, 03 Jan 2024 08:00:00 GMT"),
    ]))
    result = news.collect()
    titles = [i["title"] for i in result["items"]]
    assert titles == ["newest", "middle"]


def test_already_newest_first_is_preserved(monkeypatch):
    _stub_settings(monkeypatch, limit=3)
    _stub_fetch(monkeypatch, _rss([
        ("a", "Wed, 03 Jan 2024 08:00:00 GMT"),
        ("b", "Tue, 02 Jan 2024 08:00:00 GMT"),
        ("c", "Mon, 01 Jan 2024 08:00:00 GMT"),
    ]))
    result = news.collect()
    assert [i["title"] for i in result["items"]] == ["a", "b", "c"]


def test_undated_entries_keep_feed_order_and_sink_below_dated(monkeypatch):
    # Two undated items surround a dated one. Dated must come first; the
    # undated ones must keep their original relative order after it.
    _stub_settings(monkeypatch, limit=5)
    xml = ('<?xml version="1.0"?><rss version="2.0"><channel><title>Ex</title>'
           '<item><title>no-date-1</title><link>https://ex/1</link></item>'
           '<item><title>dated</title><link>https://ex/2</link>'
           '<pubDate>Wed, 03 Jan 2024 08:00:00 GMT</pubDate></item>'
           '<item><title>no-date-2</title><link>https://ex/3</link></item>'
           '</channel></rss>')
    _stub_fetch(monkeypatch, xml)
    result = news.collect()
    assert [i["title"] for i in result["items"]] == ["dated", "no-date-1", "no-date-2"]


def test_limit_is_applied_after_sorting(monkeypatch):
    _stub_settings(monkeypatch, limit=1)
    _stub_fetch(monkeypatch, _rss([
        ("old", "Mon, 01 Jan 2024 08:00:00 GMT"),
        ("new", "Fri, 05 Jan 2024 08:00:00 GMT"),
    ]))
    result = news.collect()
    assert [i["title"] for i in result["items"]] == ["new"]


def test_empty_feed_returns_configured_with_no_items(monkeypatch):
    _stub_settings(monkeypatch, limit=5)
    _stub_fetch(monkeypatch,
                '<?xml version="1.0"?><rss version="2.0"><channel>'
                '<title>Ex</title></channel></rss>')
    result = news.collect()
    assert result["configured"] is True
    assert result["items"] == []
