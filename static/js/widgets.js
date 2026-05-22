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
  var num = el('span', 'num', DASH);
  value.appendChild(num);
  value.appendChild(el('span', 'unit', widget.unit || ''));
  head.appendChild(value);
  root.appendChild(head);

  var bar = el('div', 'bar');
  var fill = el('div', 'bar-fill');
  bar.appendChild(fill);
  root.appendChild(bar);

  var sub = el('div', 'card-sub', ' ');
  root.appendChild(sub);

  var canvas = null;
  if (widget.spark) {
    canvas = el('canvas', 'spark');
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
  var rx = el('span', 'rate-val', DASH);
  down.appendChild(rx);

  var up = el('span', 'rate rate--up');
  up.appendChild(el('span', 'rate-arrow', '↑'));
  var tx = el('span', 'rate-val', DASH);
  up.appendChild(tx);

  row.appendChild(down);
  row.appendChild(up);
  cardEl.appendChild(row);

  var canvas = el('canvas', 'spark spark--fill');
  cardEl.appendChild(canvas);

  return { rx: rx, tx: tx, canvas: canvas };
};

Widgets.updateNetCard = function (refs, data, buffer) {
  if (!refs) { return; }
  setText(refs.rx, fmtRate(getPath(data, 'host.net_rx')));
  setText(refs.tx, fmtRate(getPath(data, 'host.net_tx')));
  if (refs.canvas && buffer) {
    drawSparkline(refs.canvas, buffer, LEVEL_COLOR.ok);
  }
};


/* --- Docker Summary (double-row) ----------------------------------------- */

Widgets.renderDockerSummary = function (cardEl, payload) {
  if (!cardEl) { return; }
  cardEl.innerHTML = '';

  cardEl.appendChild(Widgets._cardHead('docker', 'Docker'));

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

Widgets.initWeather = function (containerEl) {
  if (!containerEl) { return null; }
  /* Um unico painel: troca de conteudo enquanto esta invisivel (opacity:0).
     Evita empilhar 3 elementos no topbar e problemas de layout/transition. */
  var panel = el('div', 'weather-panel weather-hidden');
  containerEl.appendChild(panel);
  return { panel: panel };
};

/* Preenche o painel com o slide indicado (0=atual, 1=previsao, 2=lua). */
Widgets.renderWeatherSlide = function (panel, payload, slideIndex) {
  if (!panel || !payload || !payload.configured) { return; }
  panel.innerHTML = '';

  if (slideIndex === 0) {
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

  } else if (slideIndex === 1) {
    /* Previsao 5 dias */
    var forecast = payload.forecast || [];
    var dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    for (var fi = 0; fi < forecast.length && fi < 5; fi++) {
      var f = forecast[fi];
      var dayEl = el('span', 'weather-day');
      var d = f.date ? new Date(f.date + 'T12:00:00') : null;
      dayEl.appendChild(el('span', 'weather-day-name', d ? dayNames[d.getDay()] : ''));
      var icon1 = el('span', 'weather-icon');
      icon1.innerHTML = _wmoIcon(f.code || 0);
      dayEl.appendChild(icon1);
      var hi = (f.high !== null && f.high !== undefined) ? Math.round(f.high) : DASH;
      var lo = (f.low  !== null && f.low  !== undefined) ? Math.round(f.low)  : DASH;
      dayEl.appendChild(el('span', 'weather-day-temp', hi + '/' + lo));
      panel.appendChild(dayEl);
    }

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
  /* Sem imagem: layout atual (titulo + idade empilhados). */
  if (!item.image) {
    var plain = el('div', 'news-item');
    plain.appendChild(el('div', 'news-title', item.title || ''));
    if (item.age) { plain.appendChild(el('div', 'news-age', item.age)); }
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
  return row;
};
