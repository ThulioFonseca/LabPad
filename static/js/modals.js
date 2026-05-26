/* =============================================================================
 * modals.js — controle centralizado de modais (window.Modals).
 *
 * Mantem o set de modais abertos e aplica `body.scroll-locked` enquanto pelo
 * menos um esta aberto, evitando que o scroll vaze do modal para o dash atras.
 * Suporta empilhamento (logs sobre containers): fechar o de cima nao destranca
 * se o de baixo ainda esta aberto. Bulletproof iOS: position:fixed + top
 * negativo + scrollTo na hora de destrancar.
 *
 * Deve ser carregado ANTES de qualquer script que use window.Modals.
 * ES5 puro / Safari 9.
 * ===========================================================================*/
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
