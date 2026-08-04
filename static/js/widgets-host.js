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
  ok:   '#5b93ff',
  warn: '#d29922',
  crit: '#f85149',
  none: '#6c7382'
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
  /* `level` mirrors the class currently on `root` ('card card--none' above), so
     _updateGauge can skip rewriting className when the ok/warn/crit state has
     not actually changed (see the guard there). */
  return { root: root, num: num, fill: fill, sub: sub, canvas: canvas,
           level: 'none' };
};

Widgets._updateGauge = function (refs, widget, data, buffer) {
  var value = getPath(data, widget.path);
  var hasValue = (typeof value === 'number' && isFinite(value));
  /* The colour/level can be driven by a DIFFERENT metric than the one shown
     (widget.levelPath). The Disk card uses this so its amber/red state tracks
     the FULLEST single partition, not the flattering all-mounts average that
     hides a full "/" — see config.js. Falls back to the displayed value. */
  var levelValue = widget.levelPath ? getPath(data, widget.levelPath) : value;
  var level = levelFor(widget, levelValue);
  var max = widget.max || 100;

  setText(refs.num, hasValue ? fmtNumber(value) : DASH);
  /* Only rewrite the card's className when the level actually changes. The gauge
     refreshes every 5s forever; on a healthy host `level` stays 'ok' for hours,
     so reassigning the identical className each cycle just dirties the card
     subtree for a needless style recalc — the same per-cycle waste the offline
     dot guards against (setOnline in dashboard.js). See CLAUDE.md long-uptime rules. */
  if (refs.level !== level) {
    refs.root.className = 'card card--' + level;
    refs.level = level;
  }

  if (hasValue && refs.fill.className.indexOf('skeleton-block') >= 0) {
    refs.fill.className = 'bar-fill';
  }
  if (hasValue && refs.canvas &&
      refs.canvas.className.indexOf('skeleton-block') >= 0) {
    refs.canvas.className = 'spark';
  }

  var pct = hasValue ? (value / max) * 100 : 0;
  setBarFill(refs.fill, pct);

  if (widget.sub) {
    /* When an alternate level metric (widget.levelPath) is elevated, name the
       culprit in the sub line — e.g. "/ 96%" — so a red card is self-explanatory
       on the wall display; revert to the usual used/total once healthy. */
    if (widget.levelLabelPath && (level === 'warn' || level === 'crit') &&
        typeof levelValue === 'number' && isFinite(levelValue)) {
      var lbl = getPath(data, widget.levelLabelPath);
      setText(refs.sub,
        (lbl ? lbl + ' ' : '') + fmtNumber(levelValue) + (widget.unit || ''));
    } else {
      setText(refs.sub, fmtBytes(getPath(data, widget.sub.used)) +
                        ' / ' + fmtBytes(getPath(data, widget.sub.total)));
    }
  }

  /* Skip the canvas redraw while the sparkline is hidden. When the user turns
     sparklines off in Settings the canvas is display:none (applySparkVisibility),
     yet without this guard drawSparkline still runs a clearRect + up-to-60-point
     fill+stroke on it every 5s forever — pure GPU/CPU waste on the 512 MB iPad 2.
     The buffer keeps filling regardless, so re-enabling repaints within one cycle. */
  if (refs.canvas && buffer && refs.canvas.style.display !== 'none') {
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
  /* Same guard as the gauges: don't redraw the network sparkline while it is
     hidden (display:none from applySparkVisibility) — it would otherwise burn a
     canvas repaint every 5s forever on the iPad 2 for no visible result. */
  if (refs.canvas && buffer && refs.canvas.style.display !== 'none') {
    drawSparkline(refs.canvas, buffer, LEVEL_COLOR.ok);
  }
};


/* --- Docker Summary (double-row) ------------------------------------------*/
/* This card is ALWAYS visible and refreshed every metrics cycle (5s). Rebuilding
   its DOM via innerHTML each cycle churns GC on the iPad 2 (512 MB, iOS 9.3.5) —
   the same class of long-uptime leak that crashed the tab via the hidden modals
   (commit f56345d). So the structure is built once (initDockerSummary) and only
   text nodes are rewritten in place afterwards (updateDockerSummary): zero node
   allocation in steady state. Follows the initNetCard()/updateNetCard() pattern. */

Widgets.initDockerSummary = function (cardEl) {
  if (!cardEl) { return null; }
  cardEl.innerHTML = '';

  cardEl.appendChild(Widgets._cardHead('docker', 'Docker'));

  /* Count line — skeleton until the first payload replaces its text. */
  var count = el('div', 'docker-count');
  count.appendChild(Widgets._skel('skeleton-pill'));
  cardEl.appendChild(count);

  /* Failure line — built once, hidden until a container actually fails. On the
     always-on wall display a crash/crash-loop/unhealthy container is otherwise
     invisible on this card (it only lists the top-3 RUNNING by CPU). Shown in
     the crit colour and updated in place; zero DOM churn while all is well. */
  var failed = el('div', 'docker-failed');
  failed.style.display = 'none';
  cardEl.appendChild(failed);

  /* Three fixed top-container slots, reused every cycle. The whole block is
     hidden when there is nothing to show (keeps the border-top/padding from
     the .docker-top rule off-screen, matching the old empty-state layout). */
  var topDiv = el('div', 'docker-top');
  var items = [];
  for (var i = 0; i < 3; i++) {
    var item = el('div', 'docker-top-item');
    var name = el('span', 'docker-top-name');
    name.appendChild(Widgets._skel('skeleton-line'));
    var cpu = el('span', 'docker-top-cpu');
    item.appendChild(name);
    item.appendChild(cpu);
    topDiv.appendChild(item);
    items.push({ root: item, name: name, cpu: cpu });
  }
  cardEl.appendChild(topDiv);

  /* `shapeSig` is the signature of what actually occupies vertical space in this
     card (failure line + how many top rows are visible). The network card shares
     the double-row height with this one, so its fill-sparkline canvas only needs
     re-measuring when this signature changes — updateDockerSummary reports that
     via its return value (see render() in dashboard.js). Starts null so the first
     real payload always counts as a change. */
  return { count: count, failed: failed, top: topDiv, items: items,
           shapeSig: null };
};

/* Returns true when the card's vertical SHAPE changed this cycle (a failure line
   appeared/disappeared or the number of visible top rows changed) — i.e. when
   the shared double-row height may have moved. Returns false when only text
   changed (same number of rows), so the caller can skip the per-cycle canvas
   re-measure that would otherwise force a synchronous layout forever on the
   always-on display. */
Widgets.updateDockerSummary = function (refs, payload) {
  if (!refs || !payload) { return false; }   /* keep skeleton until first data */

  var list = (payload && payload.list) ? payload.list : [];
  var running = 0, failedCount = 0, firstFailed = null, i;
  for (i = 0; i < list.length; i++) {
    if (list[i].status === 'running') { running = running + 1; }
    if (list[i].failed) {
      failedCount = failedCount + 1;
      if (!firstFailed) { firstFailed = list[i]; }
    }
  }
  setText(refs.count, running + ' / ' + list.length + ' active');

  /* Glanceable failure line: only appears when something is actually broken
     (crash / crash-loop / unhealthy), so a healthy board stays clean. One
     failure names the container; several just show the tally. Toggled and
     rewritten in place — no per-cycle DOM allocation. */
  if (refs.failed) {
    if (failedCount > 0) {
      var msg = (failedCount === 1 && firstFailed)
        ? (firstFailed.name || '?') + ' failed'
        : failedCount + ' containers failed';
      setText(refs.failed, msg);
      if (refs.failed.style.display !== '') { refs.failed.style.display = ''; }
    } else if (refs.failed.style.display !== 'none') {
      setText(refs.failed, '');
      refs.failed.style.display = 'none';
    }
  }

  var active = [];
  for (i = 0; i < list.length; i++) {
    if (list[i].status === 'running') { active.push(list[i]); }
  }
  active.sort(function (a, b) {
    var sa = (a.cpu_percent || 0) + (a.mem_percent || 0);
    var sb = (b.cpu_percent || 0) + (b.mem_percent || 0);
    return sb - sa;
  });

  /* Hide the whole block when no container is active, else fill the slots. */
  var wantTop = active.length ? '' : 'none';
  if (refs.top.style.display !== wantTop) { refs.top.style.display = wantTop; }

  var visibleTop = 0;
  for (i = 0; i < refs.items.length; i++) {
    var slot = refs.items[i];
    var c = active[i];
    if (c) {
      setText(slot.name, c.name || '?');
      setText(slot.cpu, (typeof c.cpu_percent === 'number')
        ? (fmtNumber(c.cpu_percent) + '% cpu') : DASH);
      if (slot.root.style.display !== '') { slot.root.style.display = ''; }
      visibleTop = visibleTop + 1;
    } else if (slot.root.style.display !== 'none') {
      slot.root.style.display = 'none';
    }
  }

  /* Signature of the card's vertical footprint: whether the failure line is
     shown (and its text, since a long container name can wrap it to a 2nd line)
     plus how many top rows are visible. Everything else the update rewrites is
     text inside fixed-height rows and does not move the card's height. The
     caller re-measures the network fill-canvas only when this changes — see the
     comment at the call site in render(). */
  var failedShown = !!(refs.failed && failedCount > 0);
  var sig = (failedShown ? msg : '') + '\x01' + visibleTop;
  var changed = (sig !== refs.shapeSig);
  refs.shapeSig = sig;
  return changed;
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
    setBarFill(fill, pct);
    bar.appendChild(fill);
    row.appendChild(bar);

    row.appendChild(el('div', 'disk-part-sub',
      fmtBytes(d.used) + ' / ' + fmtBytes(d.total)));

    container.appendChild(row);
  }
};
