/* =============================================================================
 * theme.js  —  seletor de tema (engrenagem na topbar).
 *
 * 5 temas (minimal, neu, elevated, outline, glass) x 2 modos (dark, light).
 * O tema vive como classe em <html> ('theme-X mode-Y'); um script inline no
 * <head> ja aplica a classe salva antes da pintura (sem flash). Aqui montamos
 * o botao + painel e tratamos a troca. JavaScript ES5 puro (Safari 9 / iPad 2).
 *
 * Depende de: el() (format.js) e do global LEVEL_COLOR (widgets.js).
 * ===========================================================================*/

(function () {

  var THEMES = [
    { id: 'minimal',  name: 'Minimal' },
    { id: 'neu',      name: 'Neumorfismo' },
    { id: 'elevated', name: 'Elevado' },
    { id: 'outline',  name: 'Contorno' },
    { id: 'glass',    name: 'Vidro Fosco' }
  ];

  /* Acento por tema/modo — alimenta o sparkline (LEVEL_COLOR.ok). */
  var ACCENTS = {
    minimal:  { dark: '#4f8cff', light: '#2563eb' },
    neu:      { dark: '#8b93f8', light: '#6a74d8' },
    elevated: { dark: '#2dd4bf', light: '#0d9488' },
    outline:  { dark: '#22d3ee', light: '#0891b2' },
    glass:    { dark: '#a78bfa', light: '#7c3aed' }
  };
  var FAINT = { dark: '#6a7080', light: '#8a909e' };

  var GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  var state = { theme: 'minimal', mode: 'dark' };
  var menuEl = null;

  function load() {
    try {
      state.theme = localStorage.getItem('homelab.theme') || 'minimal';
      state.mode  = localStorage.getItem('homelab.mode')  || 'dark';
    } catch (e) { /* localStorage indisponivel */ }
  }

  function save() {
    try {
      localStorage.setItem('homelab.theme', state.theme);
      localStorage.setItem('homelab.mode', state.mode);
    } catch (e) { /* ignora */ }
  }

  function apply() {
    document.documentElement.className = 'theme-' + state.theme + ' mode-' + state.mode;
    /* LEVEL_COLOR e global (widgets.js); o sparkline o le a cada ciclo. */
    if (typeof LEVEL_COLOR !== 'undefined') {
      var accents = ACCENTS[state.theme] || ACCENTS.minimal;
      LEVEL_COLOR.ok = accents[state.mode];
      LEVEL_COLOR.none = FAINT[state.mode];
    }
  }

  function makeThemeOpt(theme) {
    var cls = 'theme-opt' + (state.theme === theme.id ? ' theme-opt--active' : '');
    var btn = el('button', cls, theme.name);
    btn.type = 'button';
    btn.onclick = function () {
      state.theme = theme.id;
      apply(); save(); refresh();
    };
    return btn;
  }

  function makeModeBtn(mode, label) {
    var cls = 'theme-mode-btn' + (state.mode === mode ? ' theme-mode-btn--active' : '');
    var btn = el('button', cls, label);
    btn.type = 'button';
    btn.onclick = function () {
      state.mode = mode;
      apply(); save(); refresh();
    };
    return btn;
  }

  function buildMenu() {
    menuEl = el('div', 'theme-menu');
    menuEl.appendChild(el('div', 'theme-menu-label', 'Tema'));
    for (var i = 0; i < THEMES.length; i++) {
      menuEl.appendChild(makeThemeOpt(THEMES[i]));
    }
    menuEl.appendChild(el('div', 'theme-menu-label', 'Aparencia'));
    var row = el('div', 'theme-mode-row');
    row.appendChild(makeModeBtn('dark', 'Escuro'));
    row.appendChild(makeModeBtn('light', 'Claro'));
    menuEl.appendChild(row);
    /* Cliques dentro do menu nao chegam ao document (que fecha o menu). */
    menuEl.onclick = function (e) { e.stopPropagation(); };
    return menuEl;
  }

  /* Re-renderiza o menu para atualizar os destaques (--active). */
  function refresh() {
    var wasOpen = menuEl && menuEl.className.indexOf('theme-menu--open') >= 0;
    var parent = menuEl ? menuEl.parentNode : null;
    if (parent) { parent.removeChild(menuEl); }
    buildMenu();
    if (wasOpen) { menuEl.className = 'theme-menu theme-menu--open'; }
    if (parent) { parent.appendChild(menuEl); }
  }

  function init() {
    load();
    apply();

    var slot = document.getElementById('theme-control');
    if (!slot) { return; }

    var gear = el('button', 'theme-gear');
    gear.type = 'button';
    gear.innerHTML = GEAR;
    gear.onclick = function (e) {
      e.stopPropagation();
      menuEl.className = (menuEl.className.indexOf('--open') >= 0)
        ? 'theme-menu'
        : 'theme-menu theme-menu--open';
    };
    slot.appendChild(gear);
    slot.appendChild(buildMenu());

    /* Clique fora do menu fecha (o menu interrompe a propagacao). */
    document.onclick = function () {
      if (menuEl) { menuEl.className = 'theme-menu'; }
    };
  }

  init();

})();
