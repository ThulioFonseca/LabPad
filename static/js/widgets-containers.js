/* =============================================================================
 * widgets-containers.js  —  Docker container list.
 *
 * Extends the Widgets namespace defined in widgets-host.js.
 * Pure ES5 / Safari 9.
 * ===========================================================================*/

Widgets.renderContainers = function (container, payload) {
  container.innerHTML = '';

  if (payload && payload.error) {
    container.appendChild(
      el('div', 'empty', 'Error reading containers: ' + payload.error));
    return;
  }

  var list = (payload && payload.list) ? payload.list : [];
  if (!list.length) {
    container.appendChild(el('div', 'empty', 'No containers found.'));
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
