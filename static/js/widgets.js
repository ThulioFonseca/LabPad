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

/* Icones SVG inline — currentColor herda a cor do elemento pai. */
var ICONS = {
  cpu: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="8" height="8" rx="1"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="6" y1="12" x2="6" y2="15"/><line x1="10" y1="12" x2="10" y2="15"/><line x1="1" y1="6" x2="4" y2="6"/><line x1="1" y1="10" x2="4" y2="10"/><line x1="12" y1="6" x2="15" y2="6"/><line x1="12" y1="10" x2="15" y2="10"/></svg>',
  mem: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="5" width="14" height="7" rx="1"/><line x1="4" y1="5" x2="4" y2="12"/><line x1="8" y1="5" x2="8" y2="12"/><line x1="12" y1="5" x2="12" y2="12"/><line x1="4" y1="3" x2="4" y2="5"/><line x1="8" y1="3" x2="8" y2="5"/><line x1="12" y1="3" x2="12" y2="5"/></svg>',
  temp: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="1" x2="8" y2="8"/><path d="M5.5 8.5A2.5 2.5 0 1 0 10.5 8.5"/><circle cx="8" cy="11" r="2" fill="currentColor" stroke="none"/></svg>',
  net: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 8,1 12,5"/><line x1="8" y1="1" x2="8" y2="10"/><polyline points="4,11 8,15 12,11"/></svg>',
  disk: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><ellipse cx="8" cy="4.5" rx="6" ry="2.5"/><path d="M2 4.5v7c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-7"/></svg>',
  docker: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="3" height="3" rx="0.5"/><rect x="5" y="6" width="3" height="3" rx="0.5"/><rect x="9" y="6" width="3" height="3" rx="0.5"/><rect x="5" y="2" width="3" height="3" rx="0.5"/><path d="M14.5 7.5c-0.5-1.5-2-1.5-2-1.5H2c0 4 3 5 6 5s5-1 6.5-3.5z"/></svg>'
};

/* Icones de clima por grupo WMO — cores fixas, independentes do tema. */
var WEATHER_ICONS = {
  clear:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="#f5c542"/><line x1="12" y1="2" x2="12" y2="5" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="22" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="2" y1="12" x2="5" y2="12" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="19" y1="12" x2="22" y2="12" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="19.78" y1="4.22" x2="17.66" y2="6.34" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="6.34" y1="17.66" x2="4.22" y2="19.78" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/></svg>',
  partly:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="4" fill="#f5c542"/><rect x="6" y="13" width="13" height="7" rx="3.5" fill="#b0bec5"/><rect x="4" y="15" width="10" height="5" rx="2.5" fill="#cfd8dc"/></svg>',
  cloudy:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="10" width="18" height="9" rx="4.5" fill="#90a4ae"/><rect x="6" y="7" width="11" height="7" rx="3.5" fill="#b0bec5"/></svg>',
  fog:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#90a4ae" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="21" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="3" y1="16" x2="21" y2="16"/></svg>',
  drizzle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="9" rx="4.5" fill="#90a4ae"/><line x1="8" y1="17" x2="7" y2="21" stroke="#64b5f6" stroke-width="2" stroke-linecap="round"/><line x1="13" y1="17" x2="12" y2="21" stroke="#64b5f6" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="17" x2="17" y2="21" stroke="#64b5f6" stroke-width="2" stroke-linecap="round"/></svg>',
  rain:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="9" rx="4.5" fill="#78909c"/><line x1="7" y1="16" x2="5" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="16" x2="10" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="16" x2="15" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/></svg>',
  snow:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="9" rx="4.5" fill="#90a4ae"/><text x="5" y="23" font-size="11" fill="#b3e5fc">* * *</text></svg>',
  shower:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="6" r="3" fill="#f5c542"/><rect x="5" y="8" width="14" height="7" rx="3.5" fill="#78909c"/><line x1="9" y1="18" x2="8" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="18" x2="13" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/></svg>',
  storm:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="10" rx="5" fill="#546e7a"/><polyline points="13,13 10,19 14,19 11,24" stroke="#fdd835" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
};

/* Icones da lua por fase (0=lua nova .. 7=minguante). */
var MOON_ICONS = [
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 1 12 21 A5 9 0 0 0 12 3Z" fill="#f5c542"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 1 12 21 L12 3Z" fill="#f5c542"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#e5b100" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 0 12 21 A3 9 0 0 1 12 3Z" fill="#37474f"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#e5b100" stroke-width="1.5"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#e5b100" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 1 12 21 A3 9 0 0 0 12 3Z" fill="#37474f"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 0 12 21 L12 3Z" fill="#f5c542"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 0 12 21 A5 9 0 0 1 12 3Z" fill="#f5c542"/></svg>'
];

function _wmoIcon(code) {
  if (code === 0)  { return WEATHER_ICONS.clear; }
  if (code <= 2)   { return WEATHER_ICONS.partly; }
  if (code === 3)  { return WEATHER_ICONS.cloudy; }
  if (code <= 48)  { return WEATHER_ICONS.fog; }
  if (code <= 57)  { return WEATHER_ICONS.drizzle; }
  if (code <= 65)  { return WEATHER_ICONS.rain; }
  if (code <= 77)  { return WEATHER_ICONS.snow; }
  if (code <= 82)  { return WEATHER_ICONS.shower; }
  if (code <= 86)  { return WEATHER_ICONS.snow; }
  return WEATHER_ICONS.storm;
}

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
  var titleEl = el('span', 'card-title');
  var iconKey = { cpu: 'cpu', mem: 'mem', temp: 'temp', disk: 'disk' }[widget.id] || null;
  if (iconKey && ICONS[iconKey]) {
    var iconSpan = el('span', 'card-icon');
    iconSpan.innerHTML = ICONS[iconKey];
    titleEl.appendChild(iconSpan);
  }
  titleEl.appendChild(document.createTextNode(widget.title));
  head.appendChild(titleEl);
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


/* --- Meta-line: OS, uptime, load, nucleos -------------------------------- */

Widgets.renderMeta = function (node, hostData) {
  if (!node) { return; }
  var parts = [];
  if (hostData.os) { parts.push(hostData.os); }
  if (typeof hostData.uptime === 'number') {
    parts.push('up ' + fmtDuration(hostData.uptime));
  }
  if (hostData.load && hostData.load.length && hostData.load[0] !== null) {
    parts.push('load ' + hostData.load[0]);
  }
  if (hostData.cpu_count) {
    parts.push(hostData.cpu_count + (hostData.cpu_count === 1 ? ' nucleo' : ' nucleos'));
  }
  setText(node, parts.join('  \xb7  '));
};


/* --- Card de rede (double-row) ------------------------------------------- */

Widgets.initNetCard = function (cardEl) {
  if (!cardEl) { return null; }

  var head = el('div', 'card-head');
  var titleEl = el('span', 'card-title');
  var iconSpan = el('span', 'card-icon');
  iconSpan.innerHTML = ICONS.net;
  titleEl.appendChild(iconSpan);
  titleEl.appendChild(document.createTextNode('Rede'));
  head.appendChild(titleEl);
  cardEl.appendChild(head);

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

  var head = el('div', 'card-head');
  var titleEl = el('span', 'card-title');
  var iconSpan = el('span', 'card-icon');
  iconSpan.innerHTML = ICONS.docker;
  titleEl.appendChild(iconSpan);
  titleEl.appendChild(document.createTextNode('Docker'));
  head.appendChild(titleEl);
  cardEl.appendChild(head);

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
