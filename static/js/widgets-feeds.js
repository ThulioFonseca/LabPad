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

/* Time-dependent urgency of a single event: 'active' (happening now), 'soon'
   (starts within 15 min) or '' (neither). This is the ONLY part of a rendered
   calendar row that changes between the 10-min feed refreshes — day labels and
   times are baked by the backend into the payload. Kept as its own function so
   the per-minute re-render guard (calendarUrgencySignature) can never drift from
   what _calEvent actually paints. `now` is a Unix timestamp in seconds. */
Widgets._calEventState = function (ev, now) {
  /* All-day events carry NO time-urgency. They are not point-in-time meetings:
     an Outlook all-day entry spans midnight→midnight, so treating it as 'active'
     ("happening now") would paint it in the alarm-red the whole day, and near
     midnight its start is <15 min away so it would flash amber 'soon' for the
     next day's entry too. On the glanceable wall display red/amber must stay
     reserved for real timed meetings that actually need attention — otherwise a
     recurring all-day item (birthday, PTO, on-call) makes a healthy board look
     alarming and dilutes the cue. The "All day" time label + the day grouping
     already place these events, so plain styling is correct. */
  if (ev.all_day) { return ''; }
  if (ev.start_epoch && ev.end_epoch && now >= ev.start_epoch && now < ev.end_epoch) {
    return 'active';
  }
  if (ev.start_epoch && ev.start_epoch > now && (ev.start_epoch - now) <= 900) {
    return 'soon';
  }
  return '';
};

Widgets._calEvent = function (ev) {
  var now = Math.floor(Date.now() / 1000);
  var cls = 'cal-event';
  var state = Widgets._calEventState(ev, now);
  if (state === 'active') { cls += ' cal-event--active'; }
  else if (state === 'soon') { cls += ' cal-event--soon'; }
  var row = el('div', cls);
  row.appendChild(el('span', 'cal-time', ev.time_label || ''));
  var body = el('div', 'cal-body');
  body.appendChild(el('div', 'cal-title', ev.title || '(no title)'));
  if (ev.location) { body.appendChild(el('div', 'cal-loc', ev.location)); }
  row.appendChild(body);
  return row;
};

/* Compact signature of every event's active/soon state at the current moment.
   calendarTick() (dashboard.js) compares it minute-to-minute and only rebuilds
   the calendar DOM when it actually changed — most minutes nothing crosses an
   active/soon boundary, so the wall display skips a needless full-list rebuild
   + reflow every 60s for 24/7 (see the crash history in CLAUDE.md: per-cycle DOM
   churn is what kills the iPad 2 over long uptime). Returns '' when there is
   nothing to colour (unconfigured / error / no events). */
Widgets.calendarUrgencySignature = function (payload) {
  if (!payload || !payload.configured || payload.error || !payload.events) {
    return '';
  }
  var now = Math.floor(Date.now() / 1000);
  var events = payload.events;
  var parts = [];
  for (var i = 0; i < events.length; i++) {
    var s = Widgets._calEventState(events[i], now);
    parts.push(s === 'active' ? 'a' : (s === 'soon' ? 's' : '.'));
  }
  return parts.join('');
};


/* --- Month calendar card (second row) -------------------------------------*/
/* Pure client-side date maths — no backend call: the month grid is the same on
   every device and the .ics feed only covers the next few days anyway.
   Follows the initDockerSummary()/updateDockerSummary() contract: the 42 cells
   (6 weeks x 7 days, the worst case for any month) are allocated ONCE here and
   afterwards only their text nodes / class names change. Nothing is ever
   appended or removed at runtime, so the always-on display allocates no DOM
   per tick (CLAUDE.md, long-uptime stability). */

var CALM_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var CALM_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November',
                   'December'];

Widgets.initCalendarMonth = function (cardEl) {
  if (!cardEl) { return null; }
  cardEl.innerHTML = '';

  /* _cardHead() bakes its title into a text node; the month name changes at
     every month boundary, so it gets its own span we can setText() later. */
  var head = Widgets._cardHead('calendar', '');
  var monthEl = el('span', 'calm-month');
  monthEl.appendChild(Widgets._skel('skeleton-line'));
  head.firstChild.appendChild(monthEl);
  cardEl.appendChild(head);

  var grid = el('div', 'calm-grid');
  var i;
  for (i = 0; i < 7; i++) {
    /* Two-letter abbreviations: seven cells of 1/7 leave no room for three. */
    grid.appendChild(el('div', 'calm-cell calm-head',
                        CALM_WEEKDAYS[i].substring(0, 2)));
  }

  var cells = [];
  for (i = 0; i < 42; i++) {
    var cell = el('div', 'calm-cell');
    var num = el('span', 'calm-num', '');
    cell.appendChild(num);
    grid.appendChild(cell);
    cells.push(num);
  }
  cardEl.appendChild(grid);

  /* Signature of what is painted ('YYYY-M-D'). Starts null so the first call
     always paints. */
  return { month: monthEl, cells: cells, sig: null };
};

/* Repaints the grid only when the calendar DAY changed (the "today" circle is
   the only thing that moves between two ticks of the same day). Called from
   the 60s calendarTick in dashboard.js: on all but one tick a day it is a
   single string compare that touches no DOM. */
Widgets.updateCalendarMonth = function (refs, date) {
  if (!refs) { return; }
  var now = date || new Date();
  var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  var sig = y + '-' + m + '-' + d;
  if (sig === refs.sig) { return; }
  refs.sig = sig;

  setText(refs.month, CALM_MONTHS[m] + ' ' + y);

  var firstDow = new Date(y, m, 1).getDay();      /* 0 = Sunday */
  /* Day 0 of the NEXT month is the last day of this one. */
  var daysInMonth = new Date(y, m + 1, 0).getDate();

  for (var i = 0; i < 42; i++) {
    var num = refs.cells[i];
    var dayNum = i - firstDow + 1;
    var inMonth = (dayNum >= 1 && dayNum <= daysInMonth);
    setText(num, inMonth ? String(dayNum) : '');
    num.className = (inMonth && dayNum === d) ? 'calm-num calm-num--today'
                                              : 'calm-num';
  }
};


/* --- News (RSS) -----------------------------------------------------------*/

Widgets._newsCarouselTimer = null;

Widgets.renderNews = function (container, payload) {
  /* Cancel any pending carousel auto-advance from a previous render
     (polling reuses this same container every 10 min). */
  if (Widgets._newsCarouselTimer) {
    clearTimeout(Widgets._newsCarouselTimer);
    Widgets._newsCarouselTimer = null;
  }
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

  var style = (window.Settings && Settings.newsViewStyle)
              ? Settings.newsViewStyle() : 'list';
  if (style === 'carousel') {
    Widgets._renderNewsCarousel(container, items);
    return;
  }

  for (var i = 0; i < items.length; i++) {
    container.appendChild(Widgets._newsItem(items[i]));
  }
};

Widgets._renderNewsCarousel = function (container, items) {
  var n = items.length;
  var current = 0;
  var paused = false;

  var wrap = el('div', 'news-carousel');
  var viewport = el('div', 'news-carousel-viewport');
  var track = el('div', 'news-carousel-track');
  viewport.appendChild(track);
  wrap.appendChild(viewport);

  for (var i = 0; i < n; i++) {
    track.appendChild(buildSlide(items[i]));
  }

  function buildSlide(item) {
    /* Includes 'news-item' so the existing click delegation in
       dashboard.js (substring match on ' news-item ') still opens the reader. */
    var slide = el('div', 'news-carousel-slide news-item');
    if (item.image) {
      /* Slide is 240px tall and at most the panel's width; 640 covers it. */
      slide.style.backgroundImage = cssUrl(proxiedImage(item.image, 640));
    } else {
      slide.className += ' news-carousel-slide--no-image';
    }
    var txt = el('div', 'news-carousel-text');
    txt.appendChild(el('div', 'news-title', item.title || ''));
    if (item.age) { txt.appendChild(el('div', 'news-age', item.age)); }
    slide.appendChild(txt);
    slide.setAttribute('data-link',  item.link  || '');
    slide.setAttribute('data-title', item.title || '');
    slide.setAttribute('data-image', item.image || '');
    return slide;
  }

  var prevBtn = null, nextBtn = null, dotsRow = null, dots = [];
  if (n > 1) {
    prevBtn = el('button', 'news-carousel-nav news-carousel-nav--prev');
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Previous news');
    prevBtn.innerHTML = '&#8249;';
    nextBtn = el('button', 'news-carousel-nav news-carousel-nav--next');
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', 'Next news');
    nextBtn.innerHTML = '&#8250;';
    wrap.appendChild(prevBtn);
    wrap.appendChild(nextBtn);

    dotsRow = el('div', 'news-carousel-dots');
    for (var k = 0; k < n; k++) {
      var dot = el('button', 'news-carousel-dot' + (k === 0 ? ' is-active' : ''));
      dot.type = 'button';
      dot.setAttribute('aria-label', 'Go to slide ' + (k + 1));
      dotsRow.appendChild(dot);
      dots.push(dot);
    }
    wrap.appendChild(dotsRow);
  }

  container.appendChild(wrap);

  function applyPos() {
    var tx = 'translateX(-' + (current * 100) + '%)';
    track.style.webkitTransform = tx;
    track.style.transform = tx;
    for (var j = 0; j < dots.length; j++) {
      dots[j].className = 'news-carousel-dot' + (j === current ? ' is-active' : '');
    }
  }

  function scheduleTick() {
    if (Widgets._newsCarouselTimer) {
      clearTimeout(Widgets._newsCarouselTimer);
      Widgets._newsCarouselTimer = null;
    }
    if (paused || n <= 1) { return; }
    Widgets._newsCarouselTimer = setTimeout(next, 5000);
  }
  function goTo(i) {
    current = ((i % n) + n) % n;
    applyPos();
    scheduleTick();
  }
  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  wrap.onmouseenter = function () {
    paused = true;
    if (Widgets._newsCarouselTimer) {
      clearTimeout(Widgets._newsCarouselTimer);
      Widgets._newsCarouselTimer = null;
    }
  };
  wrap.onmouseleave = function () {
    paused = false;
    scheduleTick();
  };

  if (prevBtn) {
    prevBtn.onclick = function (e) {
      e.stopPropagation();
      prev();
    };
    nextBtn.onclick = function (e) {
      e.stopPropagation();
      next();
    };
    for (var d = 0; d < dots.length; d++) {
      dots[d].onclick = (function (idx) {
        return function (e) {
          e.stopPropagation();
          goTo(idx);
        };
      })(d);
    }
  }

  applyPos();
  scheduleTick();
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
  /* .news-thumb is 52x52 in cards.css; 104 covers a 2x display. */
  thumb.style.backgroundImage = cssUrl(proxiedImage(item.image, 104));
  row.appendChild(thumb);
  var text = el('div', 'news-text');
  text.appendChild(el('div', 'news-title', item.title || ''));
  if (item.age) { text.appendChild(el('div', 'news-age', item.age)); }
  row.appendChild(text);
  annotate(row);
  return row;
};
