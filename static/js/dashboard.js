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

    /* Recomputa altura dos feeds: docker top-3 ou subs podem ter mudado
       a altura do painel host, alterando o espaco disponivel pras listas. */
    sizeFeedLists();
    Widgets.renderDiskModal(byId('disk-modal-body'), hostData.disk);
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

  /* --- Menu de status (dropdown "Full refresh") ---------------------------*/
  function wireStatusMenu() {
    var btn = byId('status-btn');
    var menu = byId('status-menu');
    var refreshBtn = byId('status-refresh-btn');
    if (!btn || !menu) { return; }

    btn.onclick = function (e) {
      e.stopPropagation();
      var open = menu.className.indexOf('status-menu--open') >= 0;
      menu.className = open ? 'status-menu' : 'status-menu status-menu--open';
    };

    if (refreshBtn) {
      refreshBtn.onclick = function () {
        location.reload(true);
      };
    }

    document.addEventListener('click', function () {
      menu.className = 'status-menu';
    });
  }

  /* --- Modal da lista de containers --------------------------------------*/
  function openContainersModal() { Modals.open('containers-modal'); }
  function closeContainersModal() { Modals.close('containers-modal'); }

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

  /* --- Modal de particoes de disco ----------------------------------------*/
  function openDiskModal()  { Modals.open('disk-modal');  }
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
  function openSystemModal() { Modals.open('system-modal'); }
  function closeSystemModal() { Modals.close('system-modal'); }

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

  /* --- Modal de detalhes do clima (clique no carrossel da topbar) -------*/
  function openWeatherModal() {
    if (!lastWeather) { return; }   /* sem dados ainda */
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

  /* --- Modal de leitura (clique no card de noticia) ---------------------- */
  function openArticleModal(item) {
    if (!item || !item.link) { return; }
    var srcEl = byId('article-modal-source');
    var bodyEl = byId('article-modal-body');
    var extEl = byId('article-modal-extlink');

    setText(srcEl, 'Carregando...');
    if (extEl) { extEl.href = item.link; }
    bodyEl.innerHTML = '';
    bodyEl.scrollTop = 0;

    /* Pre-renderiza com o que ja temos do RSS (imagem aparece instantanea). */
    if (item.image) {
      var img = el('img', 'article-hero-img');
      img.src = item.image; img.alt = '';
      bodyEl.appendChild(img);
    }
    if (item.title) {
      bodyEl.appendChild(el('h1', 'article-title', item.title));
    }
    var loader = el('div', 'article-loading', 'Carregando o conteudo...');
    bodyEl.appendChild(loader);

    Modals.open('article-modal');

    var url = (CONFIG.apiBase || '') + '/api/article?url='
            + encodeURIComponent(item.link) + '&_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      if (!Modals.isOpen('article-modal')) { return; }
      if (data && data.error) {
        loader.className = 'article-error';
        setText(loader, 'Nao foi possivel extrair: ' + data.error);
        return;
      }
      setText(srcEl, data.site || data.title || 'Noticia');
      bodyEl.innerHTML = '';
      var image = item.image || data.image;
      if (image) {
        var img2 = el('img', 'article-hero-img');
        img2.src = image; img2.alt = '';
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
      setText(loader, 'Erro ao buscar: ' + err);
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

  /* --- Sizing dos feed-lists em PIXELS (necessario para Safari 9 / iPad 2) -
     iOS Safari 9 nao trata altura flex-calculada como "definida" para
     overflow-y rolar, e position:absolute colapsa quando o pai nao tem
     height:100% resolvido contra parent flex. A solucao bulletproof: medir
     a viewport e descontar topbar+host+titulo+padings, depois setar
     .feed-list.style.height em pixels diretos. iOS aceita sem questionar
     e ativa o momentum touch. */
  function sizeFeedLists() {
    var lists = document.getElementsByClassName('feed-list');
    if (!lists || !lists.length) { return; }
    /* Mobile (< 601 px): empilhamento vertical com scroll global — limpa
       qualquer altura que tenhamos setado em sessoes anteriores. */
    if (window.innerWidth < 601) {
      for (var i = 0; i < lists.length; i++) { lists[i].style.height = ''; }
      return;
    }
    var viewportH = document.documentElement.clientHeight || window.innerHeight;
    var topbarEl  = document.getElementsByClassName('topbar')[0];
    var hostEl    = document.getElementsByClassName('panel')[0]; // 1a .panel = host
    var titleEl   = document.getElementsByClassName('panel-title')[0];
    var topbarH = topbarEl ? topbarEl.offsetHeight : 0;
    var hostH   = hostEl   ? hostEl.offsetHeight   : 0;
    var titleH  = titleEl  ? titleEl.offsetHeight  : 16;
    var titleMb = 12; /* default .panel-title margin-bottom (base.css) */
    if (titleEl && window.getComputedStyle) {
      try {
        var parsed = parseInt(window.getComputedStyle(titleEl).marginBottom, 10);
        if (!isNaN(parsed)) { titleMb = parsed; }
      } catch (e) { /* ignore */ }
    }
    /* main padding 8/24 + .panel margin-bottom 20 (espaco entre host e feeds). */
    var avail = viewportH - topbarH - 8 - 24 - hostH - 20 - titleH - titleMb;
    if (avail < 80) { avail = 80; }
    for (var j = 0; j < lists.length; j++) {
      lists[j].style.height = avail + 'px';
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
          try {
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
            /* Atualiza o modal de detalhes se estiver aberto. */
            if (window.Modals && Modals.isOpen('weather-modal')) {
              Widgets.renderWeatherDetail(byId('weather-modal-body'), lastWeather);
            }
          } catch (e) { reportError('weather-render', e); }
        } else if (data.weather && weatherRefs && !data.weather.configured) {
          /* Nao configurado OU erro sem cache previo: pilula discreta
             sinalizando que o backend continua tentando. Some sozinho quando
             a proxima resposta vier com configured:true (firstTime=true,
             startWeatherRotation() reescreve o painel). */
          weatherRefs.panel.innerHTML = '';
          var pill = el('span', 'weather-val weather-retry');
          pill.appendChild(document.createTextNode(
              data.weather.error ? 'Clima indisponível, tentando…'
                                 : 'Clima não configurado'));
          weatherRefs.panel.appendChild(pill);
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

  /* Placeholder animado para feeds enquanto pollFeeds nao retorna pela 1a vez.
     Usado SO na carga inicial — refreshes subsequentes escrevem por cima do
     conteudo real sem piscar skeleton. */
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
  wireStatusMenu();
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
  window.onresize = function () {
    resizeAllCanvases();
    sizeFeedLists();
  };
  showFeedSkeleton('section-calendar', 4);
  showFeedSkeleton('section-news', 4);
  /* Primeira medicao: depois do paint inicial dos skeletons, pra
     offsetHeight da topbar/host ja estar disponivel. setTimeout(0)
     enfileira no proximo tick — Safari 9 nao tem rAF prefixado. */
  setTimeout(sizeFeedLists, 0);
  tickClock();
  poll();
  pollFeeds();
  setTimeout(calendarTick, 60000);

})();
