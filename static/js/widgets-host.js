/* =============================================================================
 * widgets-host.js  —  host cards: gauge, info, network, Docker and system/disk modals.
 *
 * Defines the global Widgets namespace and shared helpers (_skel,
 * _cardHead, create, update). Other widgets-*.js files extend Widgets.
 *
 * Depends on: format.js (el, setText, getPath, fmt*), icons.js (ICONS),
 *             sparkline.js (drawSparkline).
 * Pure ES5 / Safari 9.
 * ===========================================================================*/

/* Maps gauge widget id to the icon key in ICONS. */
var GAUGE_ICONS = { cpu: 'cpu', mem: 'mem', temp: 'temp', disk: 'disk' };

/* Level (ok/warn/crit) of a value according to widget thresholds. */
function levelFor(widget, value) {
  if (typeof value !== 'number' || !isFinite(value)) { return 'none'; }
  if (widget.crit !== undefined && value >= widget.crit) { return 'crit'; }
  if (widget.warn !== undefined && value >= widget.warn) { return 'warn'; }
  return 'ok';
}

/* Sparkline colours. MIRRORS the theme.css palette — update together if changed. */
var LEVEL_COLOR = {
  ok:   '#4f8cff',
  warn: '#d29922',
  crit: '#f85149',
  none: '#6a7080'
};


/* --- Main namespace --------------------------------------------------------*/

var Widgets = {};

/* Creates a <span class="skeleton skeleton-XXX"> to use as an animated
   placeholder during initial load. setText() in format.js replaces the element
   with a plain text node on the first update — the pulse disappears by itself. */
Widgets._skel = function (sizeClass) {
  return el('span', 'skeleton ' + (sizeClass || 'skeleton-num'));
};

/* Builds <div.card-head> with <span.card-title> containing icon (optional) + text. */
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

/* Creates the DOM for a widget. Returns an object with 'root' and refs for updates. */
Widgets.create = function (widget) {
  if (widget.kind === 'info') { return Widgets._createInfo(widget); }
  return Widgets._createGauge(widget);
};

/* Updates an already-created widget with data from /api/metrics. */
Widgets.update = function (refs, widget, data, buffer) {
  if (!refs) { return; }
  if (widget.kind === 'info') { return Widgets._updateInfo(refs, widget, data); }
  return Widgets._updateGauge(refs, widget, data, buffer);
};


/* --- Gauge (CPU / Mem / Disk / Temp) --------------------------------------*/

Widgets._createGauge = function (widget) {
  var root = el('div', 'card card--none');

  var head = Widgets._cardHead(GAUGE_ICONS[widget.id] || null, widget.title);
  var value = el('span', 'card-value');
  var num = el('span', 'num');
  num.appendChild(Widgets._skel('skeleton-num'));
  value.appendChild(num);
  value.appendChild(el('span', 'unit', widget.unit || ''));
  head.appendChild(value);
  root.appendChild(head);

  var bar = el('div', 'bar');
  var fill = el('div', 'bar-fill skeleton-block');
  bar.appendChild(fill);
  root.appendChild(bar);

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


/* --- Info (text) -----------------------------------------------------------*/

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


/* --- Network card (double-row) --------------------------------------------*/

Widgets.initNetCard = function (cardEl) {
  if (!cardEl) { return null; }

  cardEl.appendChild(Widgets._cardHead('net', 'Network'));

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
  if (refs.canvas && refs.canvas.className.indexOf('skeleton-block') >= 0) {
    refs.canvas.className = 'spark spark--fill';
  }
  if (refs.canvas && buffer) {
    drawSparkline(refs.canvas, buffer, LEVEL_COLOR.ok);
  }
};


/* --- Docker Summary (double-row) ------------------------------------------*/

Widgets.renderDockerSummary = function (cardEl, payload) {
  if (!cardEl) { return; }
  cardEl.innerHTML = '';

  cardEl.appendChild(Widgets._cardHead('docker', 'Docker'));

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
    running + ' / ' + list.length + ' active'));

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


/* --- System modal: hardware/software info grouped -------------------------*/

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

  node.appendChild(group('System', [
    ['Hostname',         hostData.hostname],
    ['OS',               hostData.os],
    ['Kernel',           info.kernel],
    ['Architecture',     info.arch]
  ]));

  var loadStr = (hostData.load && hostData.load.length
                 && hostData.load[0] !== null)
    ? hostData.load.join('  \xb7  ') : DASH;
  node.appendChild(group('CPU', [
    ['Model',            info.cpu_model],
    ['Physical cores',   info.cpu_count_physical],
    ['Logical cores',    hostData.cpu_count],
    ['Load (1\xb75\xb715m)', loadStr]
  ]));

  node.appendChild(group('Memory', [
    ['Total', fmtBytes(hostData.mem_total)]
  ]));

  var diskRows = [];
  var disks = hostData.disk || [];
  for (var d = 0; d < disks.length; d++) {
    var dk = disks[d];
    var pct = (dk.percent !== null && dk.percent !== undefined)
      ? dk.percent + '% used' : DASH;
    diskRows.push([dk.label, fmtBytes(dk.total) + '  \xb7  ' + pct]);
  }
  if (!diskRows.length) { diskRows.push(['(none)', '']); }
  node.appendChild(group('Disk', diskRows));

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
  if (!netRows.length) { netRows.push(['(no interfaces)', '']); }
  node.appendChild(group('Network', netRows));

  node.appendChild(group('Runtime', [
    ['Docker',  runtime.docker_version],
    ['Python',  info.python_version],
    ['Uptime',  fmtDuration(hostData.uptime)]
  ]));
};


/* --- Disk partitions modal ------------------------------------------------*/

Widgets.renderDiskModal = function (container, disks) {
  if (!container) { return; }
  container.innerHTML = '';
  if (!disks || !disks.length) {
    container.appendChild(document.createTextNode('No disk data.'));
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
