<div align="center">

# LabPad

### A real-time homelab dashboard built to run *forever* on a 2012 iPad 2.

Near real-time Ubuntu host & Docker metrics, plus calendar, news, and weather —
served as a hand-crafted page that runs on **Safari 9 / iOS 9.3.5** with no
frameworks, no `fetch`, no CSS Grid, and **no build step**.

[![CI](https://github.com/ThulioFonseca/LabPad/actions/workflows/ci.yml/badge.svg)](https://github.com/ThulioFonseca/LabPad/actions/workflows/ci.yml)
[![Docker](https://github.com/ThulioFonseca/LabPad/actions/workflows/docker.yml/badge.svg)](https://github.com/ThulioFonseca/LabPad/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runs on iOS 9.3.5](https://img.shields.io/badge/runs%20on-iOS%209.3.5-black?logo=safari&logoColor=white)](CLAUDE.md)
[![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)](requirements.txt)
[![No build step](https://img.shields.io/badge/frontend-no%20build%20step-success)](CLAUDE.md)

</div>

<!--
  Add real screenshots at docs/screenshots/ and they will render below.
  Suggested captures: dashboard.png (full board on iPad), themes.png (theme grid),
  settings.png (settings panel). Until then the ASCII mockup stands in.
-->
<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="LabPad dashboard on an iPad 2 wall display" width="720">
  <br>
  <em>Screenshot placeholder — drop your capture at <code>docs/screenshots/dashboard.png</code>.</em>
</p>

```
┌───────────────────────────────────────────────┐
│ LabPad         ☀ 24°C · 60%       ● online 14:22│
├───────────────────────────────────────────────┤
│ HOST   ubuntu · up 6d · load 0.4 · 8 cores     │
│ ┌ CPU ┐ ┌ Memory ┐ ┌ Disk ┐ ┌ Temp ┐         │
│ ┌ Network ──────────┐ ┌ Docker ────────┐      │
│ CALENDAR            NEWS                      │
│ Today 14:00 Meeting ▦ News headline 1         │
│ CONTAINERS  (3 / 4 running)                   │
│ ● nginx     CPU 0.4%  RAM 28 MB   up         │
│ ● postgres  CPU 2.1%  RAM 310 MB  up         │
└───────────────────────────────────────────────┘
```

---

## ✨ Features

**System monitoring**
- Real-time CPU, memory, and disk usage with gauges and `<canvas>` sparklines
- Network I/O (receive / transmit rates), load average, uptime, OS, hostname
- CPU temperature when available — degrades gracefully when it isn't
- Per-container Docker stats: status, CPU %, RAM, and network

**External data**
- **Calendar** — published Outlook `.ics` feed; expands recurring events; next *N* days
- **News** — any RSS/Atom feed, with images, age labels, and links (list or carousel)
- **Weather** — current temp/humidity, 5-day forecast, and moon phase (Open-Meteo, no API key; met.no fallback)

**Appearance**
- 5 themes — Minimal, Neumorphic, Elevated, Outline, Frosted Glass — each with light/dark
- Card density presets (compact / normal / spacious) and per-metric sparkline toggles

**Notifications**
- Sidebar for system alerts, degradations, and recoveries, with de-duplication

**Built for the long haul**
- ES5 + Flexbox, served as-is — tuned to run for **weeks** on a 512 MB iPad 2 without leaking

---

## 🪧 Why this exists

LabPad's whole identity is a constraint: it has to run **indefinitely as an
always-on wall display on an iPad 2 (iOS 9.3.5 / Safari 9)** — 2012 hardware with
512 MB of RAM. That single requirement shapes every technical choice:

- **Hand-written ES5**, no frameworks, no transpiler, **no build step** — files are served exactly as written.
- **Flexbox-only** layout, no CSS Grid, no CSS variables, no `backdrop-filter`.
- **`XMLHttpRequest`**, never `fetch()`.
- **No perpetual animations** and **no per-cycle DOM churn** — the two things that crash old Safari over long uptime.

If you plan to change anything under `static/`, read **[CLAUDE.md](CLAUDE.md)** first —
it's the compatibility contract that keeps the iPad alive.

---

## 🚀 Quick Start

```bash
docker compose up -d --build      # modern Docker
# or:  docker-compose up -d --build   (older version)
```

No `.env` needed. Access from any device on your LAN — **including an iPad 2**:

```
http://HOST-IP:8723
```

Find your host IP with `ip addr` (look for something like `192.168.x.x`).

Stop / update:

```bash
docker compose down
docker compose up -d --build      # after editing any file
```

> Editing only `static/` (HTML/CSS/JS)? Mount the folder as a volume to skip
> rebuilds — see [Development](#-development). By default static files are baked
> into the image, so re-run `up -d --build`.

---

## 📺 Set Up the iPad as a Wall Monitor

1. Open `http://HOST-IP:8723` in Safari.
2. **Share → Add to Home Screen** — launches fullscreen, no browser bars.
3. **Settings → Display & Brightness → Auto-Lock → Never**.
4. *(Optional)* **Settings → General → Accessibility → Guided Access** to lock the
   iPad on this one screen (kiosk mode).

---

## ⚙️ Configuration

Everything is configured **live** via the **settings panel** (gear icon, top right) —
no `.env`, no rebuild. Values persist in `/data/settings.json` inside a named Docker
volume, so they survive rebuilds and restarts.

| Section | What you set |
|---------|--------------|
| **Theme** | One of 5 styles + light/dark mode |
| **Cards** | Density (compact/normal/spacious) and which cards show sparklines |
| **Weather** | City (Open-Meteo lookup) and which slides appear in the topbar |
| **Calendar** | Published Outlook `.ics` URL + how many days ahead to show |
| **News** | RSS/Atom feed URL, item count, and card height |
| **System** | Timezone (IANA, e.g. `America/New_York`) used for calendar times |

**Getting your calendar `.ics` link:** in Outlook web, *Settings → Calendar →
Shared calendars → Publish calendar* — copy the **ICS** link (ends in `.ics`), not
the HTML one. Leave a URL blank to **disable** that section.

> ⚠️ The dashboard has **no authentication** and the `.ics` URL is a *capability
> link*. Keep LabPad on your LAN — never expose port 8723 to the internet.

Appearance settings (theme, mode, density, sparklines, slides) live in browser
`localStorage`. Data-source/system settings (city, URLs, limits, days, timezone)
are stored server-side in `/data/settings.json`.

---

## 🧠 How It Works

```
Ubuntu Host ── Docker
                └─ container "labpad"  (Flask + Python)
                     GET /            -> dashboard (static/)
                     GET /api/metrics -> host + containers   (polled every 5 s)
                     GET /api/feeds   -> calendar+news+weather (polled every 10 min)
```

- The container runs with `pid: host` + `network_mode: host` so `psutil` reads the
  **actual host hardware**, not the container's.
- All host mounts are **read-only** (`:ro`). LabPad never writes to the host.
- The frontend is **declarative**: the dashboard is built from a `widgets` array in
  [`static/config.js`](static/config.js) — adding a metric is usually a one-line edit.
- **Metrics** poll every 5 s (cheap, local). **Feeds** poll every 10 min — the backend
  fetches external providers, caches results, and backs off on failure so it never
  overloads them.

### API reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/metrics` | GET | Host hardware + Docker container stats (5 s cadence) |
| `/api/feeds` | GET | Calendar, news, and weather (10 min cadence) |
| `/api/settings` | GET / PUT | Read or update server-side settings |
| `/api/notifications` | GET | Notification queue |
| `/api/health` | GET | Liveness **and** per-collector status for external monitors |

`/api/health` returns `{ ok, status, time, uptime_s, feeds }`. `ok` stays `true`
whenever the process answers; `status` is `"degraded"` when a *configured*
collector (calendar / news / weather) is failing or weather is running on its
met.no fallback, and `"ok"` otherwise. Each `feeds` entry reports
`configured`, `ok`, `consecutive_failures`, `last_success`, `last_error`, and
`next_run_in_s`, so a monitor like Uptime Kuma or Healthchecks can alert on a
silently-failing integration — one that otherwise only shows up as a
notification on the panel itself.

---

## 🧩 Extending

### Add a new metric

1. **Backend** — return the value from `/api/metrics`. Edit the relevant collector in
   [`backend/collectors/`](backend/collectors/) (e.g. add a field to `host.py`), or
   add a new collector and wire it into [`backend/app.py`](backend/app.py).
2. **Frontend** — add **one line** to the `widgets` array in
   [`static/config.js`](static/config.js). The card appears — no HTML/CSS/JS edits.

```js
{ id:'procs', title:'Processes', kind:'info', section:'system',
  path:'host.proc_count', fmt:'text' }
```

| `kind`  | Use |
|---------|-----|
| `gauge` | number + bar `0..max` (CPU, RAM, disk, temp) |
| `info`  | single line of text (uptime, OS, load avg) |

> Any change under `static/` must satisfy the **[iPad 2 compatibility contract](CLAUDE.md)** —
> ES5 only, no perpetual animations, no `fetch`, no CSS Grid/variables.

---

## 🛠 Development

Run directly on your machine (no container), pointed at the real system root:

```bash
pip install -r requirements.txt
HOST_ROOT=/ HOST_HOSTNAME_FILE=/etc/hostname python backend/app.py
```

Open `http://localhost:8723`. Sensors and container stats require access to `/sys`
and the Docker socket.

Run the test suite:

```bash
pytest
```

To iterate on the frontend without rebuilding the image, mount `static/` as a
volume in `docker-compose.yml` (files are served with `Cache-Control: no-store`,
so just edit and refresh):

```yaml
    volumes:
      - ./static:/app/static:ro
      # ... keep the other volumes
```

<details>
<summary><strong>Project structure</strong></summary>

```
backend/
  app.py                 Flask server: routes + /api/metrics + /api/feeds
  config.py              port, disk paths, feeds, cache TTLs
  settings.py            mutable store persisted in /data/settings.json
  notifications.py       in-memory notification queue
  net_guard.py           SSRF / URL validation for outbound feed fetches
  collectors/
    host.py              CPU, memory, disk, network, load, uptime, OS
    sensors.py           CPU temperature (degrades if unavailable)
    containers.py        status, CPU%, RAM, network per container
    calendar_feed.py     published Outlook .ics parsing
    news.py              RSS/Atom feed parsing
    weather.py           weather + moon phase (Open-Meteo, met.no fallback)
static/
  index.html             page skeleton
  config.js          ★   widgets + polling intervals — edit here
  css/base.css           layout (Flexbox, no Grid)
  css/theme.css          Minimal dark theme (default)
  css/themes.css         other themes + light/dark variants
  css/motion.css         transitions & one-shot animations (iPad-safe)
  js/xhr.js              HTTP via XMLHttpRequest (replaces fetch)
  js/dashboard.js        polling + render orchestrator
  js/widgets-*.js        host / containers / feeds / weather cards
  js/settings.js         settings panel (gear icon → modal)
  js/sparkline.js        mini chart in <canvas>
tests/                   pytest suite
Dockerfile · docker-compose.yml · requirements.txt
```

</details>

---

## 🩹 Troubleshooting

- **Feeds (calendar/news/weather) not showing** — the backend caches for 10 min and
  backs off after failures. Check the `.ics`/RSS URL and city in the settings panel;
  a blank URL disables that section by design.
- **Host metrics look like the container, not the host** — confirm the service still
  has `pid: host` and `network_mode: host` in `docker-compose.yml`.
- **Settings don't persist across rebuilds** — server-side settings live in the
  `/data` named volume; make sure it isn't being removed (`docker compose down -v`).
- **Blank or broken dashboard on the iPad** — almost always a Safari 9 regression:
  an ES6 feature, `fetch`, a CSS variable, or CSS Grid slipped in. See
  [CLAUDE.md](CLAUDE.md) and test against Safari 9.

---

## 🤝 Contributing

Contributions are welcome. Before touching `static/`:

1. **Read [CLAUDE.md](CLAUDE.md)** — the iPad 2 compatibility contract is non-negotiable.
2. Write **ES5 only** (no arrow functions, `const`/`let`, template literals, `fetch`,
   `class`), Flexbox-only CSS, and no perpetual animations.
3. Run `pytest` and verify the change on Safari 9 (or the closest device you have).
4. Match the surrounding code style — comments carry the *why*, so keep them.

---

## 📄 License

Released under the [MIT License](LICENSE).
