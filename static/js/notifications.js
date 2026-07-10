/* =============================================================================
 * notifications.js — notification centre (bell + sidebar + detail modal)
 *
 * Backend exposes /api/notifications (GET) and /api/notifications/<id>/read (POST).
 * Notifications are created server-side when collectors transition OK→fail
 * or recover. Here we only poll, render, and mark as read.
 *
 * Pure ES5 (Safari 9 / iPad 2). No fetch, no template literals.
 * ===========================================================================*/

(function () {

  var POLL_MS = 30000;   /* 30s — enough for a system with 60s+ retry */

  var unread = [];       /* last server response */
  var pollTimer = null;

  /* --- Bell + badge -------------------------------------------------------*/
  function paintBell() {
    var btn = document.getElementById('notif-btn');
    if (btn) {
      btn.innerHTML = ICONS.bell;
      if (unread.length > 0) {
        btn.appendChild(el('span', 'notif-badge',
            unread.length > 99 ? '99+' : String(unread.length)));
      }
    }
    /* "Clear all" only makes sense when there is something to clear. */
    var clearBtn = document.getElementById('notif-clear-all');
    if (clearBtn) { clearBtn.style.display = unread.length > 0 ? '' : 'none'; }
  }

  /* --- Sidebar ------------------------------------------------------------*/
  function renderSidebar() {
    var list  = document.getElementById('notif-list');
    var empty = document.getElementById('notif-empty');
    if (!list || !empty) { return; }
    list.innerHTML = '';
    if (unread.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    for (var i = 0; i < unread.length; i++) {
      list.appendChild(buildItem(unread[i]));
    }
  }

  function buildItem(n) {
    var row = el('div', 'notif-item');

    row.appendChild(el('span', 'notif-bar notif-bar--' + n.severity));

    var mid = el('div', 'notif-mid');
    mid.appendChild(el('div', 'notif-row-title', n.title));
    mid.appendChild(el('div', 'notif-row-sub',
        n.source + '  ·  ' + ageLabel(n.created_at)));
    row.appendChild(mid);

    var trash = el('button', 'notif-trash');
    trash.setAttribute('type', 'button');
    trash.setAttribute('aria-label', 'Mark as read');
    trash.innerHTML = ICONS.trash;
    trash.onclick = function (e) {
      e.stopPropagation();
      markRead(n.id);
    };
    row.appendChild(trash);

    row.onclick = function () { openDetail(n); };
    return row;
  }

  function ageLabel(epoch) {
    var s = Math.max(0, ((new Date()).getTime() / 1000) - epoch);
    if (s < 60)    { return Math.floor(s) + 's ago'; }
    if (s < 3600)  { return Math.floor(s / 60) + ' min ago'; }
    if (s < 86400) { return Math.floor(s / 3600) + ' h ago'; }
    return Math.floor(s / 86400) + ' d ago';
  }

  /* --- Detail modal -------------------------------------------------------*/
  function openDetail(n) {
    var titleEl = document.getElementById('notification-modal-title');
    var body    = document.getElementById('notification-modal-body');
    var trash   = document.getElementById('notification-modal-trash');
    if (!titleEl || !body || !trash) { return; }

    setText(titleEl, n.title);

    body.innerHTML = '';
    body.appendChild(el('div', 'notif-meta',
        n.source + '  ·  ' + (new Date(n.created_at * 1000)).toLocaleString()));
    body.appendChild(el('pre', 'notif-detail', n.detail || '(no details)'));

    trash.innerHTML = ICONS.trash;
    trash.onclick = function () {
      markRead(n.id);
      if (window.Modals) { Modals.close('notification-modal'); }
    };

    if (window.Modals) { Modals.open('notification-modal'); }
  }

  /* --- Mark as read (optimistic) -----------------------------------------*/
  function markRead(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', (CONFIG.apiBase || '') + '/api/notifications/' + id + '/read', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) { refresh(); }
    };
    xhr.send();

    /* Optimistic UI: remove immediately without waiting for response. */
    var next = [];
    for (var i = 0; i < unread.length; i++) {
      if (unread[i].id !== id) { next.push(unread[i]); }
    }
    unread = next;
    paintBell();
    renderSidebar();
  }

  /* --- Mark ALL as read (optimistic) -------------------------------------*/
  function markAll() {
    if (!unread.length) { return; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', (CONFIG.apiBase || '') + '/api/notifications/read-all', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) { refresh(); }
    };
    xhr.send();

    /* Optimistic UI: clear the sidebar immediately. */
    unread = [];
    paintBell();
    renderSidebar();
  }

  /* --- Server poll -------------------------------------------------------*/
  function refresh() {
    var url = (CONFIG.apiBase || '') + '/api/notifications?_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      unread = (data && data.items) || [];
      paintBell();
      if (isSidebarOpen()) { renderSidebar(); }
    }, function () {
      /* silent — next tick will retry */
    });
  }

  /* --- Sidebar toggle -----------------------------------------------------*/
  function isSidebarOpen() {
    var s = document.getElementById('notif-sidebar');
    return s && s.className.indexOf('notif-sidebar--open') >= 0;
  }
  function toggleSidebar() {
    var side = document.getElementById('notif-sidebar');
    if (!side) { return; }
    if (isSidebarOpen()) {
      side.className = 'notif-sidebar';
      side.setAttribute('aria-hidden', 'true');
    } else {
      side.className = 'notif-sidebar notif-sidebar--open';
      side.setAttribute('aria-hidden', 'false');
      renderSidebar();
    }
  }

  /* --- Wire detail modal (close + backdrop) ------------------------------*/
  function wireDetailModal() {
    function close() {
      if (window.Modals) { Modals.close('notification-modal'); }
    }
    var backdrop = document.getElementById('notification-modal');
    if (backdrop) { backdrop.onclick = close; }
    /* Click inside the box does not propagate to the backdrop. */
    var box = document.getElementById('notification-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = document.getElementById('notification-modal-close');
    if (closeBtn) { closeBtn.onclick = close; }
  }

  /* --- Public API --------------------------------------------------------*/
  window.Notifications = {
    start: function () {
      paintBell();
      var btn = document.getElementById('notif-btn');
      var closeBtn = document.getElementById('notif-sidebar-close');
      var clearBtn = document.getElementById('notif-clear-all');
      if (btn)      { btn.onclick = toggleSidebar; }
      if (closeBtn) { closeBtn.onclick = toggleSidebar; }
      if (clearBtn) { clearBtn.onclick = markAll; }
      wireDetailModal();
      refresh();
      pollTimer = setInterval(refresh, POLL_MS);
    },
    refresh: refresh
  };
})();
