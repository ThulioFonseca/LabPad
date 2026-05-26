/* =============================================================================
 * notifications.js — central de notificacoes (sino + sidebar + modal detalhe)
 *
 * Backend expoe /api/notifications (GET) e /api/notifications/<id>/read (POST).
 * Notificacoes sao criadas server-side quando coletores transitam de OK→fail
 * ou recuperam. Aqui apenas pollamos, renderizamos e marcamos como lidas.
 *
 * ES5 puro (Safari 9 / iPad 2). Sem fetch, sem template literals.
 * ===========================================================================*/

(function () {

  var POLL_MS = 30000;   /* 30s — basta para um sistema com retry de 60s+ */

  var unread = [];       /* ultima resposta do servidor */
  var pollTimer = null;

  /* --- Bell + badge -------------------------------------------------------*/
  function paintBell() {
    var btn = document.getElementById('notif-btn');
    if (!btn) { return; }
    btn.innerHTML = ICONS.bell;
    if (unread.length > 0) {
      var b = document.createElement('span');
      b.className = 'notif-badge';
      b.appendChild(document.createTextNode(
          unread.length > 99 ? '99+' : String(unread.length)));
      btn.appendChild(b);
    }
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
    var row = document.createElement('div');
    row.className = 'notif-item';

    var bar = document.createElement('span');
    bar.className = 'notif-bar notif-bar--' + n.severity;
    row.appendChild(bar);

    var mid = document.createElement('div');
    mid.className = 'notif-mid';
    var t = document.createElement('div');
    t.className = 'notif-row-title';
    t.appendChild(document.createTextNode(n.title));
    var s = document.createElement('div');
    s.className = 'notif-row-sub';
    s.appendChild(document.createTextNode(
        n.source + '  ·  ' + ageLabel(n.created_at)));
    mid.appendChild(t);
    mid.appendChild(s);
    row.appendChild(mid);

    var trash = document.createElement('button');
    trash.className = 'notif-trash';
    trash.setAttribute('type', 'button');
    trash.setAttribute('aria-label', 'Marcar como lida');
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
    if (s < 60)    { return 'ha ' + Math.floor(s) + 's'; }
    if (s < 3600)  { return 'ha ' + Math.floor(s / 60) + ' min'; }
    if (s < 86400) { return 'ha ' + Math.floor(s / 3600) + ' h'; }
    return 'ha ' + Math.floor(s / 86400) + ' d';
  }

  /* --- Modal de detalhe ---------------------------------------------------*/
  function openDetail(n) {
    var titleEl = document.getElementById('notification-modal-title');
    var body    = document.getElementById('notification-modal-body');
    var trash   = document.getElementById('notification-modal-trash');
    if (!titleEl || !body || !trash) { return; }

    titleEl.innerHTML = '';
    titleEl.appendChild(document.createTextNode(n.title));

    body.innerHTML = '';
    var meta = document.createElement('div');
    meta.className = 'notif-meta';
    meta.appendChild(document.createTextNode(
        n.source + '  ·  ' + (new Date(n.created_at * 1000)).toLocaleString()));
    body.appendChild(meta);

    var pre = document.createElement('pre');
    pre.className = 'notif-detail';
    pre.appendChild(document.createTextNode(n.detail || '(sem detalhes)'));
    body.appendChild(pre);

    trash.innerHTML = ICONS.trash;
    trash.onclick = function () {
      markRead(n.id);
      if (window.Modals) { Modals.close('notification-modal'); }
    };

    if (window.Modals) { Modals.open('notification-modal'); }
  }

  /* --- Mark as read (otimista) -------------------------------------------*/
  function markRead(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', (CONFIG.apiBase || '') + '/api/notifications/' + id + '/read', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) { refresh(); }
    };
    xhr.send();

    /* UI otimista: remove imediatamente sem esperar resposta. */
    var next = [];
    for (var i = 0; i < unread.length; i++) {
      if (unread[i].id !== id) { next.push(unread[i]); }
    }
    unread = next;
    paintBell();
    renderSidebar();
  }

  /* --- Poll do servidor --------------------------------------------------*/
  function refresh() {
    var url = (CONFIG.apiBase || '') + '/api/notifications?_=' + (new Date()).getTime();
    getJSON(url, function (data) {
      unread = (data && data.items) || [];
      paintBell();
      if (isSidebarOpen()) { renderSidebar(); }
    }, function () {
      /* silencioso — proximo tick tenta de novo */
    });
  }

  /* --- Toggle sidebar -----------------------------------------------------*/
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

  /* --- Wire-up do modal de detalhe (close + backdrop) --------------------*/
  function wireDetailModal() {
    function close() {
      if (window.Modals) { Modals.close('notification-modal'); }
    }
    var backdrop = document.getElementById('notification-modal');
    if (backdrop) { backdrop.onclick = close; }
    /* Clique dentro da caixa nao propaga ao backdrop. */
    var box = document.getElementById('notification-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = document.getElementById('notification-modal-close');
    if (closeBtn) { closeBtn.onclick = close; }
  }

  /* --- API publica --------------------------------------------------------*/
  window.Notifications = {
    start: function () {
      paintBell();
      var btn = document.getElementById('notif-btn');
      var closeBtn = document.getElementById('notif-sidebar-close');
      if (btn)      { btn.onclick = toggleSidebar; }
      if (closeBtn) { closeBtn.onclick = toggleSidebar; }
      wireDetailModal();
      refresh();
      pollTimer = setInterval(refresh, POLL_MS);
    },
    refresh: refresh
  };
})();
