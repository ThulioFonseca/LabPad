"""Guardrail: the carousel headline must stay readable in every theme.

A news slide that has an image paints its text on top of the photo, over a
strong dark gradient (rgba(0,0,0,0.92) at the base, see .news-carousel-slide
::before in cards.css). The headline must therefore be LIGHT in every theme —
including the light ones, where the surrounding page text is near-black.

cards.css sets it white with `.news-carousel-slide .news-title` (specificity
0,2,0), but each theme sets `.theme-X.mode-Y .news-title` (0,3,0) in
themes.css, which loads later. The theme rule wins on both counts, so the
light themes repainted the headline near-black on a near-black gradient and
the text became unreadable.

This test resolves the real cascade (specificity, then source order across the
stylesheets in the order index.html loads them) and asserts the winner is a
light colour. A plain "does the file contain X" check would not catch a future
theme rule that silently out-specifies the override.
"""
import os
import re

import pytest

_STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
_CSS_DIR = os.path.join(_STATIC, "css")
_INDEX = os.path.join(_STATIC, "index.html")

_THEMES = ("minimal", "neu", "elevated", "outline", "glass")
_MODES = ("light", "dark")

_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.DOTALL)
_COLOR_DECL_RE = re.compile(r"(?:^|;)\s*color\s*:\s*([^;]+)", re.IGNORECASE)
_CLASS_RE = re.compile(r"\.([A-Za-z0-9_-]+)")
_NOT_RE = re.compile(r":not\(\s*\.([A-Za-z0-9_-]+)\s*\)")


def _load_order():
    """Stylesheets in the order index.html links them — order breaks ties."""
    with open(_INDEX, encoding="utf-8") as fh:
        html = fh.read()
    return re.findall(r'href="css/([^"]+\.css)"', html)


def _compound(part):
    """Parse one compound selector into (classes, negated_classes)."""
    negated = set(_NOT_RE.findall(part))
    stripped = _NOT_RE.sub("", part)
    return set(_CLASS_RE.findall(stripped)), negated


def _matches(selector, chain):
    """True if a descendant selector matches the element at the end of chain.

    `chain` is a list of class-sets from the root down to the target element.
    Only descendant combinators and class selectors are supported, which is
    all this stylesheet uses for these rules.
    """
    if any(c in selector for c in (">", "+", "~", "[", "#")):
        return False
    parts = selector.split()
    if not parts:
        return False

    target_classes, target_negated = _compound(parts[-1])
    if not target_classes <= chain[-1] or target_negated & chain[-1]:
        return False

    # Remaining parts must match ancestors, in order.
    idx = len(chain) - 2
    for part in reversed(parts[:-1]):
        classes, negated = _compound(part)
        while idx >= 0:
            if classes <= chain[idx] and not (negated & chain[idx]):
                idx -= 1
                break
            idx -= 1
        else:
            return False
    return True


def _specificity(selector):
    """(ids, classes, elements) — :not() contributes its argument."""
    ids = selector.count("#")
    classes = len(_CLASS_RE.findall(selector))
    return (ids, classes, 0)


def _rules():
    """Every (order, selector, color) declaration, in stylesheet load order."""
    out = []
    order = 0
    for name in _load_order():
        path = os.path.join(_CSS_DIR, name)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            css = _COMMENT_RE.sub("", fh.read())
        # Drop @media blocks: the wall display is well above any breakpoint.
        css = re.sub(r"@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}", "", css)
        for selectors, body in _RULE_RE.findall(css):
            match = _COLOR_DECL_RE.search(body)
            if not match:
                continue
            color = match.group(1).strip()
            for selector in selectors.split(","):
                selector = selector.strip()
                if selector:
                    order += 1
                    out.append((order, selector, color))
    return out


def _resolve_color(chain):
    """Winning `color` for the element at the end of chain."""
    winner = None
    for order, selector, color in _rules():
        if not _matches(selector, chain):
            continue
        key = _specificity(selector) + (order,)
        if winner is None or key > winner[0]:
            winner = (key, color, selector)
    return winner


def _luminance(color):
    color = color.strip().lower()
    if color.startswith("#"):
        hexpart = color[1:]
        if len(hexpart) == 3:
            hexpart = "".join(ch * 2 for ch in hexpart)
        r, g, b = (int(hexpart[i:i + 2], 16) for i in (0, 2, 4))
    elif color.startswith("rgb"):
        nums = re.findall(r"[\d.]+", color)
        r, g, b = (float(n) for n in nums[:3])
    else:
        pytest.fail("unsupported colour literal in stylesheet: %r" % color)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


@pytest.mark.parametrize("text_class", ("news-title", "news-age"))
@pytest.mark.parametrize("theme", _THEMES)
@pytest.mark.parametrize("mode", _MODES)
def test_carousel_headline_over_a_photo_is_light_in_every_theme(theme, mode,
                                                                text_class):
    chain = [
        {"theme-" + theme, "mode-" + mode},   # <html>/<body>
        {"news-carousel-slide", "news-item"},  # slide WITH an image
        {"news-carousel-text"},
        {text_class},
    ]

    winner = _resolve_color(chain)

    assert winner is not None, "no rule sets a colour for the carousel headline"
    _key, color, selector = winner
    assert _luminance(color) > 0.5, (
        "theme-%s.mode-%s paints the carousel headline %s (via `%s`), but that "
        "text sits on the dark photo gradient — it is unreadable. The slide's "
        "white rule must out-specify the per-theme .news-title rule."
        % (theme, mode, color, selector)
    )


@pytest.mark.parametrize("theme", _THEMES)
def test_slide_without_an_image_still_follows_the_light_theme_text_colour(theme):
    """The no-image slide has no gradient, so it must NOT be forced white —
    otherwise it turns white-on-white in the light themes."""
    chain = [
        {"theme-" + theme, "mode-light"},
        {"news-carousel-slide", "news-carousel-slide--no-image", "news-item"},
        {"news-carousel-text"},
        {"news-title"},
    ]

    winner = _resolve_color(chain)

    assert winner is not None
    _key, color, selector = winner
    if color.strip().lower() == "inherit":
        return   # inherits the themed panel colour, which is correct
    assert _luminance(color) < 0.5, (
        "theme-%s.mode-light paints the image-less carousel headline %s (via "
        "`%s`) — that slide has no dark gradient, so a light colour is "
        "invisible on the light panel." % (theme, color, selector)
    )
