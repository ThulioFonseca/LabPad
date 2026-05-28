/* =============================================================================
 * widgets-feeds.js  —  calendar (.ics) and news (RSS/Atom).
 *
 * Extends the Widgets namespace defined in widgets-host.js.
 * Pure ES5 / Safari 9.
 * ===========================================================================*/

/* --- Calendar -------------------------------------------------------------*/

Widgets.renderCalendar = function (container, payload) {
  container.innerHTML = '';

  if (!payload || !payload.configured) {
    container.appendChild(el('div', 'empty', 'Calendar not configured.'));
    return;
  }
  if (payload.error) {
    container.appendChild(el('div', 'empty', 'Could not read calendar.'));
    return;
  }

  var events = payload.events || [];
  if (!events.length) {
    container.appendChild(el('div', 'empty', 'No events in the next few days.'));
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
  body.appendChild(el('div', 'cal-title', ev.title || '(no title)'));
  if (ev.location) { body.appendChild(el('div', 'cal-loc', ev.location)); }
  row.appendChild(body);
  return row;
};


/* --- News (RSS) -----------------------------------------------------------*/

Widgets.renderNews = function (container, payload) {
  container.innerHTML = '';

  if (!payload || !payload.configured) {
    container.appendChild(el('div', 'empty', 'News feed not configured.'));
    return;
  }
  if (payload.error) {
    container.appendChild(el('div', 'empty', 'Could not read feed.'));
    return;
  }

  var items = payload.items || [];
  if (!items.length) {
    container.appendChild(el('div', 'empty', 'No news at the moment.'));
    return;
  }

  for (var i = 0; i < items.length; i++) {
    container.appendChild(Widgets._newsItem(items[i]));
  }
};

Widgets._newsItem = function (item) {
  function annotate(node) {
    node.setAttribute('data-link',  item.link  || '');
    node.setAttribute('data-title', item.title || '');
    node.setAttribute('data-image', item.image || '');
  }

  if (!item.image) {
    var plain = el('div', 'news-item');
    plain.appendChild(el('div', 'news-title', item.title || ''));
    if (item.age) { plain.appendChild(el('div', 'news-age', item.age)); }
    annotate(plain);
    return plain;
  }
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
