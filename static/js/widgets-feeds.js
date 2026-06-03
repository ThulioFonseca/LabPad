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
      slide.style.backgroundImage = 'url("' + item.image + '")';
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
  thumb.style.backgroundImage = 'url("' + item.image + '")';
  row.appendChild(thumb);
  var text = el('div', 'news-text');
  text.appendChild(el('div', 'news-title', item.title || ''));
  if (item.age) { text.appendChild(el('div', 'news-age', item.age)); }
  row.appendChild(text);
  annotate(row);
  return row;
};
