# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository.

LabPad is a homelab dashboard with **one hard, non-negotiable constraint**: it must
run **indefinitely as an always-on wall display on an iPad 2 (iOS 9.3.5 / Safari 9)** —
2012 hardware with 512 MB of RAM. Almost every rule below exists because breaking it
crashed that device over long uptime. **When a change conflicts with iPad 2
compatibility, compatibility wins.**

---

## Project overview

- **Backend** — Python 3.12 (runtime image; CI tests on 3.11) + Flask. Collectors under
  `backend/collectors/` gather host metrics (`psutil`), Docker stats, and external
  feeds (calendar/news/weather). Entry point: `backend/app.py`. Port **8723**.
- **Frontend** — hand-written **ES5 + Flexbox**, served **as-is from `static/`**.
  **There is no build step**: no Babel, no bundler, no TypeScript, no SASS. What you
  write is what the iPad runs.
- **Run it** — `docker compose up -d --build`, then `http://HOST-IP:8723`.
  Local (no container): `HOST_ROOT=/ HOST_HOSTNAME_FILE=/etc/hostname python backend/app.py`.
- **Tests** — `pytest` (suite in `tests/`).

---

## ⚠️ The iPad 2 Compatibility Contract — READ FIRST

Every rule here is enforced somewhere in the code and documented in comments. Do not
regress any of them in `static/`.

### JavaScript — ES5 only

- **No ES6+ syntax.** No arrow functions, `const`/`let`, template literals, `class`,
  destructuring, spread, default params, `Promise`, `async/await`, `Map`/`Set`.
  Use `var` and `function` only. Applies to every file in `static/js/`.
- **No `fetch()`.** Safari 9 doesn't have it. All HTTP goes through the `getJSON()`
  wrapper over `XMLHttpRequest` in `static/js/xhr.js`.

### CSS — Flexbox only

- **No CSS Grid.** Layout is Flexbox with `-webkit-` prefixes (`static/css/base.css`).
- **No CSS variables** (`--x`) and **no `backdrop-filter`.** Safari 9 support is
  missing/unreliable, so all colors and spacing are hard-coded
  (`static/css/theme.css`, `themes.css`, `motion.css`).
- **Vendor-prefix everything.** All `transform`, `transition`, `box-shadow`, `flex`,
  `animation` declarations need both the `-webkit-` and the standard form.
- **Progress bars fill via `transform: scaleX()`, never `width`.** Animating `width`
  forces layout + paint every frame on many bars each cycle. See `.bar-fill` in
  `static/css/cards.css` and `setBarFill()` in `static/js/format.js`.

### No perpetual animations (this is the big one)

An indefinitely-running composited animation (transform/opacity, `infinite`) keeps a
GPU layer alive forever and **slowly leaks memory on iOS 9.3.5 until Safari kills the
tab after hours.**

- **All animations must be one-shot or bounded.** See the header comment and the
  "Live status dot" note in `static/css/motion.css`. The "connected" cue is a static
  green fill + `box-shadow` glow (`theme.css`), not an animation.
- The **only** allowed `infinite` animation is the skeleton shimmer
  (`static/css/skeleton.css`) — acceptable because its element is removed from the DOM
  the moment real data loads.
- The `labpad-pulse` status-dot animation was removed for exactly this reason
  (commit `6177104`). Do not reintroduce a "breathing"/pulsing effect.

### iOS-specific UI workarounds

- **Scrollable feed-list heights are set in raw pixels via JS, not flex.** Safari 9
  doesn't treat a flex-computed height as "defined" for `overflow-y` scrolling, so
  `sizeFeedLists()` in `static/js/dashboard.js` measures the viewport and sets
  `style.height` in pixels (below the 601px breakpoint it clears the height for a
  single-column global scroll).
- **`-webkit-overflow-scrolling: touch`** on any scrollable container for momentum
  scrolling (`static/css/modals.css`).
- **Modal scroll-lock** uses `position:fixed` + negative `top` on `<body>`, restoring
  the scroll position on close — the bulletproof iOS pattern in `static/js/modals.js`
  and `static/css/base.css` (`body.scroll-locked`).

---

## Long-uptime stability rules (the crash lessons)

The dashboard is on 24/7 and `render()` runs every 5 s. Sustained allocation, reflow,
or bitmap churn per cycle exhausts the iPad's memory and kills the tab after hours.

- **Only render hidden UI while it's visible.** Modal bodies (system / containers /
  disk) are hidden ~99% of the time — rebuilding their DOM every 5 s was the biggest
  source of GC churn. `render()` in `dashboard.js` only refreshes a modal body when
  its modal is open, and each modal renders once on open from the cached `lastData`
  (commit `f56345d`).
- **Guard reflows.** `maybeSizeFeedLists()` caches the host panel height
  (`lastHostPanelH`) and only reruns the expensive read+write sizing pass when it
  actually changed.
- **Guard canvas reallocation.** Assigning `canvas.width`/`height` reallocates the
  backing bitmap even when the value is unchanged. `sizeCanvas()` only assigns on a
  real change.
- **Align timers to human-perceptible boundaries.** The clock shows `HH:MM`, so
  `tickClock()` reschedules to just after the next minute boundary instead of waking
  every second — this lets the iPad CPU idle.
- **Prefer self-rescheduling `setTimeout` over `setInterval`,** so timers can be
  cancelled/replaced when data sources change (e.g. the feeds timer).

### Crash history (don't repeat these)

| Commit | Symptom | Root cause | Fix |
|--------|---------|-----------|-----|
| `6177104` | Tab crashed after hours | Infinite CSS pulse animation leaked GPU memory | Removed `labpad-pulse`; static glow instead |
| `f56345d` | Crashed after a few hours | Rebuilding 3 hidden modal bodies + reflow every 5 s | Render modals only while open; guard reflow/canvas |
| `4b7d3ca` | Info button refreshed the whole page | Click landed on nested `<svg>`, not the button | Walk the DOM up to the target before acting |

---

## Architecture

- **Backend** — `backend/app.py` (Flask routes + `/api/metrics`, `/api/feeds`,
  `/api/settings`, `/api/notifications`, `/api/health`), `config.py` (env defaults:
  port, paths, TTLs), `settings.py` (mutable store → `/data/settings.json`),
  `notifications.py` (in-memory queue), `net_guard.py` (SSRF/URL validation).
  Collectors in `backend/collectors/` each own one data source and degrade gracefully
  when unavailable.
- **Frontend (declarative)** — `static/config.js` defines the `widgets` array;
  `static/js/dashboard.js` orchestrates polling and rendering; `widgets-host.js`,
  `widgets-containers.js`, `widgets-feeds.js`, `widgets-weather.js` render sections.
  Adding a metric is usually a one-line edit to `config.js`.
- **Polling** — metrics every 5 s, feeds every 10 min (backend caches + backs off).
- **Storage** — appearance settings in browser `localStorage` (key `labpad.settings`);
  data-source/system settings server-side in `/data/settings.json` (Docker volume).
- **Docker** — runs with `pid: host` + `network_mode: host` so `psutil` reads real host
  hardware; host mounts are read-only.

---

## Working in this repo

- **No frontend build.** Edit `static/` files directly; they're served with
  `Cache-Control: no-store`. Mount `./static:/app/static:ro` to iterate without
  rebuilding the image.
- **Backend changes** — keep collectors self-contained and degrade gracefully; run
  `pytest`.
- **Comments carry the *why*.** Many constraints live only in code comments — read
  them before changing the code, and preserve them. PT-BR comments exist and are fine;
  match the surrounding ES5 style.
- **Verify on Safari 9** (or the closest device available) for any `static/` change.

---

## Pre-commit checklist for any change under `static/`

- [ ] No ES6+ syntax (no arrow functions, `const`/`let`, template literals, `class`,
      destructuring, spread, `Promise`, `async/await`)
- [ ] `XMLHttpRequest` via `getJSON()` — never `fetch()`
- [ ] No CSS variables, no `backdrop-filter`, no CSS Grid — Flexbox only
- [ ] `-webkit-` prefix on every transform / transition / shadow / flex / animation
- [ ] No infinite/perpetual animations (skeleton shimmer is the only exception)
- [ ] Progress bars use `transform: scaleX()`, not `width`
- [ ] Canvas `width`/`height` assigned only when the value changed
- [ ] Hidden modal bodies rendered only while their modal is open
- [ ] Feed-list heights set in pixels via JS, not flex
- [ ] Scrollable containers have `-webkit-overflow-scrolling: touch`
- [ ] Timers aligned to human-perceptible boundaries where possible
- [ ] Nested interactive elements stop propagation / check the click target
- [ ] Existing "why" comments preserved
