/* =============================================================================
 * settings.js  —  painel de configuracoes (engrenagem -> modal).
 *
 * Substitui o antigo theme.js. Concentra:
 *   - catalogo de temas/acentos (era theme.js)
 *   - defaults e persistencia de configuracoes do frontend (localStorage)
 *   - sincronia com o backend via GET/PUT /api/settings
 *   - construcao do botao da engrenagem na topbar
 *   - construcao do modal de configuracoes com 5 secoes
 *   - aplicacao das classes em <html> (theme, mode, cards, news)
 *
 * Depende de el()/setText() (format.js) e do global LEVEL_COLOR (widgets.js).
 * ES5 puro / Safari 9.
 * ===========================================================================*/
/* === Controle centralizado de modais ========================================
   Mantem o set de modais abertos e aplica `body.scroll-locked` enquanto pelo
   menos um esta aberto, evitando que o scroll vaze do modal para o dash atras.
   Suporta empilhamento (logs sobre containers): fechar o de cima nao destranca
   se o de baixo ainda esta aberto. Bulletproof iOS: position:fixed + top
   negativo + scrollTo na hora de destrancar.
   Definido FORA do IIFE principal para que dashboard.js (carregado depois)
   tambem possa usar via window.Modals. ===========================================*/
(function () {
  var openIds = {};
  var savedScrollY = 0;

  function countOpen() {
    var n = 0;
    for (var k in openIds) {
      if (openIds.hasOwnProperty(k) && openIds[k]) { n++; }
    }
    return n;
  }

  function applyLock() {
    var body = document.body;
    var locked = body.className.indexOf('scroll-locked') >= 0;
    if (countOpen() > 0 && !locked) {
      savedScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      body.className = body.className + ' scroll-locked';
      body.style.top = '-' + savedScrollY + 'px';
    } else if (countOpen() === 0 && locked) {
      body.className = body.className.replace(/\s*scroll-locked/g, '');
      body.style.top = '';
      window.scrollTo(0, savedScrollY);
    }
  }

  window.Modals = {
    open: function (id) {
      var m = document.getElementById(id);
      if (!m) { return; }
      m.className = 'modal-backdrop modal-backdrop--open';
      openIds[id] = true;
      applyLock();
    },
    close: function (id) {
      var m = document.getElementById(id);
      if (m) { m.className = 'modal-backdrop'; }
      delete openIds[id];
      applyLock();
    },
    isOpen: function (id) { return !!openIds[id]; }
  };
})();


(function () {

  /* === Catalogos =========================================================*/
  var THEMES = [
    { id: 'minimal',  name: 'Minimal' },
    { id: 'neu',      name: 'Neumorfismo' },
    { id: 'elevated', name: 'Elevado' },
    { id: 'outline',  name: 'Contorno' },
    { id: 'glass',    name: 'Vidro Fosco' }
  ];
  var MODES = [
    { id: 'dark',  name: 'Escuro' },
    { id: 'light', name: 'Claro' }
  ];
  var HEIGHT_PRESETS = [
    { id: 'compact', name: 'Compacto' },
    { id: 'normal',  name: 'Normal' },
    { id: 'roomy',   name: 'Folgado' }
  ];
  var SPARK_WIDGETS = [
    { id: 'cpu',  name: 'CPU' },
    { id: 'mem',  name: 'Memoria' },
    { id: 'disk', name: 'Disco' },
    { id: 'temp', name: 'Temp CPU' },
    { id: 'net',  name: 'Rede' }
  ];
  var WEATHER_SLIDES = [
    { id: 'current',  name: 'Atual (temp + umidade)' },
    { id: 'forecast', name: 'Previsao 5 dias' },
    { id: 'moon',     name: 'Fase da lua' }
  ];

  /* Acento por (tema, modo) — alimenta o sparkline (LEVEL_COLOR.ok). */
  var ACCENTS = {
    minimal:  { dark: '#4f8cff', light: '#2563eb' },
    neu:      { dark: '#8b93f8', light: '#6a74d8' },
    elevated: { dark: '#2dd4bf', light: '#0d9488' },
    outline:  { dark: '#22d3ee', light: '#0891b2' },
    glass:    { dark: '#a78bfa', light: '#7c3aed' }
  };
  var FAINT = { dark: '#6a7080', light: '#8a909e' };

  var GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  /* === Defaults frontend ================================================== */
  var FE_DEFAULTS = {
    theme: 'minimal', mode: 'dark',
    cardHeight: 'normal', newsCardHeight: 'normal',
    sparks: { cpu: true, mem: true, disk: false, temp: true, net: true },
    weatherSlides: ['current', 'forecast', 'moon']
  };

  var SK = 'homelab.settings';  /* unica chave no localStorage */

  /* === Estado ============================================================ */
  var fe = clone(FE_DEFAULTS);
  var be = null;                /* preenchido pelo GET /api/settings */
  var listeners = [];           /* Settings.onChange (qualquer mudanca) */
  var beListeners = [];         /* Settings.onBackendSave (so apos PUT 200) */
  var menuEl = null;            /* nao usado mais (legado removido) */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeDeep(a, b) {
    for (var k in b) {
      if (!b.hasOwnProperty(k)) { continue; }
      if (b[k] && typeof b[k] === 'object' && !(b[k] instanceof Array)) {
        a[k] = mergeDeep(a[k] || {}, b[k]);
      } else if (b[k] !== undefined) {
        a[k] = b[k];
      }
    }
    return a;
  }

  /* === Persistencia frontend ============================================ */
  function loadFE() {
    try {
      var raw = localStorage.getItem(SK);
      if (raw) {
        var parsed = JSON.parse(raw);
        fe = mergeDeep(clone(FE_DEFAULTS), parsed);
      }
      /* Migracao das chaves antigas (theme.js v1). */
      var oldT = localStorage.getItem('homelab.theme');
      var oldM = localStorage.getItem('homelab.mode');
      if (oldT) { fe.theme = oldT; }
      if (oldM) { fe.mode = oldM; }
    } catch (e) { /* localStorage indisponivel */ }
  }
  function saveFE() {
    try {
      localStorage.setItem(SK, JSON.stringify(fe));
      localStorage.removeItem('homelab.theme');
      localStorage.removeItem('homelab.mode');
    } catch (e) {}
  }

  /* === Aplicacao no DOM ================================================== */
  function applyHtmlClasses() {
    document.documentElement.className =
      'theme-' + fe.theme + ' mode-' + fe.mode +
      ' cards-' + fe.cardHeight + ' news-' + fe.newsCardHeight;
    if (typeof LEVEL_COLOR !== 'undefined') {
      var acc = (ACCENTS[fe.theme] || ACCENTS.minimal)[fe.mode];
      LEVEL_COLOR.ok = acc;
      LEVEL_COLOR.none = FAINT[fe.mode];
    }
  }
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](window.Settings); } catch (e) {}
    }
  }
  function notifyBackend() {
    for (var i = 0; i < beListeners.length; i++) {
      try { beListeners[i](window.Settings); } catch (e) {}
    }
  }

  /* === API publica (consumida por widgets.js / dashboard.js) ============= */
  window.Settings = {
    spark: function (id) { return fe.sparks[id] !== false; },
    weatherSlides: function () { return fe.weatherSlides.slice(); },
    onChange: function (cb) { if (typeof cb === 'function') { listeners.push(cb); } },
    /* Dispara SO depois de um PUT /api/settings retornar 200 — sinal claro
       de que dados do servidor mudaram (cidade/URL/limite). dashboard.js usa
       para refazer o pollFeeds imediato em vez de esperar o ciclo de 10 min. */
    onBackendSave: function (cb) { if (typeof cb === 'function') { beListeners.push(cb); } }
  };

  /* === Helpers de formulario ============================================ */
  function section(title) {
    var s = el('section', 'settings-section');
    s.appendChild(el('h3', 'settings-section-title', title));
    return s;
  }
  function formRow(labelText, control, helpText) {
    var row = el('div', 'form-row');
    if (labelText) { row.appendChild(el('label', 'form-label', labelText)); }
    row.appendChild(control);
    if (helpText) { row.appendChild(el('div', 'form-help', helpText)); }
    return row;
  }
  function selectInput(name, options, currentId) {
    var sel = el('select', 'form-select');
    sel.name = name;
    for (var i = 0; i < options.length; i++) {
      var op = options[i];
      var o = document.createElement('option');
      o.value = op.id;
      o.text = op.name;
      if (op.id === currentId) { o.selected = true; }
      sel.appendChild(o);
    }
    return sel;
  }
  function textInput(name, value, placeholder) {
    var inp = el('input', 'form-input');
    inp.type = 'text';
    inp.name = name;
    inp.value = value || '';
    if (placeholder) { inp.placeholder = placeholder; }
    return inp;
  }
  function numberInput(name, value, min, max) {
    var inp = el('input', 'form-input');
    inp.type = 'number';
    inp.name = name;
    inp.value = (value === undefined || value === null) ? '' : String(value);
    if (min !== undefined) { inp.min = String(min); }
    if (max !== undefined) { inp.max = String(max); }
    return inp;
  }
  function checkboxList(name, options, currentSetMap) {
    /* options: [{id,name}]. currentSetMap: { id -> bool }. */
    var wrap = el('div', 'form-checks');
    for (var i = 0; i < options.length; i++) {
      var op = options[i];
      var lab = el('label', 'form-check');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = name;
      cb.value = op.id;
      cb.checked = !!currentSetMap[op.id];
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(op.name));
      wrap.appendChild(lab);
    }
    return wrap;
  }

  /* === Construcao das secoes ============================================ */
  function buildModalBody() {
    var body = document.getElementById('settings-modal-body');
    if (!body) { return; }
    body.innerHTML = '';
    body.appendChild(buildThemeSection());
    body.appendChild(buildCardsSection());
    body.appendChild(buildWeatherSection());
    body.appendChild(buildCalendarSection());
    body.appendChild(buildNewsSection());
    body.appendChild(buildActions());
  }

  function buildThemeSection() {
    var s = section('Tema');
    s.appendChild(formRow('Tema',
      selectInput('theme', THEMES, fe.theme)));
    s.appendChild(formRow('Aparencia',
      selectInput('mode', MODES, fe.mode)));
    return s;
  }
  function buildCardsSection() {
    var s = section('Cards');
    s.appendChild(formRow('Altura',
      selectInput('cardHeight', HEIGHT_PRESETS, fe.cardHeight)));
    s.appendChild(formRow('Mostrar grafico em:',
      checkboxList('sparks', SPARK_WIDGETS, fe.sparks),
      'Sparkline (mini-grafico) abaixo do card.'));
    return s;
  }
  function buildWeatherSection() {
    var s = section('Clima');
    var city = be && be.weather ? be.weather.city : '';
    s.appendChild(formRow('Cidade',
      textInput('weather.city', city, 'ex.: Sao Paulo'),
      'Vazio desativa o widget de clima.'));
    var slidesMap = {};
    for (var i = 0; i < fe.weatherSlides.length; i++) {
      slidesMap[fe.weatherSlides[i]] = true;
    }
    s.appendChild(formRow('Slides no cabecalho',
      checkboxList('weatherSlides', WEATHER_SLIDES, slidesMap),
      'Quais informacoes alternar (de 10 em 10s) no clima do topo.'));
    return s;
  }
  function buildCalendarSection() {
    var s = section('Agenda');
    var url = be && be.calendar ? be.calendar.url : '';
    var days = be && be.calendar ? be.calendar.days : 3;
    s.appendChild(formRow('URL do calendario (.ics)',
      textInput('calendar.url', url, 'https://outlook.office365.com/.../calendar.ics'),
      'Link-capacidade (privado). Vazio desativa a agenda.'));
    s.appendChild(formRow('Dias a frente (1-30)',
      numberInput('calendar.days', days, 1, 30)));
    return s;
  }
  function buildNewsSection() {
    var s = section('Noticias');
    var url = be && be.news ? be.news.url : '';
    var limit = be && be.news ? be.news.limit : 5;
    s.appendChild(formRow('URL do feed RSS/Atom',
      textInput('news.url', url, 'https://g1.globo.com/rss/g1/'),
      'Vazio desativa o feed de noticias.'));
    s.appendChild(formRow('Quantas exibir (1-50)',
      numberInput('news.limit', limit, 1, 50)));
    s.appendChild(formRow('Altura do card',
      selectInput('newsCardHeight', HEIGHT_PRESETS, fe.newsCardHeight)));
    return s;
  }
  function buildActions() {
    var row = el('div', 'settings-actions');
    var reset = el('button', 'btn-secondary', 'Restaurar padroes');
    reset.type = 'button';
    reset.onclick = function () {
      fe = clone(FE_DEFAULTS);
      saveFE();
      applyHtmlClasses();
      buildModalBody();   /* re-render dos inputs */
      notify();
      toast('Padroes restaurados (apenas frontend).');
    };
    var save = el('button', 'btn-save', 'Salvar');
    save.type = 'button';
    save.onclick = doSave;
    row.appendChild(reset);
    row.appendChild(save);
    return row;
  }

  /* === Leitura do formulario + save ====================================== */
  function gatherFromForm() {
    var body = document.getElementById('settings-modal-body');
    var feNext = clone(fe);
    var bePartial = {};

    var theme = body.querySelector('select[name="theme"]');
    var mode  = body.querySelector('select[name="mode"]');
    var ch    = body.querySelector('select[name="cardHeight"]');
    var nh    = body.querySelector('select[name="newsCardHeight"]');
    if (theme) { feNext.theme = theme.value; }
    if (mode)  { feNext.mode  = mode.value; }
    if (ch)    { feNext.cardHeight = ch.value; }
    if (nh)    { feNext.newsCardHeight = nh.value; }

    var sparkBoxes = body.querySelectorAll('input[name="sparks"]');
    feNext.sparks = {};
    for (var i = 0; i < sparkBoxes.length; i++) {
      feNext.sparks[sparkBoxes[i].value] = sparkBoxes[i].checked;
    }
    var slideBoxes = body.querySelectorAll('input[name="weatherSlides"]');
    feNext.weatherSlides = [];
    for (var j = 0; j < slideBoxes.length; j++) {
      if (slideBoxes[j].checked) { feNext.weatherSlides.push(slideBoxes[j].value); }
    }

    /* Backend (somente fields que existem no formulario) */
    var city = body.querySelector('input[name="weather.city"]');
    if (city) {
      bePartial.weather = { city: city.value };
    }
    var calUrl = body.querySelector('input[name="calendar.url"]');
    var calDays = body.querySelector('input[name="calendar.days"]');
    if (calUrl || calDays) {
      bePartial.calendar = {};
      if (calUrl)  { bePartial.calendar.url = calUrl.value; }
      if (calDays) { bePartial.calendar.days = parseInt(calDays.value, 10); }
    }
    var newsUrl = body.querySelector('input[name="news.url"]');
    var newsLim = body.querySelector('input[name="news.limit"]');
    if (newsUrl || newsLim) {
      bePartial.news = {};
      if (newsUrl) { bePartial.news.url = newsUrl.value; }
      if (newsLim) { bePartial.news.limit = parseInt(newsLim.value, 10); }
    }
    return { fe: feNext, be: bePartial };
  }

  function doSave() {
    var picked = gatherFromForm();
    fe = picked.fe;
    saveFE();
    applyHtmlClasses();
    notify();

    var xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/settings', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      if (xhr.status === 200) {
        try { be = JSON.parse(xhr.responseText); } catch (e) {}
        notify();
        notifyBackend();   /* dashboard refaz pollFeeds imediato */
        toast('Salvo.');
        closeSettingsModal();
      } else {
        var msg = 'Erro ao salvar.';
        try { msg = (JSON.parse(xhr.responseText).error) || msg; } catch (e) {}
        toast(msg);
      }
    };
    xhr.onerror = function () { toast('Sem conexao com o servidor.'); };
    xhr.send(JSON.stringify(picked.be));
  }

  /* === Toast (feedback rapido) =========================================== */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('settings-toast');
    if (!t) {
      t = el('div', 'toast');
      t.id = 'settings-toast';
      document.body.appendChild(t);
    }
    setText(t, msg);
    t.className = 'toast toast--show';
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2400);
  }

  /* === Modal abrir/fechar ================================================ */
  function openSettingsModal() { Modals.open('settings-modal'); }
  function closeSettingsModal() { Modals.close('settings-modal'); }

  /* === Engrenagem (botao na topbar) ===================================== */
  function buildGearAndWire() {
    var slot = document.getElementById('theme-control');
    if (!slot) { return; }
    /* Limpa caso o slot tenha sido populado por uma versao antiga (theme.js). */
    slot.innerHTML = '';
    var gear = el('button', 'theme-gear');
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Configuracoes');
    gear.innerHTML = GEAR;
    gear.onclick = openSettingsModal;
    slot.appendChild(gear);

    var backdrop = document.getElementById('settings-modal');
    if (backdrop) { backdrop.onclick = closeSettingsModal; }
    var box = document.getElementById('settings-modal-box');
    if (box) { box.onclick = function (e) { e.stopPropagation(); }; }
    var closeBtn = document.getElementById('settings-modal-close');
    if (closeBtn) { closeBtn.onclick = closeSettingsModal; }
  }

  /* === Init ============================================================= */
  function init() {
    loadFE();
    applyHtmlClasses();

    /* Busca settings do backend (cidade, URLs, limites). Se falhar, segue
       com defaults — o painel ainda funciona para configs do frontend. */
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/settings?_=' + (new Date()).getTime(), true);
    xhr.onload = function () {
      try { be = (xhr.status === 200) ? JSON.parse(xhr.responseText) : {}; }
      catch (e) { be = {}; }
      buildModalBody();
      buildGearAndWire();
    };
    xhr.onerror = function () { be = {}; buildModalBody(); buildGearAndWire(); };
    xhr.send();
  }

  init();

})();
