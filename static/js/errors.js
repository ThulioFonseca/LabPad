/* =============================================================================
 * errors.js  —  hardened client-side error reporter.
 *
 * Pure ES5 (Safari 9 / iPad 2). Loaded FIRST (before every other script) so it
 * is already armed when the others initialize and can catch errors they throw
 * on the way up.
 *
 * WHY THIS EXISTS
 * The dashboard is an always-on wall display that runs 24/7 for weeks. Reporting
 * an uncaught error to /api/client-error is genuinely useful — you cannot open
 * devtools on a kiosk iPad, so the docker logs are the only window into a
 * regression. But a *naive* reporter is itself a long-uptime hazard: if a bug is
 * thrown from a REPEATING path (the 5s render loop, the 60s calendar tick, any
 * per-cycle handler) an unthrottled handler fires on every occurrence — a fresh
 * XMLHttpRequest + JSON payload allocated every few seconds forever, an endless
 * stream of POSTs, and unbounded growth of the backend logs. That is the exact
 * "sustained per-cycle allocation over long uptime" failure the iPad 2 cannot
 * survive (see CLAUDE.md) — the diagnostic tool turning into a second crash
 * vector.
 *
 * So every report — the global window.onerror AND the dashboard's own caught
 * errors — goes through report() below, which:
 *   - DEDUPES identical errors (same message + source + line + context): a
 *     looping error is reported ONCE, not thousands of times.
 *   - RATE-LIMITS distinct errors to at most one POST per MIN_INTERVAL_MS, so a
 *     burst of *different* errors can't flood the endpoint either.
 *   - HARD-CAPS total reports per page load at MAX_REPORTS, then goes silent.
 *     The first handful of distinct errors already carry the diagnostic signal;
 *     the wall display must not spend the next week allocating XHRs and filling
 *     logs. The cap also bounds the dedupe set's memory — a signature is only
 *     stored when a report is actually sent, so it holds at most MAX_REPORTS
 *     keys and never grows without limit.
 * ===========================================================================*/
(function () {

  /* Total POSTs allowed per page load. After this the reporter is silent —
     N distinct samples are enough to diagnose, and stability wins over
     completeness on the target device. */
  var MAX_REPORTS = 25;

  /* Minimum gap between POSTs for *distinct* errors. Dedupe already collapses a
     repeating identical error to one; this bounds the rate when the errors
     differ each time (e.g. a message carrying a changing value). */
  var MIN_INTERVAL_MS = 10000;

  var sent = {};        /* dedupe: signature -> true (<= MAX_REPORTS keys) */
  var count = 0;        /* reports actually sent this page load */
  var lastSentAt = 0;   /* epoch ms of the last POST */

  function post(payload) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/client-error', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(payload));
    } catch (e) { /* offline / blocked — nothing more we can do */ }
  }

  /* Report one client error, subject to dedupe / rate-limit / cap.
     message: the error text; source/lineno: where it came from (optional);
     context: a short tag identifying the call site (optional). */
  function report(message, source, lineno, context) {
    if (count >= MAX_REPORTS) { return; }

    var msg = (message === null || message === undefined)
              ? '?' : String(message);
    var sig = msg + '|' + (source || '') + '|' + (lineno || 0)
            + '|' + (context || '');
    if (sent[sig]) { return; }   /* already reported this exact error */

    var now = (new Date()).getTime();
    if (now - lastSentAt < MIN_INTERVAL_MS) { return; }   /* too soon */

    sent[sig] = true;
    lastSentAt = now;
    count = count + 1;

    post({
      message: msg,
      source: source || 'window',
      lineno: lineno || 0,
      context: context || ''
    });
  }

  /* Public entry point — dashboard.js (and anything else) reports through this
     so all client errors share one throttle/dedupe/cap budget. */
  window.LabPad = window.LabPad || {};
  window.LabPad.reportError = report;

  /* Catch otherwise-unhandled errors. Returning false keeps the browser's own
     default logging intact — we observe, we don't swallow. */
  window.onerror = function (message, source, lineno) {
    report(message, source, lineno, 'window.onerror');
    return false;
  };

})();
