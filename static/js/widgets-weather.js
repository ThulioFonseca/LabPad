/* =============================================================================
 * widgets-weather.js  —  weather carousel in topbar and details modal.
 *
 * Extends the Widgets namespace defined in widgets-host.js.
 * Pure ES5 / Safari 9.
 * ===========================================================================*/

/* --- Helpers for the 'city' slide ------------------------------------------*/

var WX_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function _wxPad2(n) { return (n < 10 ? '0' : '') + n; }

function _wxDateLabel(d) {
  return WX_WEEKDAYS[d.getDay()] + ' ' + _wxPad2(d.getDate()) + '/' + _wxPad2(d.getMonth() + 1);
}

function _wxClockLabel(d) {
  return _wxPad2(d.getHours()) + ':' + _wxPad2(d.getMinutes()) + 'h';
}


/* --- Topbar carousel ------------------------------------------------------*/

Widgets.initWeather = function (containerEl) {
  if (!containerEl) { return null; }
  var panel = el('div', 'weather-panel');
  panel.appendChild(Widgets._skel('skeleton-pill'));
  containerEl.appendChild(panel);
  return { panel: panel };
};

Widgets.renderWeatherSlide = function (panel, payload, slideId) {
  if (!panel || !payload || !payload.configured) { return; }
  panel.innerHTML = '';

  var id = slideId;
  if (id === 0) { id = 'current'; }
  else if (id === 1) { id = 'forecast'; }
  else if (id === 2) { id = 'moon'; }

  if (id === 'city') {
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
    var cur = payload.current || {};
    var icon0 = el('span', 'weather-icon');
    icon0.innerHTML = _wmoIcon(cur.code || 0);
    panel.appendChild(icon0);
    panel.appendChild(el('span', 'weather-val',
      (cur.temp != null ? cur.temp + '\xb0C' : DASH)));
    panel.appendChild(el('span', 'weather-sep', '\xb7'));
    panel.appendChild(el('span', 'weather-val',
      (cur.humidity != null ? cur.humidity + '%' : DASH)));

  } else if (id === 'forecast') {
    var daily = payload.daily || [];
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
    var moon = payload.moon || {};
    var icon2 = el('span', 'weather-icon');
    icon2.innerHTML = MOON_ICONS[moon.phase_index || 0] || '';
    panel.appendChild(icon2);
    panel.appendChild(el('span', 'weather-val', moon.name || DASH));
  }
};


/* --- Weather card (second row) --------------------------------------------*/
/* Same payload as the topbar carousel, but sized to be read from across the
   room: the carousel's type is small and it only shows the current values for
   10s out of every rotation, which is no good on a wall display.
   Built once / updated in place, like initDockerSummary — see CLAUDE.md. */

Widgets.initWeatherCard = function (cardEl) {
  if (!cardEl) { return null; }
  cardEl.innerHTML = '';

  cardEl.appendChild(Widgets._cardHead('weather', 'Weather'));

  /* Icon + temperature centred in the card's free height, with the condition
     under the number; the day's range and humidity sit in a footer separated
     by a hairline, mirroring the Docker card's .docker-top. */
  var main = el('div', 'wxc-main');
  var icon = el('span', 'wxc-icon');
  var now = el('span', 'wxc-now');
  var temp = el('span', 'wxc-temp');
  temp.appendChild(Widgets._skel('skeleton-num'));
  var cond = el('span', 'wxc-cond');
  now.appendChild(temp);
  now.appendChild(cond);
  main.appendChild(icon);
  main.appendChild(now);
  cardEl.appendChild(main);

  var foot = el('div', 'wxc-foot');
  var range = el('span', 'wxc-range');
  range.appendChild(Widgets._skel('skeleton-line'));
  /* The droplet labels the humidity without a word, so the footer stays legible
     at a glance from a distance (and doesn't need translating). */
  var humWrap = el('span', 'wxc-hum');
  var drop = el('span', 'wxc-hum-icon');
  drop.innerHTML = ICONS.humidity;
  var hum = el('span', 'wxc-hum-val');
  humWrap.appendChild(drop);
  humWrap.appendChild(hum);
  foot.appendChild(range);
  foot.appendChild(humWrap);
  cardEl.appendChild(foot);

  /* lastCode starts null so the first payload always paints the icon. */
  return { icon: icon, temp: temp, cond: cond, range: range, hum: hum,
           lastCode: null };
};

Widgets.updateWeatherCard = function (refs, payload) {
  if (!refs) { return; }

  if (!payload || !payload.configured) {
    /* Not configured, or an error with no cached data: show dashes rather than
       stale numbers — a wrong temperature read from afar is worse than none. */
    if (refs.lastCode !== 'none') {
      refs.icon.innerHTML = '';
      refs.lastCode = 'none';
    }
    setText(refs.temp, DASH);
    setText(refs.cond, '');
    setText(refs.range, DASH);
    setText(refs.hum, '');
    return;
  }

  var cur = payload.current || {};
  var today = (payload.daily && payload.daily[0]) || {};

  /* Rewriting the icon's innerHTML reparses the SVG and reallocates its nodes;
     the WMO code only moves a few times a day, so only touch it on a change. */
  var code = (cur.code === null || cur.code === undefined) ? 0 : cur.code;
  if (code !== refs.lastCode) {
    refs.icon.innerHTML = _wmoIcon(code);
    refs.lastCode = code;
  }

  setText(refs.temp, (cur.temp === null || cur.temp === undefined)
                       ? DASH : Math.round(cur.temp) + '\xb0');
  setText(refs.cond, _wmoLabel(code));
  setText(refs.range, _fmtTemp(today.high) + ' / ' + _fmtTemp(today.low));
  setText(refs.hum, (cur.humidity === null || cur.humidity === undefined)
                      ? DASH : cur.humidity + '%');
};


/* === Detailed weather modal ===============================================*/

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
  var dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

function _uvLevel(uv) {
  if (uv === null || uv === undefined) { return ''; }
  if (uv < 3)  { return 'Low'; }
  if (uv < 6)  { return 'Moderate'; }
  if (uv < 8)  { return 'High'; }
  if (uv < 11) { return 'Very high'; }
  return 'Extreme';
}

function _fmtTemp(v) {
  return (v === null || v === undefined) ? DASH : Math.round(v) + '\xb0';
}

function _hourLabel(iso) {
  if (!iso || iso.indexOf('T') < 0) { return ''; }
  return iso.split('T')[1].substring(0, 2) + 'h';
}

function _dayLabel(iso, todayIdx, i) {
  if (i === 0) { return 'Today'; }
  if (i === 1) { return 'Tomorrow'; }
  if (!iso) { return ''; }
  var d = new Date(iso + 'T12:00:00');
  var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[d.getDay()];
}


/* --- Hero -----------------------------------------------------------------*/

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
    extra.push('Feels like ' + _fmtTemp(cur.feels_like));
  }
  info.appendChild(el('div', 'wx-hero-extra', extra.join('  \xb7  ')));
  s.appendChild(info);
  return s;
};


/* --- Hourly ---------------------------------------------------------------*/

Widgets._wxHourly = function (p) {
  var sec = _wxSection('Next hours');
  var strip = el('div', 'wx-hourly');
  var hours = p.hourly || [];
  for (var i = 0; i < hours.length; i++) {
    var h = hours[i];
    var cell = el('div', 'wx-hour');
    cell.appendChild(el('div', 'wx-hour-time', i === 0 ? 'Now' : _hourLabel(h.time)));
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


/* --- Min/max temperature chart (range bar SVG) ----------------------------*/

Widgets._wxTempChart = function (p) {
  var sec = _wxSection('Temperature (next days)');
  var days = p.daily || [];
  if (!days.length) { return sec; }

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

    var barWrap = el('div', 'wx-temprow-bar');
    var s = _svg('svg', { viewBox: '0 0 100 10', preserveAspectRatio: 'none' });
    s.appendChild(_svg('rect', { x: 0, y: 4, width: 100, height: 2,
                                  rx: 1, fill: 'currentColor', 'fill-opacity': 0.18 }));
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


/* --- Precipitation chart (bar chart SVG) ----------------------------------*/

Widgets._wxPrecipChart = function (p) {
  var sec = _wxSection('Precipitation (mm/day)');
  var days = p.daily || [];
  if (!days.length) { return sec; }

  var maxMm = 0;
  for (var i = 0; i < days.length; i++) {
    var v = days[i].precip_sum || 0;
    if (v > maxMm) { maxMm = v; }
  }
  if (maxMm < 1) { maxMm = 1; }

  var W = 720;
  var H = 140;
  var n = days.length;
  var slot = W / n;
  var barW = slot * 0.55;
  var pad = (slot - barW) / 2;
  var topPad = 18;
  var bottomPad = 22;
  var chartH = H - topPad - bottomPad;

  var wrap = el('div', 'wx-precip');
  var s = _svg('svg', { viewBox: '0 0 ' + W + ' ' + H });

  for (var k = 0; k < n; k++) {
    var d = days[k];
    var v2 = d.precip_sum || 0;
    var bh = (v2 / maxMm) * chartH;
    var x = k * slot + pad;
    var y = topPad + (chartH - bh);
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


/* --- Daily list (day · icon · range · %) ----------------------------------*/

Widgets._wxDailyList = function (p) {
  var sec = _wxSection('Forecast');
  var days = p.daily || [];
  if (!days.length) { return sec; }

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


/* --- Metrics grid (sun, wind, UV, humidity, feels-like, rain) -------------*/

Widgets._wxMetrics = function (p) {
  var sec = _wxSection('Details');
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

  grid.appendChild(card('Sun',
    (today.sunrise || DASH) + ' ↑',
    (today.sunset  || DASH) + ' ↓'));
  grid.appendChild(card('Wind',
    (cur.wind_speed !== null && cur.wind_speed !== undefined ? cur.wind_speed + ' km/h' : DASH),
    _windCardinal(cur.wind_dir)));
  grid.appendChild(card('UV',
    (cur.uv !== null && cur.uv !== undefined ? String(Math.round(cur.uv)) : DASH),
    _uvLevel(cur.uv)));
  grid.appendChild(card('Humidity',
    (cur.humidity !== null && cur.humidity !== undefined ? cur.humidity + '%' : DASH),
    ''));
  grid.appendChild(card('Feels like',
    _fmtTemp(cur.feels_like) + 'C',
    ''));
  grid.appendChild(card('Rain today',
    (today.precip_sum !== null && today.precip_sum !== undefined ? today.precip_sum + ' mm' : DASH),
    (today.precip_prob ? today.precip_prob + '% prob.' : '')));

  sec.appendChild(grid);
  return sec;
};


/* --- Weather modal orchestrator -------------------------------------------*/

Widgets.renderWeatherDetail = function (node, payload) {
  if (!node) { return; }
  node.innerHTML = '';
  if (!payload || !payload.configured) {
    node.appendChild(el('div', 'empty', 'Weather not configured.'));
    return;
  }
  if (payload.error) {
    node.appendChild(el('div', 'empty', 'No weather data.'));
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
