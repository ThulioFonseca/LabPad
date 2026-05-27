# Homelab Monitor

A monitoring dashboard for your homelab, designed to run on an **iPad 2 (iOS 9.3.5)**
as an always-on wall display.

Shows near real-time **Ubuntu host** and **Docker container** metrics, plus
**calendar**, **news**, and **weather**. Runs as a single container and serves
a hand-crafted page for Safari 9 — no CSS Grid, no `fetch`, no frameworks, no build.
Beautiful, lightweight, and easy to customize.

```
┌───────────────────────────────────────────────┐
│ Homelab        ☀ 24°C · 60%       ● online 14:22│
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

## Getting Started

```bash
docker compose up -d --build      # Modern Docker
# or:  docker-compose up -d --build   (older version)
```

No `.env` needed. Everything (weather city, calendar URL, RSS URL, limits, days,
timezone, theme, layout) is configured via the **settings button** (gear icon)
in the top right of the dashboard. Your choices persist in `/data/settings.json`
in a named Docker volume — they survive rebuilds.

Access from any device on your local network, **including an iPad 2**:

```
http://HOST-IP:8723
```

To find your host IP: `ip addr` (look for something like `192.168.x.x`).

Stop / update:

```bash
docker compose down
docker compose up -d --build      # after editing any file
```

> Only editing `static/` (HTML/CSS/JS)? No need to rebuild the image if you mount
> the folder as a volume — see "Development" below. By default, static files go
> into the image, so run `up -d --build` again.

## Set Up iPad as a Wall Monitor

1. Open `http://HOST-IP:8723` in Safari.
2. **Share → Add to Home Screen** — opens fullscreen, no bars.
3. **Settings → Display & Brightness → Auto-Lock → Never**.
4. (Optional) **Settings → General → Accessibility → Guided Access** to lock the
   iPad on this screen (kiosk mode).

## How It Works

```
Ubuntu Host ── Docker
                └─ container "homelab-monitor"  (Flask + Python)
                     GET /            -> dashboard (static/)
                     GET /api/metrics -> hardware + containers (5 s)
                     GET /api/feeds   -> calendar + news + weather (10 min)
```

- Container runs with `pid: host` + `network_mode: host` so `psutil` reads the
  **actual host hardware** (not the container's).
- All volumes are **read-only** (`:ro`). Container never writes to the host.
- Dashboard polls `/api/metrics` every 5 s via `XMLHttpRequest`.
- Calendar, news, and weather come from `/api/feeds`, updated every 10 min —
  the backend fetches external feeds and caches them (no overloading providers).

### Security

The dashboard **has no authentication** — designed for **local network use only**.
Do not expose port 8723 to the internet. Docker socket is mounted read-only, but
it still exposes container visibility; keep it on your LAN.

## Calendar, News, and Weather

Configure everything via the **settings panel** (gear icon, top right) — no `.env`,
no rebuild. Values persist in `/data/settings.json` in the Docker volume.

- **Calendar** — `.ics` URL from a published Outlook calendar + how many days ahead to show.
- **News** — RSS/Atom feed URL + how many items to display.
- **Weather** — city name (Open-Meteo, free, no API key); cycles between current
  temp/humidity, 5-day forecast, and moon phase.
- **System** — timezone (IANA format, e.g. `America/New_York`) used by calendar times.

**How to get your calendar's `.ics` link:** in Outlook web, *Settings → Calendar →
Shared calendars → Publish calendar* — copy the **ICS** link (ends in `.ics`),
**not** the HTML link.

> The calendar URL is a *capability link*: whoever has it can see your calendar.
> Keep the dashboard on your LAN (no auth).

Leave a URL blank to **disable** that section. Recurring events (weekly meetings, etc.)
are automatically expanded.

## How to Extend (the project's strongest point)

### Add a New Metric

1. **Backend** — return the value in `/api/metrics`. Edit the appropriate collector in
   [`backend/collectors/`](backend/collectors/) (e.g. add a field to `host.py`)
   or create a new collector and wire it into [`backend/app.py`](backend/app.py).
2. **Frontend** — open [`static/config.js`](static/config.js) and add **one line**
   to the `widgets` array. Done: the card appears. No HTML/CSS/JS editing.

Example — show process count:

```js
{ id:'procs', title:'Processes', kind:'info', section:'system',
  path:'host.proc_count', fmt:'text' }
```

### Settings Panel

The **settings button** (gear icon, top right) opens a full panel to adjust your
dashboard **live**. It has 6 sections:

- **Theme** — 5 styles (Minimal, Neumorphic, Elevated, Outline, Frosted Glass)
  and light/dark mode.
- **Cards** — density (compact/normal/spacious) and which cards show sparklines.
- **Weather** — city and which slides appear in the topbar.
- **Calendar** — `.ics` URL and how many days ahead to show.
- **News** — RSS feed URL, count, and card height.
- **System** — timezone (IANA format).

**Appearance** settings (theme, mode, density, sparklines, slides) go to browser
`localStorage`. **Data source / system** settings (city, URLs, limits, days, timezone)
are saved in `/data/settings.json` in a named Docker volume — they survive rebuilds
and apply to the next collection. The "Reset to defaults" button resets frontend
settings only.

Each theme is a *style* (shadow, border, shape), not just color. Minimal dark lives in
[`static/css/theme.css`](static/css/theme.css); others and light variants live in
`themes.css`, applied via classes on `<html>` (`theme-X mode-Y cards-Z news-W`).
Structure and layout live in `base.css`.

### Available Widget Types

| `kind`  | Use                                            |
|---------|------------------------------------------------|
| `gauge` | number + bar 0..max (CPU, RAM, disk, temp)    |
| `info`  | single line of text (uptime, OS, load avg)    |

Each widget field is documented inside `config.js` itself.

## Project Structure

```
backend/
  app.py                 Flask server: routes + /api/metrics + /api/feeds
  config.py              port, disk paths, feeds, cache TTLs
  collectors/
    host.py              CPU, memory, disk, network, load, uptime, OS
    sensors.py           temperature (degrades if unavailable)
    containers.py        status, CPU%, RAM, network per container
    calendar_feed.py     calendar: reads published Outlook .ics
    news.py              news: reads RSS/Atom feed
    weather.py           weather and moon phase (Open-Meteo, no key)
static/
  index.html             page skeleton
  config.js          ★   widgets and polling intervals — edit here
  css/base.css           layout (Flexbox, no Grid)
  css/theme.css          Minimal dark theme (default)
  css/themes.css         other themes + light/dark variants
  js/xhr.js              requests (XMLHttpRequest, replaces fetch)
  js/format.js           DOM and formatting utilities
  js/icons.js            SVG icons (cards, weather, moon)
  js/sparkline.js        mini chart in <canvas>
  js/widgets.js          components: cards, calendar, news, weather
  js/settings.js         settings panel (gear icon → modal)
  js/dashboard.js        polling + render
backend/settings.py      mutable store persisted in /data/settings.json
Dockerfile · docker-compose.yml · requirements.txt
```

## Development / Running Outside Docker

To run directly on your machine (no container), pointing to real system root:

```bash
pip install -r requirements.txt
HOST_ROOT=/ HOST_HOSTNAME_FILE=/etc/hostname python backend/app.py
```

Open `http://localhost:8723`. Sensors and container stats require the process
to have access to `/sys` and the Docker socket.

To iterate on frontend without rebuilding the image, mount `static/` as a volume
by adding to the service in `docker-compose.yml`:

```yaml
    volumes:
      - ./static:/app/static:ro
      # ... (keep other volumes)
```

Static files are served with `Cache-Control: no-store`, so just edit and refresh
in the browser.

## Compatibility

Tested for **Safari 9 / iOS 9.3.5**: layout uses Flexbox only, JavaScript ES5,
`XMLHttpRequest`, 2D `<canvas>`. No CSS Grid, `fetch`, ES6, or frameworks.
