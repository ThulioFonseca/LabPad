/* =============================================================================
 * xhr.js  —  requisicoes HTTP em JavaScript ES5 puro.
 *
 * O Safari 9 (iPad 2 / iOS 9.3.5) NAO tem fetch(). Usamos XMLHttpRequest.
 * ===========================================================================*/

/* getJSON(url, onOk, onErr)
 *   onOk(objeto)   — chamado com o JSON ja parseado
 *   onErr(motivo)  — chamado em erro (timeout, rede, http, parse)
 */
function getJSON(url, onOk, onErr, timeoutMs) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.timeout = timeoutMs || 12000;

  /* Settle EXACTLY ONCE. Safari 9 dispatches BOTH the readystatechange to
     DONE (readyState 4, status 0) AND the dedicated ontimeout/onerror event
     when a request times out or fails at the network layer — so a naive
     wrapper fires its callback twice per failure. For a one-shot call that is
     harmless, but poll() and pollFeeds() (dashboard.js) reschedule themselves
     from their error handler: a double error there spawns a SECOND parallel
     polling loop, and every later failure doubles it again. On the display's
     long uptime a flaky backend would geometrically multiply the request rate
     and leak timers until Safari kills the tab — exactly the per-loop growth
     CLAUDE.md guards against. The guard below collapses each request to a
     single onOk/onErr. */
  var settled = false;
  function ok(data)     { if (settled) { return; } settled = true; onOk(data); }
  function fail(reason) { if (settled) { return; } settled = true; if (onErr) { onErr(reason); } }

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) { return; }

    /* status 0 means timeout / network error / abort — there is no HTTP
       response to read, and a dedicated handler (ontimeout/onerror) fires with
       a more specific reason. Skipping it here keeps 'timeout'/'rede' as the
       reported reason instead of a generic 'http 0'; the settle-once guard
       still covers us if that handler somehow doesn't run (xhr.timeout is
       always set, so ontimeout is the backstop). */
    if (xhr.status === 0) { return; }

    if (xhr.status >= 200 && xhr.status < 300) {
      var data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        fail('parse');
        return;
      }
      ok(data);
    } else {
      fail('http ' + xhr.status);
    }
  };

  xhr.ontimeout = function () { fail('timeout'); };
  xhr.onerror = function () { fail('rede'); };

  xhr.send();
}
