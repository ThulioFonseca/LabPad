/* =============================================================================
 * modals.js — centralised modal controller (window.Modals).
 *
 * Tracks the set of open modals and applies `body.scroll-locked` while at
 * least one is open, preventing scroll from leaking to the dashboard behind.
 * Supports stacking (logs on top of containers): closing the top one does not
 * unlock if the one below is still open. iOS bulletproof: position:fixed + negative
 * top + scrollTo when unlocking.
 *
 * Must be loaded BEFORE any script that uses window.Modals.
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
