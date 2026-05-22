/* =============================================================================
 * dashboard.js  —  orquestrador.
 *
 * Monta os widgets a partir de CONFIG, faz polling de /api/metrics e atualiza
 * a tela. JavaScript ES5 puro (Safari 9 / iPad 2).
 * ===========================================================================*/

(function () {

  var refs = {};
  var buffers = {};
  var feedsLoaded = false;

  var netRefs = null;
  var netBuffer = [];

  /* Weather */
  var weatherRefs = null;
  var lastWeather = null;
  var weatherSlide = 0;
  var WEATHER_SLIDES = 3;
  var WEATHER_SHOW_MS = 10000;
  var WEATHER_FADE_MS = 800;

  /* Calendar */
  var lastCalendar = null;

  function byId(id) { return document.getElementById(id); }

  /* Envia erro para o backend (aparece em docker logs como JS-ERROR). */
  function reportError(context, err) {
    try {
      var msg = (err && err.message) ? err.message : String(err);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/client-error', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ message: msg, source: 'dashboard.js', lineno: 0, context: context }));
    } catch (e2) { /* nao pode fazer nada */ }
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

    weatherRefs = Widgets.initWeather(byId('section-weather'));
  }

  function sizeCanvas(canvas) {
    if (!canvas) { return; }
    canvas.width = canvas.clientWidth || 200;
    canvas.height = canvas.clientHeight || 34;
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
  function setOnline(ok) {
    var dot = byId('status-dot');
    if (dot) { dot.className = 'status-dot status-dot--' + (ok ? 'on' : 'off'); }
    setText(byId('status-text'), ok ? 'online' : 'sem conexao');
  }

  /* --- Render de um ciclo -------------------------------------------------*/
  function render(data) {
    var i, widget;
    var hostData = data.host || {};

    Widgets.renderMeta(byId('section-meta'), hostData);

    for (i = 0; i < CONFIG.widgets.length; i++) {
      widget = CONFIG.widgets[i];
      if (widget.spark) {
        pushBuffer(widget.id, getPath(data, widget.path));
      }
      Widgets.update(refs[widget.id], widget, data, buffers[widget.id]);
    }

    pushNetBuffer(data);
    /* Docker summary define a altura da double-row; medir o canvas depois. */
    Widgets.renderDockerSummary(byId('section-docker-summary'), data.containers);
    sizeCanvas(netRefs && netRefs.canvas);
    Widgets.updateNetCard(netRefs, data, netBuffer);

    Widgets.renderContainers(byId('section-containers'), data.containers);
    updateContainerCount(data.containers);

    setText(byId('last-update'), 'atualizado as ' + clockText(new Date()));
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
    setText(node, '(' + up + ' / ' + list.length + ' ativos)');
  }

  /* --- Rotacao do widget de clima (painel unico) -------------------------*/
  function weatherStep() {
    if (!weatherRefs || !lastWeather || !lastWeather.configured) { return; }
    var panel = weatherRefs.panel;

    /* fade out */
    panel.className = 'weather-panel weather-hidden';

    setTimeout(function () {
      /* troca conteudo enquanto invisivel */
      weatherSlide = (weatherSlide + 1) % WEATHER_SLIDES;
      Widgets.renderWeatherSlide(panel, lastWeather, weatherSlide);
      /* fade in */
      panel.className = 'weather-panel';
      setTimeout(weatherStep, WEATHER_SHOW_MS);
    }, WEATHER_FADE_MS);
  }

  function startWeatherRotation() {
    if (!weatherRefs || !lastWeather || !lastWeather.configured) { return; }
    var panel = weatherRefs.panel;
    weatherSlide = 0;
    Widgets.renderWeatherSlide(panel, lastWeather, 0);
    panel.className = 'weather-panel';
    setTimeout(weatherStep, WEATHER_SHOW_MS);
  }

  /* --- Tick da agenda: re-renderiza para atualizar cores de urgencia ------*/
  function calendarTick() {
    if (lastCalendar) {
      Widgets.renderCalendar(byId('section-calendar'), lastCalendar);
    }
    setTimeout(calendarTick, 60000);
  }

  /* --- Loop de polling das metricas --------------------------------------*/
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
    setTimeout(poll, CONFIG.refreshMs);
  }

  /* --- Loop dos feeds (agenda + noticias + clima) -------------------------*/
  function pollFeeds() {
    var url = (CONFIG.apiBase || '') + '/api/feeds?_=' + (new Date()).getTime();
    /* Timeout de 40s: feeds chamam APIs externas; a agenda pode levar ate ~25s. */
    getJSON(url, function (data) {
      try {
        lastCalendar = data.calendar;
        Widgets.renderCalendar(byId('section-calendar'), data.calendar);
        Widgets.renderNews(byId('section-news'), data.news);
        feedsLoaded = true;

        if (data.weather && data.weather.configured) {
          var firstTime = !lastWeather;
          lastWeather = data.weather;
          if (firstTime) {
            startWeatherRotation();
          } else {
            /* Atualiza o slide visivel com dados mais recentes */
            Widgets.renderWeatherSlide(weatherRefs.panel, lastWeather, weatherSlide);
          }
        }
      } catch (e) { reportError('pollFeeds', e); }
      setTimeout(pollFeeds, CONFIG.feedsRefreshMs);
    }, function () {
      if (!feedsLoaded) { showFeedMessage('Sem conexao com o servidor.'); }
      /* Falha de rede: tenta de novo em 30s em vez de esperar 10 min */
      setTimeout(pollFeeds, 30000);
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

  /* --- Relogio ------------------------------------------------------------*/
  function clockText(d) {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function tickClock() {
    setText(byId('clock'), clockText(new Date()));
    setTimeout(tickClock, 1000);
  }

  /* --- Inicializacao ------------------------------------------------------*/
  buildWidgets();
  window.onresize = resizeAllCanvases;
  showFeedMessage('Carregando...');
  tickClock();
  poll();
  pollFeeds();
  setTimeout(calendarTick, 60000);

})();
