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
  var weatherCurrentId = 'city';
  var weatherGeneration = 0;     /* invalida setTimeouts antigos ao reiniciar */
  var WEATHER_SHOW_MS = 10000;
  var WEATHER_FADE_MS = 800;

  /* Loop dos feeds: timer trackeado p/ permitir refetch imediato sem
     acumular setTimeouts (chamado em Settings.onBackendSave). */
  var feedsTimer = null;

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

    Widgets.renderSystemInfo(byId('system-modal-body'), hostData, data.containers);

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

  /* --- Modal da lista de containers --------------------------------------*/
  function openContainersModal() {
    var m = byId('containers-modal');
    if (m) { m.className = 'modal-backdrop modal-backdrop--open'; }
  }

  function closeContainersModal() {
    var m = byId('containers-modal');
    if (m) { m.className = 'modal-backdrop'; }
  }

  function wireContainersModal() {
    /* O card Docker (#section-docker-summary) persiste — renderDockerSummary
       so troca os filhos via innerHTML, entao o onclick sobrevive. */
    var dockerCard = byId('section-docker-summary');
    if (dockerCard) { dockerCard.onclick = openContainersModal; }

    var backdrop = byId('containers-modal');
    if (backdrop) { backdrop.onclick = closeContainersModal; }

    /* Clique dentro da caixa nao chega ao backdrop (que fecha o modal). */
    var box = byId('containers-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }

    var closeBtn = byId('containers-modal-close');
    if (closeBtn) { closeBtn.onclick = closeContainersModal; }
  }

  /* --- Modal "Sistema" (botao (i) no titulo do painel Host) --------------*/
  function openSystemModal() {
    var m = byId('system-modal');
    if (m) { m.className = 'modal-backdrop modal-backdrop--open'; }
  }

  function closeSystemModal() {
    var m = byId('system-modal');
    if (m) { m.className = 'modal-backdrop'; }
  }

  function wireSystemModal() {
    var btn = byId('host-info-btn');
    if (btn) {
      btn.innerHTML = ICONS.info;
      btn.onclick = openSystemModal;
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
    setText(byId('logs-modal-pre'), 'Carregando...');
    var m = byId('logs-modal');
    if (m) { m.className = 'modal-backdrop modal-backdrop--open'; }
    fetchLogs(id, true);
    if (logsInterval) { clearInterval(logsInterval); }
    logsInterval = setInterval(function () {
      fetchLogs(id, false);
    }, LOGS_REFRESH_MS);
  }

  function closeLogsModal() {
    if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
    currentLogId = null;
    var m = byId('logs-modal');
    if (m) { m.className = 'modal-backdrop'; }
  }

  function fetchLogs(id, force) {
    var url = (CONFIG.apiBase || '') + '/api/containers/'
            + encodeURIComponent(id) + '/logs?tail=' + LOGS_TAIL
            + '&_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      if (currentLogId !== id) { return; }  /* trocou de container */
      var pre = byId('logs-modal-pre');
      var body = byId('logs-modal-body');
      if (data.error) { setText(pre, 'Erro: ' + data.error); return; }
      var text = data.logs || '';
      /* Preserva posicao se o usuario subiu para ler historico. */
      var nearBottom = !body
        || (body.scrollHeight - body.scrollTop - body.clientHeight < 50);
      setText(pre, text || '(sem logs)');
      if (body && (force || nearBottom)) { body.scrollTop = body.scrollHeight; }
    }, function (err) {
      if (currentLogId !== id) { return; }
      setText(byId('logs-modal-pre'), 'Erro ao buscar logs: ' + err);
    });
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

  /* --- Rotacao do widget de clima (painel unico) -------------------------*/
  /* Slides ativos vem do Settings (subset de current/forecast/moon). Cada
     startWeatherRotation gera um novo "token" — setTimeouts antigos viram
     no-op, evitando rotacoes duplicadas quando o usuario salva configs. */

  function enabledWeatherSlides() {
    var s = (window.Settings && Settings.weatherSlides)
            ? Settings.weatherSlides() : ['current', 'forecast', 'moon'];
    return s.length ? s : ['current'];
  }

  function renderWeatherCurrent() {
    if (!weatherRefs || !lastWeather) { return; }
    Widgets.renderWeatherSlide(weatherRefs.panel, lastWeather, weatherCurrentId);
  }

  function weatherStep(gen) {
    if (gen !== weatherGeneration) { return; }
    if (!weatherRefs || !lastWeather || !lastWeather.configured) { return; }

    var panel = weatherRefs.panel;
    panel.className = 'weather-panel weather-hidden';

    setTimeout(function () {
      if (gen !== weatherGeneration) { return; }
      var enabled = enabledWeatherSlides();
      var nextId;
      if (weatherCurrentId === 'city') {
        /* Saindo da intro: vai pro primeiro slide habilitado. */
        nextId = enabled[0];
      } else {
        var i = enabled.indexOf(weatherCurrentId);
        nextId = (i < 0) ? enabled[0] : enabled[(i + 1) % enabled.length];
      }
      weatherCurrentId = nextId;
      renderWeatherCurrent();
      panel.className = 'weather-panel';
      /* So continua girando se ha >1 slides habilitados (city ja saiu). */
      if (enabled.length > 1) {
        setTimeout(function () { weatherStep(gen); }, WEATHER_SHOW_MS);
      }
    }, WEATHER_FADE_MS);
  }

  function startWeatherRotation() {
    if (!weatherRefs || !lastWeather || !lastWeather.configured) { return; }
    weatherGeneration += 1;
    var gen = weatherGeneration;
    /* Sempre comeca pelo slide 'city' (intro, exibido uma vez). */
    weatherCurrentId = 'city';
    renderWeatherCurrent();
    weatherRefs.panel.className = 'weather-panel';
    setTimeout(function () { weatherStep(gen); }, WEATHER_SHOW_MS);
  }

  /* Mostra/esconde sparklines conforme Settings.spark(id). */
  function applySparkVisibility() {
    if (!window.Settings) { return; }
    var id;
    for (id in refs) {
      if (refs.hasOwnProperty(id) && refs[id] && refs[id].canvas) {
        refs[id].canvas.style.display = Settings.spark(id) ? '' : 'none';
      }
    }
    if (netRefs && netRefs.canvas) {
      netRefs.canvas.style.display = Settings.spark('net') ? '' : 'none';
    }
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
    /* Cancela timer pendente — permite refetch imediato (onBackendSave) sem
       acumular polls em paralelo. */
    if (feedsTimer) { clearTimeout(feedsTimer); feedsTimer = null; }

    var url = (CONFIG.apiBase || '') + '/api/feeds?_=' + (new Date()).getTime();
    /* Timeout de 40s: feeds chamam APIs externas; a agenda pode levar ate ~25s. */
    getJSON(url, function (data) {
      try {
        lastCalendar = data.calendar;
        Widgets.renderCalendar(byId('section-calendar'), data.calendar);
        Widgets.renderNews(byId('section-news'), data.news);
        feedsLoaded = true;

        if (data.weather && data.weather.configured) {
          var prevCity = lastWeather ? lastWeather.city : null;
          var firstTime = !lastWeather;
          lastWeather = data.weather;
          /* Cidade nova (ou primeira carga): reinicia rotacao — o slide
             'city' reaparece confirmando visualmente a mudanca. */
          if (firstTime || data.weather.city !== prevCity) {
            startWeatherRotation();
          } else {
            renderWeatherCurrent();
          }
        }
      } catch (e) { reportError('pollFeeds', e); }
      feedsTimer = setTimeout(pollFeeds, CONFIG.feedsRefreshMs);
    }, function () {
      if (!feedsLoaded) { showFeedMessage('Sem conexao com o servidor.'); }
      /* Falha de rede: tenta de novo em 30s em vez de esperar 10 min */
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
  wireContainersModal();
  wireSystemModal();
  wireLogsModal();
  applySparkVisibility();
  if (window.Settings && Settings.onChange) {
    Settings.onChange(function () {
      applySparkVisibility();
      /* Slides do clima: weatherStep le enabledWeatherSlides() a cada passo,
         entao toggles aplicam sozinhos no proximo ciclo (sem restart aqui — evita
         mostrar a cidade ANTIGA por um instante quando o save inclui troca de cidade). */
    });
  }
  if (window.Settings && Settings.onBackendSave) {
    Settings.onBackendSave(function () {
      /* Save de fonte de dados (cidade/URL/limite/dias): refaz pollFeeds
         imediato em vez de esperar o ciclo de 10 min. */
      pollFeeds();
    });
  }
  window.onresize = resizeAllCanvases;
  showFeedMessage('Carregando...');
  tickClock();
  poll();
  pollFeeds();
  setTimeout(calendarTick, 60000);

})();
