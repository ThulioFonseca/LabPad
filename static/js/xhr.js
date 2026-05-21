/* =============================================================================
 * xhr.js  —  requisicoes HTTP em JavaScript ES5 puro.
 *
 * O Safari 9 (iPad 2 / iOS 9.3.5) NAO tem fetch(). Usamos XMLHttpRequest.
 * ===========================================================================*/

/* getJSON(url, onOk, onErr)
 *   onOk(objeto)   — chamado com o JSON ja parseado
 *   onErr(motivo)  — chamado em erro (timeout, rede, http, parse)
 */
function getJSON(url, onOk, onErr) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.timeout = 12000;

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) { return; }

    if (xhr.status >= 200 && xhr.status < 300) {
      var data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        if (onErr) { onErr('parse'); }
        return;
      }
      onOk(data);
    } else {
      if (onErr) { onErr('http ' + xhr.status); }
    }
  };

  xhr.ontimeout = function () { if (onErr) { onErr('timeout'); } };
  xhr.onerror = function () { if (onErr) { onErr('rede'); } };

  xhr.send();
}
