#!/usr/bin/env python3
"""One-shot generator for LabPad's home-screen / favicon PNGs.

This is a *build-time authoring tool*, NOT part of the runtime. The dashboard
never imports it and CI never runs it — it exists only so the committed icons in
``static/`` are reproducible and reviewable (a bare binary that appears with no
recipe is worse than one you can regenerate and diff).

It deliberately has **no third-party dependencies** (no Pillow) — in keeping with
the project's "no build step, minimal deps" ethos it hand-rolls a tiny PNG
encoder and a supersampled software rasteriser using only the standard library.

The artwork is LabPad's own identity: the horizontal gauge bar-fills from the
dashboard cards, on the Minimal-dark surface. Colours are copied verbatim from
``static/css/theme.css`` so the icon matches the running app:

    page background  #14161b     (lifted to #1b1f28 at the top for depth)
    bar track        #262b35
    bar fill accent  #5b93ff

Regenerate with::

    python3 tools/make_icons.py

which rewrites ``static/apple-touch-icon.png`` (180x180) and
``static/favicon.png`` (32x32).
"""
import os
import struct
import zlib

# --- Palette (kept in sync with static/css/theme.css) ------------------------
BG_TOP = (0x1b, 0x1f, 0x28)   # subtle lift at the top for a little depth
BG_BOTTOM = (0x14, 0x16, 0x1b)  # true page background
TRACK = (0x26, 0x2b, 0x35)   # gauge bar track
FILL = (0x5b, 0x93, 0xff)    # accent blue — the default .bar-fill colour

SS = 4  # supersample factor: draw at Nx, box-downsample for anti-aliasing


def _lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _rounded_bar(px, w, x0, y0, bw, bh, colour):
    """Fill a horizontal pill (rounded rect, radius = bh/2) into buffer ``px``.

    ``px`` is a flat [r,g,b,...] bytearray of a ``w``-wide hi-res canvas. Hard
    edges here become smooth after the box downsample in :func:`_render`.
    """
    r = bh / 2.0
    cy = y0 + r
    left_c = x0 + r
    right_c = x0 + bw - r
    x_lo = int(x0)
    x_hi = int(x0 + bw)
    y_lo = int(y0)
    y_hi = int(y0 + bh)
    for y in range(y_lo, y_hi):
        for x in range(x_lo, x_hi):
            # Inside the flat middle, or inside one of the two end circles.
            if x < left_c:
                dx = x - left_c
                if dx * dx + (y - cy) * (y - cy) > r * r:
                    continue
            elif x > right_c:
                dx = x - right_c
                if dx * dx + (y - cy) * (y - cy) > r * r:
                    continue
            i = (y * w + x) * 3
            px[i] = colour[0]
            px[i + 1] = colour[1]
            px[i + 2] = colour[2]


def _render(size):
    """Render the icon at ``size`` px and return a flat RGB bytearray."""
    w = size * SS
    hi = bytearray(w * w * 3)

    # Vertical background gradient.
    for y in range(w):
        col = _lerp(BG_TOP, BG_BOTTOM, y / float(w - 1))
        row = y * w * 3
        for x in range(w):
            i = row + x * 3
            hi[i] = col[0]
            hi[i + 1] = col[1]
            hi[i + 2] = col[2]

    # Three gauge bars, proportional to the canvas so both sizes stay balanced.
    pad = 0.19 * w            # margin (leaves room for iOS's corner mask)
    bar_w = w - 2 * pad
    bar_h = 0.088 * w
    gap = 0.10 * w
    block_h = 3 * bar_h + 2 * gap
    y = (w - block_h) / 2.0
    # Fill fractions differ so it reads as live data, not a static logo.
    for frac in (0.62, 0.86, 0.44):
        _rounded_bar(hi, w, pad, y, bar_w, bar_h, TRACK)
        fill_w = max(bar_h, bar_w * frac)   # keep the pill shape at low fills
        _rounded_bar(hi, w, pad, y, fill_w, bar_h, FILL)
        y += bar_h + gap

    # Box-downsample SSxSS -> 1 for anti-aliasing.
    out = bytearray(size * size * 3)
    n = SS * SS
    for oy in range(size):
        for ox in range(size):
            r = g = b = 0
            for dy in range(SS):
                base = ((oy * SS + dy) * w + ox * SS) * 3
                for dx in range(SS):
                    j = base + dx * 3
                    r += hi[j]
                    g += hi[j + 1]
                    b += hi[j + 2]
            o = (oy * size + ox) * 3
            out[o] = r // n
            out[o + 1] = g // n
            out[o + 2] = b // n
    return out


def _png(size, rgb):
    """Encode a flat RGB bytearray as an 8-bit truecolour PNG."""
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    stride = size * 3
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None) for this scanline
        raw += rgb[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def main():
    static = os.path.join(os.path.dirname(__file__), "..", "static")
    targets = [
        ("apple-touch-icon.png", 180),  # iOS home-screen icon
        ("favicon.png", 32),            # desktop browser tab
    ]
    for name, size in targets:
        path = os.path.join(static, name)
        with open(path, "wb") as fh:
            fh.write(_png(size, _render(size)))
        print("wrote", os.path.normpath(path), "(%dx%d)" % (size, size))


if __name__ == "__main__":
    main()
