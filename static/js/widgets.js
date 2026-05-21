/* =============================================================================
 * widgets.js  —  criacao e atualizacao dos cards.
 *
 * Generico: widgets novos sao definidos so em config.js; nao se mexe aqui.
 * Tudo em JavaScript ES5 (var/function) por causa do Safari 9 / iPad 2.
 * ===========================================================================*/

/* --- Utilitarios ----------------------------------------------------------*/

/* Le um valor aninhado pelo caminho 'a.b.0.c' (indices de array sao numeros). */
function getPath(obj, path) {
  if (!obj || !path) { return undefined; }
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) { return undefined; }
    cur = cur[parts[i]];
  }
  return cur;
}

/* Define o texto de um elemento de forma segura (cria o no de texto se faltar). */
function setText(node, text) {
  if (!node) { return; }
  if (node.firstChild && node.firstChild.nodeType === 3) {
    node.firstChild.nodeValue = text;
  } else {
    node.innerHTML = '';
    node.appendChild(document.createTextNode(text));
  }
}

/* Cria um elemento com classe e (opcionalmente) texto. */
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) { node.className = className; }
  if (text !== undefined && text !== null) {
    node.appendChild(document.createTextNode(text));
  }
  return node;
}

var DASH = '—'; /* travessao usado quando nao ha valor */

function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n)) { return DASH; }
  var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  var i = 0;
  n = Number(n);
  while (n >= 1024 && i < units.length - 1) { n = n / 1024; i = i + 1; }
  var txt = (i === 0) ? String(Math.round(n))
          : (n < 10 ? n.toFixed(1) : String(Math.round(n)));
  return txt + ' ' + units[i];
}

function fmtRate(n) {
  if (n === null || n === undefined || isNaN(n)) { return DASH; }
  return fmtBytes(n) + '/s';
}

function fmtDuration(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) { return DASH; }
  sec = Math.floor(Number(sec));
  var d = Math.floor(sec / 86400);
  var hh = Math.floor((sec % 86400) / 3600);
  var mm = Math.floor((sec % 3600) / 60);
  if (d > 0) { return d + 'd ' + hh + 'h'; }
  if (hh > 0) { return hh + 'h ' + mm + 'm'; }
  return mm + 'm';
}

function fmtNumber(value) {
  return (Math.round(value * 10) / 10).toString();
}

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

/* Cria o DOM de um widget. Devolve um objeto com 'root' e refs para updates. */
Widgets.create = function (widget) {
  if (widget.kind === 'info') { return Widgets._createInfo(widget); }
  if (widget.kind === 'rate') { return Widgets._createRate(widget); }
  return Widgets._createGauge(widget);
};

/* Atualiza um widget ja criado com os dados de /api/metrics. */
Widgets.update = function (refs, widget, data, buffer) {
  if (!refs) { return; }
  if (widget.kind === 'info') { return Widgets._updateInfo(refs, widget, data); }
  if (widget.kind === 'rate') { return Widgets._updateRate(refs, widget, data, buffer); }
  return Widgets._updateGauge(refs, widget, data, buffer);
};

/* ---- gauge ---- */

Widgets._createGauge = function (widget) {
  var root = el('div', 'card card--none');

  var head = el('div', 'card-head');
  head.appendChild(el('span', 'card-title', widget.title));
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

  var sub = el('div', 'card-sub', ' ');
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

/* ---- rate (rede) ---- */

Widgets._createRate = function (widget) {
  var root = el('div', 'card');

  var head = el('div', 'card-head');
  head.appendChild(el('span', 'card-title', widget.title));
  root.appendChild(head);

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
  root.appendChild(row);

  var canvas = null;
  if (widget.spark) {
    canvas = el('canvas', 'spark');
    root.appendChild(canvas);
  }
  return { root: root, rx: rx, tx: tx, canvas: canvas };
};

Widgets._updateRate = function (refs, widget, data, buffer) {
  setText(refs.rx, fmtRate(getPath(data, widget.path)));
  setText(refs.tx, fmtRate(getPath(data, widget.path2)));
  if (refs.canvas && buffer) {
    drawSparkline(refs.canvas, buffer, LEVEL_COLOR.ok);
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
  var row = el('div', 'crow crow--' + (running ? 'up' : 'down'));

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
  var row = el('div', 'cal-event');
  row.appendChild(el('span', 'cal-time', ev.time_label || ''));
  var body = el('div', 'cal-body');
  body.appendChild(el('div', 'cal-title', ev.title || '(sem titulo)'));
  if (ev.location) { body.appendChild(el('div', 'cal-loc', ev.location)); }
  row.appendChild(body);
  return row;
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
    var item = items[i];
    var row = el('div', 'news-item');
    row.appendChild(el('div', 'news-title', item.title || ''));
    if (item.age) { row.appendChild(el('div', 'news-age', item.age)); }
    container.appendChild(row);
  }
};
