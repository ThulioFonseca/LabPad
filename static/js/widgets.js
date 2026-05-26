/* =============================================================================
 * widgets.js  —  criacao e atualizacao dos cards.
 *
 * Generico: widgets novos sao definidos so em config.js; nao se mexe aqui.
 * Depende de format.js (el, setText, getPath, fmt*) e icons.js (ICONS, ...).
 * Tudo em JavaScript ES5 (var/function) por causa do Safari 9 / iPad 2.
 * ===========================================================================*/

/* Mapeia o id do widget gauge para a chave do icone em ICONS. */
var GAUGE_ICONS = { cpu: 'cpu', mem: 'mem', temp: 'temp', disk: 'disk' };

/* Nivel (ok/warn/crit) de um valor segundo os limites do widget. */
function levelFor(widget, value) {
  if (typeof value !== 'number' || !isFinite(value)) { return 'none'; }
  if (widget.crit !== undefined && value >= widget.crit) { return 'crit'; }
  if (widget.warn !== undefined && value >= widget.warn) { return 'warn'; }
  return 'ok';
}

/* Cores dos sparklines. ESPELHA a paleta de theme.css — ajuste junto se mudar. */
var LEVEL_COLOR = {
  ok:   '#4f8cff',
  warn: '#d29922',
  crit: '#f85149',
  none: '#6a7080'
};


/* --- Componentes ----------------------------------------------------------*/

var Widgets = {};

/* Cria um <span class="skeleton skeleton-XXX"> para usar como placeholder
   animado durante a carga inicial. setText() em format.js troca o elemento
   por um nodo de texto puro no primeiro update — o pulso some sozinho. */
Widgets._skel = function (sizeClass) {
  return el('span', 'skeleton ' + (sizeClass || 'skeleton-num'));
};

/* Monta <div.card-head> com <span.card-title> contendo icone (opcional) + texto. */
Widgets._cardHead = function (iconKey, titleText) {
  var head = el('div', 'card-head');
  var titleEl = el('span', 'card-title');
  if (iconKey && ICONS[iconKey]) {
    var iconSpan = el('span', 'card-icon');
    iconSpan.innerHTML = ICONS[iconKey];
    titleEl.appendChild(iconSpan);
  }
  titleEl.appendChild(document.createTextNode(titleText));
  head.appendChild(titleEl);
  return head;
};

/* Cria o DOM de um widget. Devolve um objeto com 'root' e refs para updates. */
Widgets.create = function (widget) {
  if (widget.kind === 'info') { return Widgets._createInfo(widget); }
  return Widgets._createGauge(widget);
};

/* Atualiza um widget ja criado com os dados de /api/metrics. */
Widgets.update = function (refs, widget, data, buffer) {
  if (!refs) { return; }
  if (widget.kind === 'info') { return Widgets._updateInfo(refs, widget, data); }
  return Widgets._updateGauge(refs, widget, data, buffer);
};

/* ---- gauge ---- */

Widgets._createGauge = function (widget) {
  var root = el('div', 'card card--none');

  var head = Widgets._cardHead(GAUGE_ICONS[widget.id] || null, widget.title);
  var value = el('span', 'card-value');
  /* Skeleton no numero ate o primeiro update (setText o substitui). */
  var num = el('span', 'num');
  num.appendChild(Widgets._skel('skeleton-num'));
  value.appendChild(num);
  value.appendChild(el('span', 'unit', widget.unit || ''));
  head.appendChild(value);
  root.appendChild(head);

  /* Barra: comeca como bloco shimmer; _updateGauge tira a classe assim
     que chega valor numerico (a partir dai e gradiente normal). */
  var bar = el('div', 'bar');
  var fill = el('div', 'bar-fill skeleton-block');
  bar.appendChild(fill);
  root.appendChild(bar);

  /* Sub linha: so vira skeleton se o widget realmente preenche o sub
     (mem/disk com "used / total"). CPU e Temp nao tem sub — fica como
     espaco em branco para manter altura do card sem skeleton orfao. */
  var sub = widget.sub
    ? el('div', 'card-sub')
    : el('div', 'card-sub', ' ');
  if (widget.sub) {
    sub.appendChild(Widgets._skel('skeleton-line'));
  }
  root.appendChild(sub);

  var canvas = null;
  if (widget.spark) {
    canvas = el('canvas', 'spark skeleton-block');
    root.appendChild(canvas);
  }
  return { root: root, num: num, fill: fill, sub: sub, canvas: canvas };
};

Widgets._updateGauge = function (refs, widget, data, buffer) {
  var value = getPath(data, widget.path);
  var hasValue = (typeof value === 'number' && isFinite(value));
  var level = levelFor(widget, value);
  var max = widget.max || 100;

  setText(refs.num, hasValue ? fmtNumber(value) : DASH);
  refs.root.className = 'card card--' + level;

  /* Primeiro update real: remove o shimmer da barra e do canvas. Idempotente:
     indexOf >= 0 falha silenciosa apos o swap, sem custo perceptivel. */
  if (hasValue && refs.fill.className.indexOf('skeleton-block') >= 0) {
    refs.fill.className = 'bar-fill';
  }
  if (hasValue && refs.canvas &&
      refs.canvas.className.indexOf('skeleton-block') >= 0) {
    refs.canvas.className = 'spark';
  }

  var pct = hasValue ? (value / max) * 100 : 0;
  if (pct < 0) { pct = 0; }
  if (pct > 100) { pct = 100; }
  refs.fill.style.width = pct + '%';

  if (widget.sub) {
    setText(refs.sub, fmtBytes(getPath(data, widget.sub.used)) +
                      ' / ' + fmtBytes(getPath(data, widget.sub.total)));
  }

  if (refs.canvas && buffer) {
    drawSparkline(refs.canvas, buffer, LEVEL_COLOR[level] || LEVEL_COLOR.ok);
  }
};

/* ---- info (texto) ---- */

Widgets._createInfo = function (widget) {
  var root = el('div', 'info-item');
  root.appendChild(el('span', 'info-label', widget.title));
  var value = el('span', 'info-value', DASH);
  root.appendChild(value);
  return { root: root, value: value };
};

Widgets._updateInfo = function (refs, widget, data) {
  var value = getPath(data, widget.path);
  var text;
  if (widget.fmt === 'duration') {
    text = fmtDuration(value);
  } else if (widget.fmt === 'load') {
    text = Widgets._fmtLoad(value);
  } else if (value === null || value === undefined || value === '') {
    text = DASH;
  } else {
    text = String(value);
  }
  setText(refs.value, text);
};

Widgets._fmtLoad = function (arr) {
  if (!arr || !arr.length) { return DASH; }
  var parts = [];
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    parts.push((v === null || v === undefined) ? DASH : v);
  }
  return parts.join('   ');
};


/* --- Lista de containers --------------------------------------------------*/
/* Reconstruida inteira a cada ciclo: a lista e pequena e simplifica o codigo. */

Widgets.renderContainers = function (container, payload) {
  container.innerHTML = '';

  if (payload && payload.error) {
    container.appendChild(
      el('div', 'empty', 'Erro ao ler containers: ' + payload.error));
    return;
  }

  var list = (payload && payload.list) ? payload.list : [];
  if (!list.length) {
    container.appendChild(el('div', 'empty', 'Nenhum container encontrado.'));
    return;
  }

  for (var i = 0; i < list.length; i++) {
    container.appendChild(Widgets._containerRow(list[i]));
  }
};

Widgets._containerRow = function (c) {
  var running = (c.status === 'running');
  var level = 'ok';
  if (running) {
    var cpuVal = typeof c.cpu_percent === 'number' ? c.cpu_percent : 0;
    var memVal = typeof c.mem_percent === 'number' ? c.mem_percent : 0;
    if (cpuVal >= 95 || memVal >= 95) { level = 'crit'; }
    else if (cpuVal >= 80 || memVal >= 80) { level = 'warn'; }
  }
  var rowCls = 'crow crow--' + (running ? 'up' : 'down');
  if (running && level !== 'ok') { rowCls += ' crow--' + level; }
  var row = el('div', rowCls);

  row.appendChild(el('span', 'cdot'));

  var main = el('div', 'cmain');
  main.appendChild(el('span', 'cname', c.name || '?'));
  main.appendChild(el('span', 'cimage', c.image || ''));
  row.appendChild(main);

  var cpu = (running && typeof c.cpu_percent === 'number')
          ? (fmtNumber(c.cpu_percent) + '%') : DASH;
  row.appendChild(Widgets._cstat('CPU', cpu));

  var ram = (running && c.mem_used !== null && c.mem_used !== undefined)
          ? fmtBytes(c.mem_used) : DASH;
  row.appendChild(Widgets._cstat('RAM', ram));

  var mini = el('div', 'cmini');
  var miniFill = el('div', 'cmini-fill');
  var mp = (running && typeof c.mem_percent === 'number') ? c.mem_percent : 0;
  if (mp < 0) { mp = 0; }
  if (mp > 100) { mp = 100; }
  miniFill.style.width = mp + '%';
  mini.appendChild(miniFill);
  row.appendChild(mini);

  row.appendChild(el('span', 'cstatus', running ? 'up' : (c.status || 'down')));

  /* Anota id/nome para o delegate de clique abrir o modal de logs. */
  row.setAttribute('data-id', c.id || '');
  row.setAttribute('data-name', c.name || '');
  return row;
};

Widgets._cstat = function (label, value) {
  var wrap = el('div', 'cstat');
  wrap.appendChild(el('span', 'cstat-label', label));
  wrap.appendChild(el('span', 'cstat-val', value));
  return wrap;
};


/* --- Agenda (calendario) --------------------------------------------------*/

Widgets.renderCalendar = function (container, payload) {
  container.innerHTML = '';

  if (!payload || !payload.configured) {
    container.appendChild(el('div', 'empty', 'Agenda nao configurada.'));
    return;
  }
  if (payload.error) {
    container.appendChild(el('div', 'empty', 'Nao foi possivel ler a agenda.'));
    return;
  }

  var events = payload.events || [];
  if (!events.length) {
    container.appendChild(el('div', 'empty', 'Nenhum evento nos proximos dias.'));
    return;
  }

  var lastDay = null;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.day_key !== lastDay) {
      container.appendChild(el('div', 'feed-day', ev.day_label || ''));
      lastDay = ev.day_key;
    }
    container.appendChild(Widgets._calEvent(ev));
  }
};

Widgets._calEvent = function (ev) {
  var now = Math.floor(Date.now() / 1000);
  var cls = 'cal-event';
  if (ev.start_epoch && ev.end_epoch && now >= ev.start_epoch && now < ev.end_epoch) {
    cls += ' cal-event--active';
  } else if (ev.start_epoch && ev.start_epoch > now && (ev.start_epoch - now) <= 900) {
    cls += ' cal-event--soon';
  }
  var row = el('div', cls);
  row.appendChild(el('span', 'cal-time', ev.time_label || ''));
  var body = el('div', 'cal-body');
  body.appendChild(el('div', 'cal-title', ev.title || '(sem titulo)'));
  if (ev.location) { body.appendChild(el('div', 'cal-loc', ev.location)); }
  row.appendChild(body);
  return row;
};


/* --- Modal "Sistema": info de hardware/software por grupos --------------- */

Widgets.renderSystemInfo = function (node, hostData, containersData) {
  if (!node) { return; }
  node.innerHTML = '';
  hostData = hostData || {};
  var info = hostData.info || {};
  var runtime = (containersData && containersData.runtime) || {};

  function group(title, rows) {
    var g = el('div', 'sys-group');
    g.appendChild(el('div', 'sys-group-title', title));
    for (var i = 0; i < rows.length; i++) {
      var row = el('div', 'sys-row');
      row.appendChild(el('div', 'sys-key', rows[i][0]));
      var v = rows[i][1];
      var txt = (v === undefined || v === null || v === '') ? DASH : String(v);
      row.appendChild(el('div', 'sys-val', txt));
      g.appendChild(row);
    }
    return g;
  }

  /* Sistema */
  node.appendChild(group('Sistema', [
    ['Hostname',     hostData.hostname],
    ['SO',           hostData.os],
    ['Kernel',       info.kernel],
    ['Arquitetura',  info.arch]
  ]));

  /* CPU */
  var loadStr = (hostData.load && hostData.load.length
                 && hostData.load[0] !== null)
    ? hostData.load.join('  \xb7  ') : DASH;
  node.appendChild(group('CPU', [
    ['Modelo',          info.cpu_model],
    ['Nucleos fisicos', info.cpu_count_physical],
    ['Nucleos logicos', hostData.cpu_count],
    ['Load (1\xb75\xb715m)', loadStr]
  ]));

  /* Memoria */
  node.appendChild(group('Memoria', [
    ['Total', fmtBytes(hostData.mem_total)]
  ]));

  /* Disco */
  var diskRows = [];
  var disks = hostData.disk || [];
  for (var d = 0; d < disks.length; d++) {
    var dk = disks[d];
    var pct = (dk.percent !== null && dk.percent !== undefined)
      ? dk.percent + '% usado' : DASH;
    diskRows.push([dk.label, fmtBytes(dk.total) + '  \xb7  ' + pct]);
  }
  if (!diskRows.length) { diskRows.push(['(nenhum)', '']); }
  node.appendChild(group('Disco', diskRows));

  /* Rede */
  var netRows = [];
  var ifaces = info.interfaces || [];
  for (var k = 0; k < ifaces.length; k++) {
    var nif = ifaces[k];
    var detail = [];
    if (nif.ipv4) { detail.push(nif.ipv4); }
    if (nif.mac)  { detail.push(nif.mac); }
    if (nif.speed_mbps) { detail.push(nif.speed_mbps + ' Mbps'); }
    if (nif.mtu) { detail.push('MTU ' + nif.mtu); }
    var label = nif.name + (nif.is_up === false ? ' (down)' : '');
    netRows.push([label, detail.join('  \xb7  ') || DASH]);
  }
  if (!netRows.length) { netRows.push(['(sem interfaces)', '']); }
  node.appendChild(group('Rede', netRows));

  /* Runtime */
  node.appendChild(group('Runtime', [
    ['Docker',  runtime.docker_version],
    ['Python',  info.python_version],
    ['Uptime',  fmtDuration(hostData.uptime)]
  ]));
};


/* --- Card de rede (double-row) ------------------------------------------- */

Widgets.initNetCard = function (cardEl) {
  if (!cardEl) { return null; }

  cardEl.appendChild(Widgets._cardHead('net', 'Rede'));

  var row = el('div', 'rate-row');

  var down = el('span', 'rate rate--down');
  down.appendChild(el('span', 'rate-arrow', '↓'));
  var rx = el('span', 'rate-val');
  rx.appendChild(Widgets._skel('skeleton-num'));
  down.appendChild(rx);

  var up = el('span', 'rate rate--up');
  up.appendChild(el('span', 'rate-arrow', '↑'));
  var tx = el('span', 'rate-val');
  tx.appendChild(Widgets._skel('skeleton-num'));
  up.appendChild(tx);

  row.appendChild(down);
  row.appendChild(up);
  cardEl.appendChild(row);

  var canvas = el('canvas', 'spark spark--fill skeleton-block');
  cardEl.appendChild(canvas);

  return { rx: rx, tx: tx, canvas: canvas };
};

Widgets.updateNetCard = function (refs, data, buffer) {
  if (!refs) { return; }
  setText(refs.rx, fmtRate(getPath(data, 'host.net_rx')));
  setText(refs.tx, fmtRate(getPath(data, 'host.net_tx')));
  /* Tira o shimmer do canvas no primeiro update — idempotente. */
  if (refs.canvas && refs.canvas.className.indexOf('skeleton-block') >= 0) {
    refs.canvas.className = 'spark spark--fill';
  }
  if (refs.canvas && buffer) {
    drawSparkline(refs.canvas, buffer, LEVEL_COLOR.ok);
  }
};


/* --- Docker Summary (double-row) ----------------------------------------- */

Widgets.renderDockerSummary = function (cardEl, payload) {
  if (!cardEl) { return; }
  cardEl.innerHTML = '';

  cardEl.appendChild(Widgets._cardHead('docker', 'Docker'));

  /* Sem payload (primeira pintura): renderiza skeletons no lugar da contagem
     e dos top-3. Polling subsequente sempre traz payload (mesmo que vazio),
     entao o caminho normal abaixo assume a partir do segundo tick. */
  if (!payload) {
    var skelCount = el('div', 'docker-count');
    skelCount.appendChild(Widgets._skel('skeleton-pill'));
    cardEl.appendChild(skelCount);
    var skelTop = el('div', 'docker-top');
    for (var s = 0; s < 3; s++) {
      var skelRow = el('div', 'docker-top-item');
      skelRow.appendChild(Widgets._skel('skeleton-line'));
      skelTop.appendChild(skelRow);
    }
    cardEl.appendChild(skelTop);
    return;
  }

  var list = (payload && payload.list) ? payload.list : [];
  var running = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i].status === 'running') { running = running + 1; }
  }

  cardEl.appendChild(el('div', 'docker-count',
    running + ' / ' + list.length + ' ativos'));

  /* Top 3 por score combinado CPU% + Mem% */
  var active = [];
  for (var j = 0; j < list.length; j++) {
    if (list[j].status === 'running') { active.push(list[j]); }
  }
  active.sort(function (a, b) {
    var sa = (a.cpu_percent || 0) + (a.mem_percent || 0);
    var sb = (b.cpu_percent || 0) + (b.mem_percent || 0);
    return sb - sa;
  });

  var top = active.slice(0, 3);
  if (top.length) {
    var topDiv = el('div', 'docker-top');
    for (var k = 0; k < top.length; k++) {
      var c = top[k];
      var item = el('div', 'docker-top-item');
      item.appendChild(el('span', 'docker-top-name', c.name || '?'));
      var cpuStr = (typeof c.cpu_percent === 'number')
        ? (fmtNumber(c.cpu_percent) + '% cpu') : DASH;
      item.appendChild(el('span', 'docker-top-cpu', cpuStr));
      topDiv.appendChild(item);
    }
    cardEl.appendChild(topDiv);
  }
};


/* --- Widget de clima (topbar center) ------------------------------------- */

/* Helpers do slide 'city': hora curta (HH:MMh) e data abreviada (Dow DD/MM).
   Reavaliados a cada vez que o carrossel volta para 'city'; o relogio em si
   continua sendo atualizado por tickClock() em dashboard.js via o span
   #weather-clock inserido abaixo. */
var WX_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
function _wxPad2(n) { return (n < 10 ? '0' : '') + n; }
function _wxDateLabel(d) {
  return WX_WEEKDAYS[d.getDay()] + ' ' + _wxPad2(d.getDate()) + '/' + _wxPad2(d.getMonth() + 1);
}
function _wxClockLabel(d) {
  return _wxPad2(d.getHours()) + ':' + _wxPad2(d.getMinutes()) + 'h';
}

Widgets.initWeather = function (containerEl) {
  if (!containerEl) { return null; }
  /* Um unico painel: troca de conteudo enquanto esta invisivel (opacity:0).
     Evita empilhar 3 elementos no topbar e problemas de layout/transition.
     Comeca VISIVEL com uma pill skeleton — assim que o primeiro slide
     entrar, renderWeatherSlide faz panel.innerHTML='' e tira o shimmer. */
  var panel = el('div', 'weather-panel');
  panel.appendChild(Widgets._skel('skeleton-pill'));
  containerEl.appendChild(panel);
  return { panel: panel };
};

/* Preenche o painel com o slide indicado. Aceita id string
   ('current'/'forecast'/'moon'/'city') ou indice numerico (compat: 0/1/2). */
Widgets.renderWeatherSlide = function (panel, payload, slideId) {
  if (!panel || !payload || !payload.configured) { return; }
  panel.innerHTML = '';

  var id = slideId;
  if (id === 0) { id = 'current'; }
  else if (id === 1) { id = 'forecast'; }
  else if (id === 2) { id = 'moon'; }

  if (id === 'city') {
    /* Slide de intro: hora atual  -  Dow DD/MM  -  cidade. O relogio recebe
       id #weather-clock para tickClock() (dashboard.js) atualizar a cada 1s
       enquanto este slide estiver visivel. */
    var now = new Date();
    var line = el('span', 'weather-val');
    var clock = el('span', 'weather-clock');
    clock.id = 'weather-clock';
    clock.appendChild(document.createTextNode(_wxClockLabel(now)));
    line.appendChild(clock);
    line.appendChild(document.createTextNode(
        '  -  ' + _wxDateLabel(now) + '  -  ' + (payload.city || DASH)));
    panel.appendChild(line);
    return;
  }

  if (id === 'current') {
    /* Temperatura atual + humidade */
    var cur = payload.current || {};
    var icon0 = el('span', 'weather-icon');
    icon0.innerHTML = _wmoIcon(cur.code || 0);
    panel.appendChild(icon0);
    panel.appendChild(el('span', 'weather-val',
      (cur.temp !== undefined ? cur.temp + '\xb0C' : DASH)));
    panel.appendChild(el('span', 'weather-sep', '\xb7'));
    panel.appendChild(el('span', 'weather-val',
      (cur.humidity !== undefined ? cur.humidity + '%' : DASH)));

  } else if (id === 'forecast') {
    /* Previsao 5 dias — pula daily[0] (hoje). No desktop sao todos visiveis;
       no mobile o CSS aplica um marquee infinito sobre o track. A duplicata
       (2a passada) garante que o loop emende sem salto visual (mobile-only;
       desktop esconde via CSS). */
    var daily = payload.daily || [];
    var dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

    function buildDay(f) {
      var dayEl = el('span', 'weather-day');
      var d = f.date ? new Date(f.date + 'T12:00:00') : null;
      dayEl.appendChild(el('span', 'weather-day-name', d ? dayNames[d.getDay()] : ''));
      var ic = el('span', 'weather-icon');
      ic.innerHTML = _wmoIcon(f.code || 0);
      dayEl.appendChild(ic);
      dayEl.appendChild(el('span', 'weather-day-temp', _fmtTemp(f.high) + '/' + _fmtTemp(f.low)));
      return dayEl;
    }

    var wrap = el('span', 'weather-forecast');
    var track = el('span', 'weather-forecast-track');
    for (var pass = 0; pass < 2; pass++) {
      for (var fi = 1; fi < daily.length && fi < 6; fi++) {
        track.appendChild(buildDay(daily[fi]));
      }
    }
    wrap.appendChild(track);
    panel.appendChild(wrap);

  } else {
    /* Fase da lua */
    var moon = payload.moon || {};
    var icon2 = el('span', 'weather-icon');
    icon2.innerHTML = MOON_ICONS[moon.phase_index || 0] || '';
    panel.appendChild(icon2);
    panel.appendChild(el('span', 'weather-val', moon.name || DASH));
  }
};


/* --- Noticias (RSS) -------------------------------------------------------*/

Widgets.renderNews = function (container, payload) {
  container.innerHTML = '';

  if (!payload || !payload.configured) {
    container.appendChild(el('div', 'empty', 'Feed de noticias nao configurado.'));
    return;
  }
  if (payload.error) {
    container.appendChild(el('div', 'empty', 'Nao foi possivel ler o feed.'));
    return;
  }

  var items = payload.items || [];
  if (!items.length) {
    container.appendChild(el('div', 'empty', 'Sem noticias no momento.'));
    return;
  }

  for (var i = 0; i < items.length; i++) {
    container.appendChild(Widgets._newsItem(items[i]));
  }
};

Widgets._newsItem = function (item) {
  /* Anota link/titulo/imagem no row para o delegate de clique abrir o
     modal de leitura. Usado tanto na variante simples quanto na media. */
  function annotate(node) {
    node.setAttribute('data-link',  item.link  || '');
    node.setAttribute('data-title', item.title || '');
    node.setAttribute('data-image', item.image || '');
  }

  /* Sem imagem: layout atual (titulo + idade empilhados). */
  if (!item.image) {
    var plain = el('div', 'news-item');
    plain.appendChild(el('div', 'news-title', item.title || ''));
    if (item.age) { plain.appendChild(el('div', 'news-age', item.age)); }
    annotate(plain);
    return plain;
  }
  /* Com imagem: miniatura quadrada a esquerda, texto ao lado. */
  var row = el('div', 'news-item news-item--media');
  var thumb = el('div', 'news-thumb');
  thumb.style.backgroundImage = 'url("' + item.image + '")';
  row.appendChild(thumb);
  var text = el('div', 'news-text');
  text.appendChild(el('div', 'news-title', item.title || ''));
  if (item.age) { text.appendChild(el('div', 'news-age', item.age)); }
  row.appendChild(text);
  annotate(row);
  return row;
};


/* === Modal de clima detalhado (estilo iPhone / HA forecast card) ========= */

var _SVGNS = 'http://www.w3.org/2000/svg';

function _svg(tag, attrs) {
  var n = document.createElementNS(_SVGNS, tag);
  if (attrs) {
    for (var k in attrs) {
      if (attrs.hasOwnProperty(k)) { n.setAttribute(k, attrs[k]); }
    }
  }
  return n;
}

function _wxSection(title) {
  var s = el('section', 'wx-section');
  if (title) { s.appendChild(el('h3', 'wx-section-title', title)); }
  return s;
}

function _windCardinal(deg) {
  if (deg === undefined || deg === null) { return ''; }
  var dirs = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

function _uvLevel(uv) {
  if (uv === null || uv === undefined) { return ''; }
  if (uv < 3)  { return 'Baixo'; }
  if (uv < 6)  { return 'Moderado'; }
  if (uv < 8)  { return 'Alto'; }
  if (uv < 11) { return 'Muito alto'; }
  return 'Extremo';
}

function _fmtTemp(v) {
  return (v === null || v === undefined) ? DASH : Math.round(v) + '\xb0';
}

function _hourLabel(iso) {
  /* '2026-05-23T14:00' -> '14h' */
  if (!iso || iso.indexOf('T') < 0) { return ''; }
  return iso.split('T')[1].substring(0, 2) + 'h';
}

function _dayLabel(iso, todayIdx, i) {
  /* i=0 -> 'Hoje', i=1 -> 'Amanha', resto -> 'Seg'/'Ter'/... */
  if (i === 0) { return 'Hoje'; }
  if (i === 1) { return 'Amanha'; }
  if (!iso) { return ''; }
  var d = new Date(iso + 'T12:00:00');
  var names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  return names[d.getDay()];
}


/* --- Heroi --------------------------------------------------------------- */
Widgets._wxHero = function (p) {
  var s = el('section', 'wx-hero');
  var cur = p.current || {};
  var today = (p.daily && p.daily[0]) || {};

  var iconWrap = el('div', 'wx-hero-icon');
  iconWrap.innerHTML = _wmoIcon(cur.code || 0);
  s.appendChild(iconWrap);

  var info = el('div', 'wx-hero-info');
  info.appendChild(el('div', 'wx-hero-temp', _fmtTemp(cur.temp) + 'C'));
  info.appendChild(el('div', 'wx-hero-cond', _wmoLabel(cur.code)));
  var extra = [];
  extra.push('Min ' + _fmtTemp(today.low));
  extra.push('Max ' + _fmtTemp(today.high));
  if (cur.feels_like !== null && cur.feels_like !== undefined) {
    extra.push('Sensacao ' + _fmtTemp(cur.feels_like));
  }
  info.appendChild(el('div', 'wx-hero-extra', extra.join('  \xb7  ')));
  s.appendChild(info);
  return s;
};


/* --- Proximas horas ------------------------------------------------------ */
Widgets._wxHourly = function (p) {
  var sec = _wxSection('Proximas horas');
  var strip = el('div', 'wx-hourly');
  var hours = p.hourly || [];
  for (var i = 0; i < hours.length; i++) {
    var h = hours[i];
    var cell = el('div', 'wx-hour');
    cell.appendChild(el('div', 'wx-hour-time', i === 0 ? 'Agora' : _hourLabel(h.time)));
    var icon = el('div', 'wx-hour-icon');
    icon.innerHTML = _wmoIcon(h.code || 0);
    cell.appendChild(icon);
    cell.appendChild(el('div', 'wx-hour-temp', _fmtTemp(h.temp) + 'C'));
    if (h.prob !== null && h.prob !== undefined && h.prob >= 10) {
      cell.appendChild(el('div', 'wx-hour-prob', h.prob + '%'));
    }
    strip.appendChild(cell);
  }
  sec.appendChild(strip);
  return sec;
};


/* --- Grafico mín/max por dia (range bar SVG) ----------------------------- */
Widgets._wxTempChart = function (p) {
  var sec = _wxSection('Temperatura (proximos dias)');
  var days = p.daily || [];
  if (!days.length) { return sec; }

  /* eixo absoluto: pega min/max global dos 7 dias */
  var gMin = Infinity, gMax = -Infinity;
  for (var i = 0; i < days.length; i++) {
    if (days[i].low !== null && days[i].low < gMin)  { gMin = days[i].low; }
    if (days[i].high !== null && days[i].high > gMax) { gMax = days[i].high; }
  }
  if (!isFinite(gMin) || !isFinite(gMax)) { return sec; }
  var span = Math.max(gMax - gMin, 1);

  var chart = el('div', 'wx-tempchart');
  for (var j = 0; j < days.length; j++) {
    var d = days[j];
    var row = el('div', 'wx-temprow');
    row.appendChild(el('div', 'wx-temprow-day', _dayLabel(d.date, 0, j)));
    row.appendChild(el('div', 'wx-temprow-min', _fmtTemp(d.low)));

    /* barra range em SVG, posicionada por % no eixo [gMin..gMax] */
    var barWrap = el('div', 'wx-temprow-bar');
    var s = _svg('svg', { viewBox: '0 0 100 10', preserveAspectRatio: 'none' });
    /* trilho */
    s.appendChild(_svg('rect', { x: 0, y: 4, width: 100, height: 2,
                                  rx: 1, fill: 'currentColor', 'fill-opacity': 0.18 }));
    /* range mín-max */
    var x1 = ((d.low - gMin) / span) * 100;
    var x2 = ((d.high - gMin) / span) * 100;
    s.appendChild(_svg('rect', { x: x1, y: 2, width: Math.max(x2 - x1, 1),
                                  height: 6, rx: 3, fill: 'currentColor',
                                  'fill-opacity': 0.85 }));
    barWrap.appendChild(s);
    row.appendChild(barWrap);

    row.appendChild(el('div', 'wx-temprow-max', _fmtTemp(d.high)));
    chart.appendChild(row);
  }
  sec.appendChild(chart);
  return sec;
};


/* --- Grafico de precipitacao (bar chart SVG) ----------------------------- */
Widgets._wxPrecipChart = function (p) {
  var sec = _wxSection('Precipitacao (mm por dia)');
  var days = p.daily || [];
  if (!days.length) { return sec; }

  var maxMm = 0;
  for (var i = 0; i < days.length; i++) {
    var v = days[i].precip_sum || 0;
    if (v > maxMm) { maxMm = v; }
  }
  if (maxMm < 1) { maxMm = 1; }   /* escala minima para nao ficar gigante */

  /* viewBox com proporcao real do container (~720x140) e escala uniforme
     (preserveAspectRatio default = 'xMidYMid meet') — sem esticar texto. */
  var W = 720;
  var H = 140;
  var n = days.length;
  var slot = W / n;
  var barW = slot * 0.55;
  var pad = (slot - barW) / 2;
  var topPad = 18;     /* espaco para os rotulos de mm */
  var bottomPad = 22;  /* espaco para os rotulos de dia */
  var chartH = H - topPad - bottomPad;

  var wrap = el('div', 'wx-precip');
  var s = _svg('svg', { viewBox: '0 0 ' + W + ' ' + H });

  for (var k = 0; k < n; k++) {
    var d = days[k];
    var v2 = d.precip_sum || 0;
    var bh = (v2 / maxMm) * chartH;
    var x = k * slot + pad;
    var y = topPad + (chartH - bh);
    /* Barra com altura minima visivel quando ha qualquer chuva. */
    if (v2 > 0 && bh < 3) { bh = 3; y = topPad + (chartH - bh); }
    s.appendChild(_svg('rect', { x: x, y: y, width: barW, height: bh,
                                  rx: 3, fill: '#42a5f5' }));
    if (v2 > 0) {
      var label = _svg('text', { x: x + barW / 2, y: y - 5,
                                  'text-anchor': 'middle', 'font-size': 12,
                                  fill: 'currentColor', 'fill-opacity': 0.75 });
      label.textContent = v2.toFixed(v2 < 10 ? 1 : 0) + 'mm';
      s.appendChild(label);
    }
    var dayText = _svg('text', { x: x + barW / 2, y: H - 6,
                                  'text-anchor': 'middle', 'font-size': 12,
                                  fill: 'currentColor', 'fill-opacity': 0.65 });
    dayText.textContent = _dayLabel(d.date, 0, k);
    s.appendChild(dayText);
  }
  wrap.appendChild(s);
  sec.appendChild(wrap);
  return sec;
};


/* --- Lista diaria (dia · icone · range · %) ------------------------------ */
Widgets._wxDailyList = function (p) {
  var sec = _wxSection('Previsao');
  var days = p.daily || [];
  if (!days.length) { return sec; }

  /* eixo absoluto compartilhado */
  var gMin = Infinity, gMax = -Infinity;
  for (var i = 0; i < days.length; i++) {
    if (days[i].low !== null && days[i].low < gMin)  { gMin = days[i].low; }
    if (days[i].high !== null && days[i].high > gMax) { gMax = days[i].high; }
  }
  var span = Math.max(gMax - gMin, 1);

  var list = el('div', 'wx-daily');
  for (var j = 0; j < days.length; j++) {
    var d = days[j];
    var row = el('div', 'wx-day-row');
    row.appendChild(el('div', 'wx-day-name', _dayLabel(d.date, 0, j)));
    var icon = el('div', 'wx-day-icon');
    icon.innerHTML = _wmoIcon(d.code || 0);
    row.appendChild(icon);
    var prob = (d.precip_prob !== null && d.precip_prob !== undefined && d.precip_prob >= 10)
      ? d.precip_prob + '%' : '';
    row.appendChild(el('div', 'wx-day-prob', prob));

    var range = el('div', 'wx-day-range');
    var rangeWrap = el('div', 'wx-temprow-bar');
    var s = _svg('svg', { viewBox: '0 0 100 10', preserveAspectRatio: 'none' });
    s.appendChild(_svg('rect', { x: 0, y: 4, width: 100, height: 2,
                                  rx: 1, fill: 'currentColor', 'fill-opacity': 0.18 }));
    var x1 = ((d.low - gMin) / span) * 100;
    var x2 = ((d.high - gMin) / span) * 100;
    s.appendChild(_svg('rect', { x: x1, y: 2, width: Math.max(x2 - x1, 1),
                                  height: 6, rx: 3, fill: 'currentColor',
                                  'fill-opacity': 0.85 }));
    rangeWrap.appendChild(s);
    range.appendChild(el('span', 'wx-temprow-min', _fmtTemp(d.low)));
    range.appendChild(rangeWrap);
    range.appendChild(el('span', 'wx-temprow-max', _fmtTemp(d.high)));
    range.style.display = '-webkit-flex';
    range.style.display = 'flex';
    range.style.alignItems = 'center';
    row.appendChild(range);
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
};


/* --- Grid de metricas (sol, vento, UV, umidade, sensacao, chuva hoje) --- */
Widgets._wxMetrics = function (p) {
  var sec = _wxSection('Detalhes');
  var grid = el('div', 'wx-metrics');
  var cur = p.current || {};
  var today = (p.daily && p.daily[0]) || {};

  function card(label, val, sub) {
    var c = el('div', 'wx-metric');
    c.appendChild(el('div', 'wx-metric-label', label));
    c.appendChild(el('div', 'wx-metric-val', val));
    if (sub) { c.appendChild(el('div', 'wx-metric-sub', sub)); }
    return c;
  }

  grid.appendChild(card('Sol',
    (today.sunrise || DASH) + ' ↑',
    (today.sunset  || DASH) + ' ↓'));
  grid.appendChild(card('Vento',
    (cur.wind_speed !== null && cur.wind_speed !== undefined ? cur.wind_speed + ' km/h' : DASH),
    _windCardinal(cur.wind_dir)));
  grid.appendChild(card('UV',
    (cur.uv !== null && cur.uv !== undefined ? String(Math.round(cur.uv)) : DASH),
    _uvLevel(cur.uv)));
  grid.appendChild(card('Umidade',
    (cur.humidity !== null && cur.humidity !== undefined ? cur.humidity + '%' : DASH),
    ''));
  grid.appendChild(card('Sensacao',
    _fmtTemp(cur.feels_like) + 'C',
    ''));
  grid.appendChild(card('Chuva hoje',
    (today.precip_sum !== null && today.precip_sum !== undefined ? today.precip_sum + ' mm' : DASH),
    (today.precip_prob ? today.precip_prob + '% prob.' : '')));

  sec.appendChild(grid);
  return sec;
};


/* Orquestrador: monta o modal de detalhes do clima dentro de `node`. */
Widgets.renderWeatherDetail = function (node, payload) {
  if (!node) { return; }
  node.innerHTML = '';
  if (!payload || !payload.configured) {
    node.appendChild(el('div', 'empty', 'Clima nao configurado.'));
    return;
  }
  if (payload.error) {
    node.appendChild(el('div', 'empty', 'Sem dados de clima.'));
    return;
  }
  node.appendChild(Widgets._wxHero(payload));
  if (payload.hourly && payload.hourly.length) {
    node.appendChild(Widgets._wxHourly(payload));
  }
  if (payload.daily && payload.daily.length) {
    node.appendChild(Widgets._wxTempChart(payload));
    node.appendChild(Widgets._wxPrecipChart(payload));
    node.appendChild(Widgets._wxDailyList(payload));
  }
  node.appendChild(Widgets._wxMetrics(payload));
};


/* --- Modal de particoes de disco ------------------------------------------ */
Widgets.renderDiskModal = function (container, disks) {
  if (!container) { return; }
  container.innerHTML = '';
  if (!disks || !disks.length) {
    container.appendChild(document.createTextNode('Sem dados de disco.'));
    return;
  }
  for (var i = 0; i < disks.length; i++) {
    var d = disks[i];
    var pct = (typeof d.percent === 'number') ? d.percent : 0;
    var level = pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'ok';

    var row = el('div', 'disk-part card--' + level);

    var header = el('div', 'disk-part-head');
    header.appendChild(el('span', 'disk-part-label', d.label || '?'));
    header.appendChild(el('span', 'disk-part-pct',
      (typeof d.percent === 'number') ? d.percent + '%' : DASH));
    row.appendChild(header);

    var bar = el('div', 'bar');
    var fill = el('div', 'bar-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);

    row.appendChild(el('div', 'disk-part-sub',
      fmtBytes(d.used) + ' / ' + fmtBytes(d.total)));

    container.appendChild(row);
  }
};
