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

  function byId(id) { return document.getElementById(id); }

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

    setText(byId('hostname'), hostData.hostname || DASH);

    Widgets.renderMeta(byId('section-meta'), hostData);

    for (i = 0; i < CONFIG.widgets.length; i++) {
      widget = CONFIG.widgets[i];
      if (widget.spark) {
        pushBuffer(widget.id, getPath(data, widget.path));
      }
      Widgets.update(refs[widget.id], widget, data, buffers[widget.id]);
    }

    pushNetBuffer(data);
    Widgets.updateNetCard(netRefs, data, netBuffer);

    Widgets.renderDockerSummary(byId('section-docker-summary'), data.containers);

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

  /* --- Loop de polling ----------------------------------------------------*/
  function poll() {
    var url = (CONFIG.apiBase || '') + '/api/metrics?_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      setOnline(true);
      try { render(data); } catch (e) { /* nunca quebra o loop */ }
      schedule();
    }, function () {
      setOnline(false);
      schedule();
    });
  }

  function schedule() {
    setTimeout(poll, CONFIG.refreshMs);
  }

  /* --- Loop dos feeds (agenda + noticias) ---------------------------------*/
  function pollFeeds() {
    var url = (CONFIG.apiBase || '') + '/api/feeds?_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      try {
        Widgets.renderCalendar(byId('section-calendar'), data.calendar);
        Widgets.renderNews(byId('section-news'), data.news);
        feedsLoaded = true;
      } catch (e) { /* nunca quebra o loop */ }
      setTimeout(pollFeeds, CONFIG.feedsRefreshMs);
    }, function () {
      if (!feedsLoaded) { showFeedMessage('Sem conexao com o servidor.'); }
      setTimeout(pollFeeds, CONFIG.feedsRefreshMs);
    });
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

})();
