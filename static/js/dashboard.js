/* =============================================================================
 * dashboard.js  —  orchestrator.
 *
 * Builds widgets from CONFIG, polls /api/metrics, and updates the screen.
 * Pure JavaScript ES5 (Safari 9 / iPad 2).
 * ===========================================================================*/

(function () {

  var refs = {};
  var buffers = {};
  var feedsLoaded = false;

  /* Last /api/metrics payload — kept so a modal can render itself on open
     without waiting for the next poll (its body is NOT rebuilt every cycle
     while closed; see render()). */
  var lastData = null;

  /* Cache of the host panel height: feed-list sizing only re-runs when it
     actually changes, instead of forcing a reflow every metrics cycle. */
  var lastHostPanelH = -1;

  var netRefs = null;
  var netBuffer = [];

  /* Docker summary card refs — built once, updated in place each cycle (the
     card is always visible; rebuilding its DOM every 5s churned GC). */
  var dockerRefs = null;

  /* Weather */
  var weatherRefs = null;
  var lastWeather = null;
  var weatherCurrentId = 'city';
  var weatherTimer = null;       /* handle do setTimeout ativo do carrossel */
  var WEATHER_SHOW_MS = 10000;
  var WEATHER_FADE_MS = 800;

  /* Loop dos feeds: timer trackeado p/ permitir refetch imediato sem
     acumular setTimeouts (chamado em Settings.onBackendSave). */
  var feedsTimer = null;

  /* Calendar */
  var lastCalendar = null;

  /* News (cached so Settings.onChange can re-render when view style flips). */
  var lastNews = null;

  function byId(id) { return document.getElementById(id); }

  /* Envia erro para o backend (aparece em docker logs como JS-ERROR). */
  function reportError(context, err) {
    try {
      var msg = (err && err.message) ? err.message : String(err);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/client-error', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ message: msg, source: 'dashboard.js', lineno: 0, context: context }));
    } catch (e2) { /* nothing we can do */ }
  }

  /* --- Montagem inicial dos widgets do config.js --------------------------*/
  function buildWidgets() {
    var i, widget, built, section;
    for (i = 0; i < CONFIG.widgets.length; i++) {
      widget = CONFIG.widgets[i];
      built = Widgets.create(widget);
      section = byId('section-' + widget.section);
      if (section) { section.appendChild(built.root); }
      refs[widget.id] = built;
      if (widget.spark) { buffers[widget.id] = []; }
      sizeCanvas(built.canvas);
    }

    netRefs = Widgets.initNetCard(byId('section-network'));
    sizeCanvas(netRefs && netRefs.canvas);

    dockerRefs = Widgets.initDockerSummary(byId('section-docker-summary'));

    weatherRefs = Widgets.initWeather(byId('section-weather'));
  }

  function sizeCanvas(canvas) {
    if (!canvas) { return; }
    /* Assigning canvas.width/height reallocates the backing bitmap even when
       the value is unchanged. Only touch it when the size actually changed —
       avoids per-cycle garbage on the iPad 2. */
    var w = canvas.clientWidth || 200;
    var h = canvas.clientHeight || 34;
    if (canvas.width !== w) { canvas.width = w; }
    if (canvas.height !== h) { canvas.height = h; }
  }

  function resizeAllCanvases() {
    var id;
    for (id in refs) {
      if (refs.hasOwnProperty(id)) { sizeCanvas(refs[id].canvas); }
    }
    if (netRefs) { sizeCanvas(netRefs.canvas); }
  }

  /* --- Buffers dos sparklines ---------------------------------------------*/
  function pushBuffer(id, value) {
    var buffer = buffers[id];
    if (!buffer) { return; }
    if (typeof value === 'number' && isFinite(value)) {
      buffer.push(value);
    } else {
      buffer.push(null);
    }
    while (buffer.length > CONFIG.sparkSamples) { buffer.shift(); }
  }

  function pushNetBuffer(data) {
    var rx = (data.host && typeof data.host.net_rx === 'number') ? data.host.net_rx : 0;
    var tx = (data.host && typeof data.host.net_tx === 'number') ? data.host.net_tx : 0;
    netBuffer.push(rx + tx);
    while (netBuffer.length > CONFIG.sparkSamples) { netBuffer.shift(); }
  }

  /* --- Estado de conexao --------------------------------------------------*/
  /* Timestamp of the last successful metrics poll — shown when the feed goes
     stale so a wall observer can see *when* the numbers froze. */
  var lastOkTime = null;
  /* Consecutive failed polls. The offline state only latches after
     STALE_AFTER misses in a row, so a single transient hiccup doesn't flash
     the whole wall display. */
  var offlineStrikes = 0;
  /* null = unknown (before first poll), true = offline, false = online.
     Starts null so the first success reliably paints the "online" state. */
  var isOffline = null;
  var STALE_AFTER = 2;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Add/remove a body class without clobbering others (modals.js toggles
     `scroll-locked` on the same element). */
  function bodyClass(name, on) {
    var b = document.body;
    if (!b) { return; }
    var cur = ' ' + b.className + ' ';
    var has = cur.indexOf(' ' + name + ' ') >= 0;
    if (on && !has) {
      b.className = (b.className + ' ' + name).replace(/^\s+/, '');
    } else if (!on && has) {
      b.className = cur.replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, '');
    }
  }

  /* Reflect the connection state. Every DOM write is guarded behind an actual
     state change: poll() runs on a 5s loop forever, and rewriting the dot's
     className every cycle is exactly the kind of needless per-cycle work the
     iPad 2 can't afford over long uptime. */
  function setOnline(ok) {
    if (ok) {
      lastOkTime = new Date();
      offlineStrikes = 0;
      if (isOffline === false) { return; }   /* already online: nothing to do */
      isOffline = false;
      applyConnState(false);
      return;
    }
    /* A miss. Wait for STALE_AFTER consecutive misses before latching offline,
       so a brief blip doesn't grey out the wall display. */
    offlineStrikes = offlineStrikes + 1;
    if (isOffline === true || offlineStrikes < STALE_AFTER) { return; }
    isOffline = true;
    applyConnState(true);
  }

  /* Paint the offline/online treatment. Runs only on a state transition. */
  function applyConnState(off) {
    var dot = byId('status-dot');
    if (dot) { dot.className = 'status-dot status-dot--' + (off ? 'off' : 'on'); }

    var label = byId('status-text');
    if (label) {
      if (off && lastOkTime) {
        setText(label, 'Offline \xb7 since '
          + pad2(lastOkTime.getHours()) + ':' + pad2(lastOkTime.getMinutes()));
      } else if (off) {
        setText(label, 'Offline');
      } else {
        setText(label, '');
      }
    }

    /* Grey the host metrics panel (NOT the feeds — those poll a separate
       endpoint and may still be live) so its frozen numbers read as stale at
       a glance. This is a STATIC opacity change reached through a one-shot
       transition — no perpetual animation, no per-cycle work — so it stays
       within the iPad 2 long-uptime contract (see motion.css). */
    bodyClass('is-offline', off);
  }

  /* --- Render de um ciclo -------------------------------------------------*/
  function render(data) {
    var i, widget;
    lastData = data;

    /* Always-visible surfaces: gauges, network + docker summary cards. */
    for (i = 0; i < CONFIG.widgets.length; i++) {
      widget = CONFIG.widgets[i];
      if (widget.spark) {
        pushBuffer(widget.id, getPath(data, widget.path));
      }
      Widgets.update(refs[widget.id], widget, data, buffers[widget.id]);
    }

    pushNetBuffer(data);
    /* Docker summary can change the double-row height; measure the canvas after. */
    Widgets.updateDockerSummary(dockerRefs, data.containers);
    sizeCanvas(netRefs && netRefs.canvas);
    Widgets.updateNetCard(netRefs, data, netBuffer);

    /* Modal bodies (system / containers / disk) are hidden 99% of the time.
       Rebuilding their DOM every 5s just to throw it away is the biggest source
       of GC churn on the iPad 2 — only refresh them while their modal is open.
       Each modal also renders itself once on open (see the open* handlers). */
    if (Modals.isOpen('system-modal'))     { renderSystemBody(); }
    if (Modals.isOpen('containers-modal'))  { renderContainersBody(); }
    if (Modals.isOpen('disk-modal'))        { renderDiskBody(); }

    /* Feed-list height depends on the host panel height (docker top-3 / gauge
       subs can reflow it). Only recompute when that height actually changed,
       instead of forcing a reflow every cycle. */
    maybeSizeFeedLists();
  }

  /* Render helpers for the on-demand modal bodies, from the cached payload. */
  function renderSystemBody() {
    if (!lastData) { return; }
    Widgets.renderSystemInfo(byId('system-modal-body'),
                             lastData.host || {}, lastData.containers);
  }
  function renderContainersBody() {
    if (!lastData) { return; }
    Widgets.renderContainers(byId('section-containers'), lastData.containers);
    updateContainerCount(lastData.containers);
  }
  function renderDiskBody() {
    if (!lastData) { return; }
    Widgets.renderDiskModal(byId('disk-modal-body'), (lastData.host || {}).disk);
  }

  /* Reflow-guarded feed sizing: read the host panel height once; only rerun
     the (read+write) sizing pass when it changed since last time. */
  function maybeSizeFeedLists() {
    var hostEl = document.getElementsByClassName('panel')[0];
    var h = hostEl ? hostEl.offsetHeight : 0;
    if (h === lastHostPanelH) { return; }
    lastHostPanelH = h;
    sizeFeedLists();
  }

  function updateContainerCount(payload) {
    var node = byId('container-count');
    if (!node) { return; }
    var list = (payload && payload.list) ? payload.list : [];
    if (!list.length) { setText(node, ''); return; }
    var up = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === 'running') { up = up + 1; }
    }
    setText(node, '(' + up + ' / ' + list.length + ' active)');
  }

  /* --- Brand como atalho de Full refresh ----------------------------------*/
  /* O titulo "Homelab" no topo virou o gatilho do reload completo: um clique
     na area do brand recarrega tudo. Ignoramos cliques no botao de info do
     host info button embedded in the brand itself, to avoid conflicting with that action. */
  function wireBrandRefresh() {
    var brand = byId('brand-refresh');
    if (!brand) { return; }
    function go() { location.reload(true); }
    brand.onclick = function (e) {
      /* Walk up from the actual click target: the info button holds an inline
         <svg>, so a click lands on the <svg>/<path>, not on the button itself.
         Checking only e.target.id would miss it and trigger the refresh. */
      var t = e.target;
      while (t && t !== brand) {
        if (t.id === 'host-info-btn') { return; }
        t = t.parentNode;
      }
      go();
    };
    brand.onkeydown = function (e) {
      /* Only when the brand itself is focused — not the nested info button,
         whose Enter/Space keydown would otherwise bubble up and refresh. */
      if (e.target !== brand) { return; }
      if (e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); go(); }
    };
  }

  /* --- Modal da lista de containers --------------------------------------*/
  function openContainersModal() { renderContainersBody(); Modals.open('containers-modal'); }
  function closeContainersModal() { Modals.close('containers-modal'); }

  function wireContainersModal() {
    /* O card Docker (#section-docker-summary) persiste — updateDockerSummary
       so reescreve texto nos nos ja existentes (nunca troca o card em si),
       entao o onclick sobrevive. */
    var dockerCard = byId('section-docker-summary');
    if (dockerCard) { dockerCard.onclick = openContainersModal; }

    var backdrop = byId('containers-modal');
    if (backdrop) { backdrop.onclick = closeContainersModal; }

    /* Clicks inside the box do not reach the backdrop (which closes the modal). */
    var box = byId('containers-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }

    var closeBtn = byId('containers-modal-close');
    if (closeBtn) { closeBtn.onclick = closeContainersModal; }
  }

  /* --- Modal de particoes de disco ----------------------------------------*/
  function openDiskModal()  { renderDiskBody(); Modals.open('disk-modal');  }
  function closeDiskModal() { Modals.close('disk-modal'); }

  function wireDiskModal() {
    var diskCard = refs['disk'] && refs['disk'].root;
    if (diskCard) { diskCard.onclick = openDiskModal; }

    var backdrop = byId('disk-modal');
    if (backdrop) { backdrop.onclick = closeDiskModal; }

    var box = byId('disk-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }

    var closeBtn = byId('disk-modal-close');
    if (closeBtn) { closeBtn.onclick = closeDiskModal; }
  }

  /* --- Modal "Sistema" (botao (i) no titulo do painel Host) --------------*/
  function openSystemModal() { renderSystemBody(); Modals.open('system-modal'); }
  function closeSystemModal() { Modals.close('system-modal'); }

  function wireSystemModal() {
    var btn = byId('host-info-btn');
    if (btn) {
      btn.innerHTML = ICONS.info;
      btn.onclick = function (e) {
        /* Stop the click from bubbling to the brand's full-refresh handler. */
        if (e && e.stopPropagation) { e.stopPropagation(); }
        openSystemModal();
      };
    }
    var backdrop = byId('system-modal');
    if (backdrop) { backdrop.onclick = closeSystemModal; }
    var box = byId('system-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = byId('system-modal-close');
    if (closeBtn) { closeBtn.onclick = closeSystemModal; }
  }

  /* --- Modal de logs (sobreposto ao modal de containers) ---------------- */
  var logsInterval = null;
  var currentLogId = null;
  var LOGS_REFRESH_MS = 5000;
  var LOGS_TAIL = 200;

  function openLogsModal(id, name) {
    currentLogId = id;
    setText(byId('logs-modal-name'), name || '?');
    setText(byId('logs-modal-pre'), 'Loading...');
    Modals.open('logs-modal');
    fetchLogs(id, true);
    if (logsInterval) { clearInterval(logsInterval); }
    logsInterval = setInterval(function () {
      fetchLogs(id, false);
    }, LOGS_REFRESH_MS);
  }

  function closeLogsModal() {
    if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
    currentLogId = null;
    Modals.close('logs-modal');
  }

  function fetchLogs(id, force) {
    var url = (CONFIG.apiBase || '') + '/api/containers/'
            + encodeURIComponent(id) + '/logs?tail=' + LOGS_TAIL
            + '&_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      if (currentLogId !== id) { return; }  /* trocou de container */
      var pre = byId('logs-modal-pre');
      var body = byId('logs-modal-body');
      if (data.error) { setText(pre, 'Error: ' + data.error); return; }
      var text = data.logs || '';
      /* Preserve scroll position if the user has scrolled up to read history. */
      var nearBottom = !body
        || (body.scrollHeight - body.scrollTop - body.clientHeight < 50);
      setText(pre, text || '(no logs)');
      if (body && (force || nearBottom)) { body.scrollTop = body.scrollHeight; }
    }, function (err) {
      if (currentLogId !== id) { return; }
      setText(byId('logs-modal-pre'), 'Error fetching logs: ' + err);
    });
  }

  /* --- Weather detail modal (click on topbar carousel) ------------------*/
  function openWeatherModal() {
    if (!lastWeather) { return; }   /* no data yet */
    setText(byId('weather-modal-city'),
      lastWeather.city ? ' — ' + lastWeather.city : '');
    Widgets.renderWeatherDetail(byId('weather-modal-body'), lastWeather);
    Modals.open('weather-modal');
  }

  function closeWeatherModal() { Modals.close('weather-modal'); }

  function wireWeatherModal() {
    var center = byId('section-weather');
    if (center) { center.style.cursor = 'pointer'; center.onclick = openWeatherModal; }
    var backdrop = byId('weather-modal');
    if (backdrop) { backdrop.onclick = closeWeatherModal; }
    var box = byId('weather-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = byId('weather-modal-close');
    if (closeBtn) { closeBtn.onclick = closeWeatherModal; }
  }

  /* --- Article reader modal (click on news card) ------------------------- */
  function openArticleModal(item) {
    if (!item || !item.link) { return; }
    var srcEl = byId('article-modal-source');
    var bodyEl = byId('article-modal-body');
    var extEl = byId('article-modal-extlink');

    setText(srcEl, 'Loading...');
    if (extEl) { extEl.href = item.link; }
    bodyEl.innerHTML = '';
    bodyEl.scrollTop = 0;

    /* Pre-render with what we already have from RSS (image appears instantly). */
    if (item.image) {
      var img = el('img', 'article-hero-img');
      img.src = proxiedImage(item.image, 640); img.alt = '';
      bodyEl.appendChild(img);
    }
    if (item.title) {
      bodyEl.appendChild(el('h1', 'article-title', item.title));
    }
    var loader = el('div', 'article-loading', 'Loading content...');
    bodyEl.appendChild(loader);

    Modals.open('article-modal');

    var url = (CONFIG.apiBase || '') + '/api/article?url='
            + encodeURIComponent(item.link) + '&_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      if (!Modals.isOpen('article-modal')) { return; }
      if (data && data.error) {
        loader.className = 'article-error';
        setText(loader, 'Could not extract: ' + data.error);
        return;
      }
      setText(srcEl, data.site || data.title || 'News');
      bodyEl.innerHTML = '';
      var image = item.image || data.image;
      if (image) {
        var img2 = el('img', 'article-hero-img');
        img2.src = proxiedImage(image, 640); img2.alt = '';
        bodyEl.appendChild(img2);
      }
      bodyEl.appendChild(el('h1', 'article-title', data.title || item.title || ''));
      var parts = [];
      if (data.author) { parts.push(data.author); }
      if (data.date)   { parts.push(data.date); }
      if (parts.length) {
        bodyEl.appendChild(el('div', 'article-meta', parts.join('  \xb7  ')));
      }
      var content = el('div', 'article-content');
      content.innerHTML = data.html || '';   /* sanitizado pelo trafilatura */
      bodyEl.appendChild(content);
      bodyEl.scrollTop = 0;
    }, function (err) {
      if (!Modals.isOpen('article-modal')) { return; }
      loader.className = 'article-error';
      setText(loader, 'Error fetching: ' + err);
    }, 15000);
  }

  function closeArticleModal() { Modals.close('article-modal'); }

  function wireArticleModal() {
    /* Delegacao no #section-news (rows sao reconstruidas a cada cycle). */
    var list = byId('section-news');
    if (list) {
      list.onclick = function (e) {
        var node = e.target;
        while (node && node !== list) {
          if (node.className
              && (' ' + node.className + ' ').indexOf(' news-item ') >= 0) {
            openArticleModal({
              link:  node.getAttribute('data-link'),
              title: node.getAttribute('data-title'),
              image: node.getAttribute('data-image')
            });
            return;
          }
          node = node.parentNode;
        }
      };
    }
    var backdrop = byId('article-modal');
    if (backdrop) { backdrop.onclick = closeArticleModal; }
    var box = byId('article-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = byId('article-modal-close');
    if (closeBtn) { closeBtn.onclick = closeArticleModal; }
    var extLink = byId('article-modal-extlink');
    if (extLink) { extLink.innerHTML = ICONS.external; }
  }

  function wireLogsModal() {
    /* Delega o clique nas linhas (sao reconstruidas pelo render a cada ciclo). */
    var list = byId('section-containers');
    if (list) {
      list.onclick = function (e) {
        var node = e.target;
        while (node && node !== list) {
          if (node.className
              && (' ' + node.className + ' ').indexOf(' crow ') >= 0) {
            var id = node.getAttribute('data-id');
            var name = node.getAttribute('data-name');
            if (id) { openLogsModal(id, name); }
            return;
          }
          node = node.parentNode;
        }
      };
    }

    var backdrop = byId('logs-modal');
    if (backdrop) { backdrop.onclick = closeLogsModal; }
    var box = byId('logs-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = byId('logs-modal-close');
    if (closeBtn) { closeBtn.onclick = closeLogsModal; }
    var refreshBtn = byId('logs-modal-refresh');
    if (refreshBtn) {
      refreshBtn.innerHTML = ICONS.refresh;
      refreshBtn.onclick = function (e) {
        e.stopPropagation();
        if (currentLogId) { fetchLogs(currentLogId, true); }
      };
    }
  }

  /* --- Weather widget rotation (single panel) ----------------------------*/
  /* Active slides come from Settings (subset of current/forecast/moon). Each
     startWeatherRotation generates a new "token" — old setTimeouts become
     no-ops, preventing duplicate rotations when the user saves settings. */

  function enabledWeatherSlides() {
    var s = (window.Settings && Settings.weatherSlides)
            ? Settings.weatherSlides() : ['current', 'forecast', 'moon'];
    return s.length ? s : ['current'];
  }

  function renderWeatherCurrent() {
    if (!weatherRefs || !lastWeather) { return; }
    Widgets.renderWeatherSlide(weatherRefs.panel, lastWeather, weatherCurrentId);
  }

  function weatherStep() {
    if (!weatherRefs || !lastWeather || !lastWeather.configured) { return; }

    var panel = weatherRefs.panel;
    panel.className = 'weather-panel weather-hidden';

    weatherTimer = setTimeout(function () {
      var enabled = enabledWeatherSlides();
      var nextId;
      if (weatherCurrentId === 'city') {
        /* Leaving intro: go to the first enabled slide. */
        nextId = enabled[0];
      } else {
        var i = enabled.indexOf(weatherCurrentId);
        nextId = (i < 0) ? enabled[0] : enabled[(i + 1) % enabled.length];
      }
      weatherCurrentId = nextId;
      renderWeatherCurrent();
      panel.className = 'weather-panel';
      /* Only keep rotating if there are >1 enabled slides (city already shown). */
      if (enabled.length > 1) {
        weatherTimer = setTimeout(weatherStep, WEATHER_SHOW_MS);
      }
    }, WEATHER_FADE_MS);
  }

  function startWeatherRotation() {
    if (!weatherRefs || !lastWeather || !lastWeather.configured) { return; }
    /* Cancel any previous cycle before starting a new one. */
    clearTimeout(weatherTimer);
    /* Always start with the 'city' slide (intro, shown once). */
    weatherCurrentId = 'city';
    renderWeatherCurrent();
    weatherRefs.panel.className = 'weather-panel';
    weatherTimer = setTimeout(weatherStep, WEATHER_SHOW_MS);
  }

  /* Show/hide sparklines according to Settings.spark(id). The render loop now
     skips drawing hidden canvases (widgets-host.js), so when one is toggled back
     ON we repaint it here from the retained buffer instead of leaving a stale
     frame until the next poll. This runs only on init and on Settings changes —
     never per metrics cycle — so the redraw cost is negligible. */
  function applySparkVisibility() {
    if (!window.Settings) { return; }
    var id;
    for (id in refs) {
      if (refs.hasOwnProperty(id) && refs[id] && refs[id].canvas) {
        var show = Settings.spark(id);
        refs[id].canvas.style.display = show ? '' : 'none';
        if (show && buffers[id]
            && refs[id].canvas.className.indexOf('skeleton-block') < 0) {
          drawSparkline(refs[id].canvas, buffers[id],
                        LEVEL_COLOR[refs[id].level] || LEVEL_COLOR.ok);
        }
      }
    }
    if (netRefs && netRefs.canvas) {
      var showNet = Settings.spark('net');
      netRefs.canvas.style.display = showNet ? '' : 'none';
      if (showNet && netBuffer.length
          && netRefs.canvas.className.indexOf('skeleton-block') < 0) {
        drawSparkline(netRefs.canvas, netBuffer, LEVEL_COLOR.ok);
      }
    }
  }

  /* --- Feed-list sizing in PIXELS (required for Safari 9 / iPad 2) -------
     iOS Safari 9 does not treat flex-calculated height as "defined" for
     overflow-y scrolling, and position:absolute collapses when the parent
     has no height:100% resolved against a flex parent. The bulletproof fix:
     measure the viewport, subtract topbar+host+title+padding, then set
     .feed-list.style.height in raw pixels. iOS accepts it without question
     and enables momentum touch scrolling. */
  function sizeFeedLists() {
    var lists = document.getElementsByClassName('feed-list');
    if (!lists || !lists.length) { return; }
    /* Mobile (< 601 px): vertical stacking with global scroll — clear
       any height we set in previous sessions. */
    if (window.innerWidth < 601) {
      for (var i = 0; i < lists.length; i++) { lists[i].style.height = ''; }
      return;
    }
    var viewportH = document.documentElement.clientHeight || window.innerHeight;
    var topbarEl  = document.getElementsByClassName('topbar')[0];
    var hostEl    = document.getElementsByClassName('panel')[0]; // first .panel = host
    var titleEl   = document.getElementsByClassName('panel-title')[0];
    var topbarH = topbarEl ? topbarEl.offsetHeight : 0;
    var hostH   = hostEl   ? hostEl.offsetHeight   : 0;
    var titleH  = titleEl  ? titleEl.offsetHeight  : 16;
    var titleMb = 12; /* default .panel-title margin-bottom from base.css */
    if (titleEl && window.getComputedStyle) {
      try {
        var parsed = parseInt(window.getComputedStyle(titleEl).marginBottom, 10);
        if (!isNaN(parsed)) { titleMb = parsed; }
      } catch (e) { /* ignore */ }
    }
    /* main padding 8/0 + .panel margin-bottom 20 (gap between host and feeds). */
    var avail = viewportH - topbarH - 8 - hostH - 20 - titleH - titleMb;
    if (avail < 80) { avail = 80; }
    for (var j = 0; j < lists.length; j++) {
      lists[j].style.height = avail + 'px';
    }
  }

  /* --- Calendar tick: re-renders to update urgency colours ---------------*/
  function calendarTick() {
    if (lastCalendar) {
      Widgets.renderCalendar(byId('section-calendar'), lastCalendar);
    }
    setTimeout(calendarTick, 60000);
  }

  /* --- Metrics polling loop ----------------------------------------------*/
  /* Handle of the pending poll timer, kept so it can be cancelled when the tab
     goes hidden (wireVisibilityPause). null = nothing scheduled. */
  var pollTimer = null;
  /* True while the 5s loop is parked because the tab is hidden. The wall display
     is visible almost all the time, but when Safari backgrounds the tab (or the
     user switches away during setup) nobody is watching — so polling, parsing
     and rendering (gauges + up-to-4 sparkline canvas draws) every 5s is pure
     waste on the 512 MB iPad 2, the exact per-cycle work the long-uptime rules
     exist to cut. tickClock already idles the same way on document.hidden. */
  var pollParked = false;

  function poll() {
    var url = (CONFIG.apiBase || '') + '/api/metrics?_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      setOnline(true);
      try { render(data); } catch (e) { reportError('render', e); }
      schedule();
    }, function () {
      setOnline(false);
      schedule();
    });
  }

  function schedule() {
    /* Don't queue the next poll while the tab is hidden — park instead. The
       visibilitychange handler fires poll() the moment we're visible again, so
       the display refreshes instantly on return rather than showing up to 5s of
       stale numbers. */
    if (document.hidden) { pollParked = true; return; }
    if (pollTimer) { clearTimeout(pollTimer); }
    pollTimer = setTimeout(poll, CONFIG.refreshMs);
  }

  /* Park the metrics loop while the tab is hidden; resume immediately when it
     comes back into view. Mirrors tickClock's existing document.hidden handling
     and the "let the iPad CPU idle" rule (CLAUDE.md). Safari 9 / iOS 9.3.5
     support the unprefixed Page Visibility API (already used by tickClock). */
  function wireVisibilityPause() {
    if (!document.addEventListener) { return; }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        /* Going hidden: cancel any pending poll and mark the loop parked so the
           handler below knows to restart it. An in-flight request still
           completes; its schedule() sees document.hidden and parks too. */
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        pollParked = true;
      } else if (pollParked) {
        /* Back in view: refresh now instead of waiting out the interval. */
        pollParked = false;
        poll();
      }
    }, false);
  }

  /* --- Feeds polling loop (calendar + news + weather) --------------------*/
  function pollFeeds() {
    /* Cancel pending timer — allows immediate refetch (onBackendSave) without
       accumulating parallel polls. */
    if (feedsTimer) { clearTimeout(feedsTimer); feedsTimer = null; }

    var url = (CONFIG.apiBase || '') + '/api/feeds?_=' + (new Date()).getTime();
    /* 40s timeout: feeds call external APIs; calendar can take up to ~25s. */
    getJSON(url, function (data) {
      try {
        lastCalendar = data.calendar;
        lastNews = data.news;
        Widgets.renderCalendar(byId('section-calendar'), data.calendar);
        Widgets.renderNews(byId('section-news'), data.news);
        feedsLoaded = true;

        if (data.weather && data.weather.configured) {
          try {
            var prevCity = lastWeather ? lastWeather.city : null;
            var firstTime = !lastWeather;
            lastWeather = data.weather;
            /* New city (or first load): restart rotation — the 'city' slide
               reappears visually confirming the change. */
            if (firstTime || data.weather.city !== prevCity) {
              startWeatherRotation();
            } else {
              renderWeatherCurrent();
            }
            /* Update the detail modal if it is open. */
            if (window.Modals && Modals.isOpen('weather-modal')) {
              Widgets.renderWeatherDetail(byId('weather-modal-body'), lastWeather);
            }
          } catch (e) { reportError('weather-render', e); }
        } else if (data.weather && weatherRefs && !data.weather.configured) {
          /* Not configured OR error with no cached data: show a subtle pill
             signalling that the backend is still trying. Disappears on its own
             when the next response arrives with configured:true (firstTime=true,
             startWeatherRotation() overwrites the panel). */
          weatherRefs.panel.innerHTML = '';
          var pill = el('span', 'weather-val weather-retry');
          pill.appendChild(document.createTextNode(
              data.weather.error ? 'Weather unavailable, retrying…'
                                 : 'Weather not configured'));
          weatherRefs.panel.appendChild(pill);
        }
      } catch (e) { reportError('pollFeeds', e); }
      feedsTimer = setTimeout(pollFeeds, CONFIG.feedsRefreshMs);
    }, function () {
      if (!feedsLoaded) { showFeedMessage('No connection to server.'); }
      /* Network failure: retry in 30s instead of waiting 10 min. */
      feedsTimer = setTimeout(pollFeeds, 30000);
    }, 40000);
  }

  function showFeedMessage(msg) {
    var ids = ['section-calendar', 'section-news'];
    for (var i = 0; i < ids.length; i++) {
      var node = byId(ids[i]);
      if (node) {
        node.innerHTML = '';
        node.appendChild(el('div', 'empty', msg));
      }
    }
  }

  /* Animated placeholder for feeds while pollFeeds has not returned for the first time.
     Used ONLY on initial load — subsequent refreshes overwrite real content
     without flashing the skeleton. */
  function showFeedSkeleton(sectionId, rows) {
    var node = byId(sectionId);
    if (!node) { return; }
    node.innerHTML = '';
    for (var i = 0; i < rows; i++) {
      var row = el('div', 'feed-skeleton');
      row.appendChild(el('span', 'skeleton skeleton-line'));
      row.appendChild(el('span', 'skeleton skeleton-line'));
      node.appendChild(row);
    }
  }

  /* --- Clock --------------------------------------------------------------*/
  /* The clock lives inside the 'city' slide of the weather carousel
     (rendered by widgets.js). Here we only update the span when it exists
     in the DOM — outside the 'city' slide byId returns null and the tick
     becomes a no-op. No seconds: HH:MMh format. */
  function clockText(d) {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + 'h';
  }

  function tickClock() {
    /* The clock reads HH:MM, so it only needs to change once a minute. Waking
       every second (×60/min forever) kept the iPad 2 CPU from idling; instead
       update now and reschedule to just after the next minute boundary. */
    var now = new Date();
    var node = byId('weather-clock');
    if (node) { setText(node, clockText(now)); }
    if (document.hidden) { setTimeout(tickClock, 30000); return; }
    var msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    setTimeout(tickClock, msToNextMinute);
  }

  /* --- Initialization -----------------------------------------------------*/
  buildWidgets();
  wireBrandRefresh();
  wireVisibilityPause();
  if (window.Notifications) { Notifications.start(); }
  wireContainersModal();
  wireDiskModal();
  wireSystemModal();
  wireLogsModal();
  wireWeatherModal();
  wireArticleModal();
  applySparkVisibility();
  if (window.Settings && Settings.onChange) {
    Settings.onChange(function () {
      applySparkVisibility();
      /* Re-render news section so list <-> carousel toggle takes effect
         immediately (without waiting for the 10-min feeds cycle). */
      if (lastNews) {
        Widgets.renderNews(byId('section-news'), lastNews);
      }
      /* Weather slides: weatherStep reads enabledWeatherSlides() on each step,
         so toggles apply on the next cycle (no restart here — avoids showing
         the OLD city for an instant when the save includes a city change). */
    });
  }
  if (window.Settings && Settings.onBackendSave) {
    Settings.onBackendSave(function () {
      /* Data source save (city/URL/limit/days): trigger immediate pollFeeds
         instead of waiting for the 10-minute cycle. */
      pollFeeds();
    });
  }
  window.onresize = function () {
    resizeAllCanvases();
    lastHostPanelH = -1;   /* viewport changed: force a feed-list recompute */
    sizeFeedLists();
  };
  showFeedSkeleton('section-calendar', 4);
  showFeedSkeleton('section-news', 4);
  /* First measurement: after the initial skeleton paint, so that
     topbar/host offsetHeight is already available. setTimeout(0)
     queues on the next tick — Safari 9 has no prefixed rAF. */
  setTimeout(sizeFeedLists, 0);
  tickClock();
  poll();
  pollFeeds();
  setTimeout(calendarTick, 60000);

})();
