"""Guardrail for the iPad 2 / Safari 9 compatibility contract.

LabPad's single non-negotiable constraint is that everything under ``static/``
must keep running **indefinitely on an iPad 2 (iOS 9.3.5 / Safari 9)** — see
CLAUDE.md. Historically the rules below were enforced *only* by human review
(the pre-commit checklist in CLAUDE.md), and breaking one of them has crashed
the real device more than once (e.g. commit ``6177104`` — a perpetual CSS
animation leaked GPU memory until Safari killed the tab).

This module turns the highest-confidence, statically-checkable parts of that
contract into a test that runs in CI, so a regression fails the build instead of
reaching the wall display. It is a pure-Python static scanner: **no new
dependencies, no Node, no build step** — in keeping with the project's ethos.

Detection is deliberately conservative. Comments and quoted strings are blanked
out before scanning (line numbers preserved), so the checks only fire on real
source syntax. When in doubt the scanner errs toward *missing* a violation
rather than raising a false alarm — a guardrail that cries wolf is worse than
none.

What is enforced here (see CLAUDE.md "The iPad 2 Compatibility Contract"):

JavaScript (``static/js/*.js``) — ES5 only:
  - no arrow functions (``=>``)
  - no ``const`` / ``let``
  - no template literals (backtick strings)
  - no ``async`` / ``await``
  - no ``class`` declarations
  - no ``Promise`` / ``new Map`` / ``new Set``
  - no ``fetch(`` — HTTP goes through ``getJSON()`` over ``XMLHttpRequest``

CSS (``static/css/*.css``) — Flexbox only, no perpetual motion:
  - no CSS custom properties (``--x`` / ``var(--x)``)
  - no ``backdrop-filter``
  - no CSS Grid (``display: grid`` / ``grid-template-*``)
  - no perpetual (``infinite``) animations, except the documented, iPad-safe
    exceptions in ``_INFINITE_ANIMATION_ALLOWLIST``
"""
import os
import re

import pytest

_STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
_JS_DIR = os.path.join(_STATIC, "js")
_CSS_DIR = os.path.join(_STATIC, "css")


# --- Files allowed to contain a perpetual (`infinite`) CSS animation ---------
# The contract bans indefinitely-running composited animations because they keep
# a GPU layer alive forever and slowly leak memory on iOS 9.3.5. The two entries
# below are the *documented, reviewed* exceptions — each is safe for a specific,
# verifiable reason. Adding a new file here must be a conscious decision.
_INFINITE_ANIMATION_ALLOWLIST = {
    # The skeleton shimmer is the only exception named in CLAUDE.md: its element
    # is removed from the DOM the moment real data loads, so the animation never
    # runs for long.
    "skeleton.css": "skeleton shimmer — element is removed from the DOM the "
                    "moment real data loads",
    # The forecast marquee is scoped to `@media (max-width: 600px)`, i.e. phones.
    # The iPad 2 viewport is >= 768px, so this animation never runs on the target
    # device; on the desktop/tablet layout the duplicate is hidden and the track
    # is static.
    "weather.css": "forecast marquee is scoped to @media (max-width: 600px) — "
                   "phones only, never the >=768px iPad 2",
}


def _read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def _list(directory, ext):
    if not os.path.isdir(directory):
        return []
    return sorted(
        os.path.join(directory, name)
        for name in os.listdir(directory)
        if name.endswith(ext)
    )


def _blank(match_text):
    """Replace every non-newline char with a space (keeps line/column offsets)."""
    return re.sub(r"[^\n]", " ", match_text)


def _blank_block_comments(text):
    """Blank ``/* ... */`` comments (JS and CSS), preserving newlines."""
    return re.sub(r"/\*.*?\*/", lambda m: _blank(m.group(0)), text, flags=re.S)


def _blank_line_comments(text):
    """Blank ``// ...`` comments to end of line.

    Skips ``//`` that is part of a URL scheme (``://``) so an ``http://`` inside
    a string isn't mistaken for a comment. Only ever removes text, so at worst it
    hides a violation — it can never invent one.
    """
    out = []
    for line in text.split("\n"):
        m = re.search(r"(?<!:)//", line)
        if m:
            line = line[: m.start()] + " " * (len(line) - m.start())
        out.append(line)
    return "\n".join(out)


def _blank_quoted_strings(text):
    """Blank the interior of ``'...'`` and ``"..."`` strings (keep the quotes).

    Prevents keywords that legitimately appear inside string literals (e.g. an
    attribute name ``'class'``) from being read as source syntax. Backtick
    strings are intentionally left untouched — detecting them is the point.
    """
    def repl(m):
        s = m.group(0)
        return s[0] + " " * (len(s) - 2) + s[-1]

    text = re.sub(r"'(?:\\.|[^'\\\n])*'", repl, text)
    text = re.sub(r'"(?:\\.|[^"\\\n])*"', repl, text)
    return text


def _sanitize_js(text):
    text = _blank_block_comments(text)
    text = _blank_line_comments(text)
    text = _blank_quoted_strings(text)
    return text


def _sanitize_css(text):
    # CSS has no `//` line comments; only block comments.
    return _blank_block_comments(text)


# --- Rule tables -------------------------------------------------------------
# Each rule: (human label, compiled regex). A match on a sanitized line is a
# violation reported as "<file>:<line>".

_JS_RULES = [
    ("arrow function (`=>`) — use `function`", re.compile(r"=>")),
    ("`const`/`let` — use `var`", re.compile(r"\b(?:const|let)\b")),
    ("template literal (backtick) — use string concatenation",
     re.compile(r"`")),
    ("`async`/`await` — not supported on Safari 9",
     re.compile(r"\b(?:async|await)\b")),
    ("`class` declaration — use `function`/prototype",
     re.compile(r"\bclass\s+[A-Za-z_$]|\bclass\s*\{")),
    ("`Promise` — not supported on Safari 9", re.compile(r"\bPromise\b")),
    ("`new Map`/`new Set` — not supported on Safari 9",
     re.compile(r"\bnew\s+(?:Map|Set|WeakMap|WeakSet)\b")),
    ("`fetch(` — use `getJSON()` over XMLHttpRequest",
     re.compile(r"\bfetch\s*\(")),
]

_CSS_RULES = [
    ("CSS custom property `var(--x)` — hard-code the value",
     re.compile(r"var\(\s*--")),
    ("CSS custom property declaration `--x:` — hard-code the value",
     re.compile(r"(?:^|[{;])\s*--[A-Za-z][\w-]*\s*:")),
    ("`backdrop-filter` — unreliable on Safari 9",
     re.compile(r"backdrop-filter\s*:")),
    ("CSS Grid — layout must be Flexbox",
     re.compile(r"display\s*:\s*(?:inline-)?grid\b|\bgrid-template|\bgrid-auto")),
]

# Perpetual-animation check is handled separately so it can honor the allowlist.
_INFINITE_RE = re.compile(r"\binfinite\b")


def _scan(files, rules, sanitize):
    """Return a list of 'file:line  ->  label  |  <snippet>' violation strings."""
    violations = []
    for path in files:
        raw_lines = _read(path).split("\n")
        clean_lines = sanitize(_read(path)).split("\n")
        rel = os.path.basename(path)
        for idx, line in enumerate(clean_lines):
            for label, rx in rules:
                if rx.search(line):
                    snippet = raw_lines[idx].strip()[:100]
                    violations.append(
                        "%s:%d  ->  %s  |  %s" % (rel, idx + 1, label, snippet)
                    )
    return violations


def test_js_is_es5_only():
    """No ES6+ syntax anywhere under static/js/ (Safari 9 runs the files as-is)."""
    files = _list(_JS_DIR, ".js")
    assert files, "no JS files found under static/js/ — test wired up wrong?"
    violations = _scan(files, _JS_RULES, _sanitize_js)
    assert not violations, (
        "ES6+ syntax found in static/js/ — the iPad 2 runs these files verbatim "
        "on Safari 9 (see CLAUDE.md, ES5-only rule):\n  " + "\n  ".join(violations)
    )


def test_css_is_safari9_safe():
    """No CSS variables, backdrop-filter, or Grid under static/css/."""
    files = _list(_CSS_DIR, ".css")
    assert files, "no CSS files found under static/css/ — test wired up wrong?"
    violations = _scan(files, _CSS_RULES, _sanitize_css)
    assert not violations, (
        "Safari-9-incompatible CSS found (see CLAUDE.md, Flexbox-only rule):\n  "
        + "\n  ".join(violations)
    )


def test_no_unapproved_perpetual_animations():
    """No `infinite` CSS animation outside the documented, iPad-safe allowlist.

    Perpetual composited animations keep a GPU layer alive forever and slowly
    leak memory on iOS 9.3.5 until Safari kills the tab (crash history in
    CLAUDE.md, commit 6177104). Any new one must be justified and added to
    ``_INFINITE_ANIMATION_ALLOWLIST`` with a reason.
    """
    violations = []
    for path in _list(_CSS_DIR, ".css"):
        rel = os.path.basename(path)
        if rel in _INFINITE_ANIMATION_ALLOWLIST:
            continue
        raw_lines = _read(path).split("\n")
        clean_lines = _sanitize_css(_read(path)).split("\n")
        for idx, line in enumerate(clean_lines):
            if _INFINITE_RE.search(line):
                violations.append(
                    "%s:%d  |  %s" % (rel, idx + 1, raw_lines[idx].strip()[:100])
                )
    assert not violations, (
        "Perpetual `infinite` animation found outside the allowlist — this is "
        "the exact class of change that has crashed the iPad 2 (CLAUDE.md crash "
        "history). If it is genuinely iPad-safe, add the file to "
        "_INFINITE_ANIMATION_ALLOWLIST with a reason:\n  " + "\n  ".join(violations)
    )


def test_infinite_allowlist_entries_still_exist():
    """Keep the allowlist honest: every entry must name a real file that still
    contains an `infinite` animation. Prevents the allowlist from silently
    accumulating dead exceptions after a refactor."""
    stale = []
    for name in _INFINITE_ANIMATION_ALLOWLIST:
        path = os.path.join(_CSS_DIR, name)
        if not os.path.isfile(path):
            stale.append("%s (file missing)" % name)
        elif not _INFINITE_RE.search(_sanitize_css(_read(path))):
            stale.append("%s (no `infinite` animation left)" % name)
    assert not stale, (
        "Stale entries in _INFINITE_ANIMATION_ALLOWLIST — remove them:\n  "
        + "\n  ".join(stale)
    )


_IMAGE_ASSIGN_RE = re.compile(r'(?:\.backgroundImage|\.src)\s*=')


def test_remote_images_go_through_the_downscaling_proxy():
    """No feed image may be handed to the browser at its source resolution.

    Safari 9 decodes a CSS background (and an <img>) at the SOURCE resolution,
    so the display box does not bound the memory. A measured news feed carried
    ten press photos totalling ~200 MB once decoded — one of them 7086x4724
    (127 MB on its own) behind a 52x52 thumbnail — which exhausted the iPad 2's
    512 MB and got the tab killed within seconds.

    Every image assignment must therefore route through ``proxiedImage()``,
    which points at /api/image and re-encodes to the drawn size.
    """
    violations = []
    for path in _list(_JS_DIR, ".js"):
        rel = os.path.basename(path)
        raw_lines = _read(path).splitlines()
        clean_lines = _sanitize_js("\n".join(raw_lines)).splitlines()
        for idx, line in enumerate(clean_lines):
            if _IMAGE_ASSIGN_RE.search(line) and "proxiedImage(" not in line:
                violations.append(
                    "%s:%d  ->  %s" % (rel, idx + 1, raw_lines[idx].strip()[:100])
                )
    assert not violations, (
        "Image assigned without the downscaling proxy — this is the crash that "
        "killed Safari on the iPad 2 in seconds. Wrap the URL in "
        "proxiedImage(url, width):\n  " + "\n  ".join(violations)
    )


def test_getjson_settles_its_callback_exactly_once():
    """A single failed request must invoke the getJSON callback only once.

    Safari 9 dispatches BOTH the readystatechange to DONE (readyState 4,
    status 0) AND the dedicated ``ontimeout`` / ``onerror`` event when a request
    times out or fails at the network layer — so a naive wrapper fires its
    callback twice per failure. dashboard.js's ``poll()`` and ``pollFeeds()``
    reschedule themselves from their error handler, so a double error there
    spawns a SECOND parallel polling loop that never goes away: every later
    failure doubles the request rate and leaks timers until Safari kills the tab
    over the display's long uptime — the same per-loop growth CLAUDE.md guards
    against. ``getJSON`` must therefore collapse each request to a single
    onOk/onErr via a settle-once guard, and must not read status 0 as an HTTP
    response (that is the duplicate path).
    """
    src = _sanitize_js(_read(os.path.join(_JS_DIR, "xhr.js")))
    missing = []
    if not re.search(r"\bsettled\b", src):
        missing.append("a `settled` guard flag")
    if not re.search(r"if\s*\(\s*settled\s*\)", src):
        missing.append("an `if (settled) return` short-circuit before the callback")
    if not re.search(r"\bfail\s*\(", src):
        missing.append("a guarded fail() helper for the error handlers")
    if not (re.search(r"\bontimeout\s*=", src) and re.search(r"\bonerror\s*=", src)):
        missing.append("dedicated ontimeout/onerror handlers")
    if not re.search(r"\bstatus\s*===?\s*0\b", src):
        missing.append("a `status === 0` skip so timeout/network errors don't "
                       "double-fire through readystatechange")
    assert not missing, (
        "getJSON lost its single-settle protection — a timeout or network error "
        "will fire the callback twice and can spawn duplicate polling loops on "
        "the iPad 2. Missing:\n  " + "\n  ".join(missing)
    )


if __name__ == "__main__":  # allow `python tests/test_frontend_contract.py`
    raise SystemExit(pytest.main([__file__, "-v"]))
