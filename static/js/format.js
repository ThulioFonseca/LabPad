/* =============================================================================
 * format.js  —  utilitarios genericos: DOM e formatacao de numeros.
 *
 * Sem dependencias. Carregado antes de widgets.js / dashboard.js, que usam
 * estas funcoes. JavaScript ES5 puro (Safari 9 / iPad 2).
 * ===========================================================================*/

var DASH = '—'; /* travessao usado quando nao ha valor */

/* Le um valor aninhado pelo caminho 'a.b.0.c' (indices de array sao numeros). */
function getPath(obj, path) {
  if (!obj || !path) { return undefined; }
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) { return undefined; }
    cur = cur[parts[i]];
  }
  return cur;
}

/* Define o texto de um elemento de forma segura (cria o no de texto se faltar). */
function setText(node, text) {
  if (!node) { return; }
  if (node.firstChild && node.firstChild.nodeType === 3) {
    node.firstChild.nodeValue = text;
  } else {
    node.innerHTML = '';
    node.appendChild(document.createTextNode(text));
  }
}

/* Cria um elemento com classe e (opcionalmente) texto. */
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) { node.className = className; }
  if (text !== undefined && text !== null) {
    node.appendChild(document.createTextNode(text));
  }
  return node;
}

function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n)) { return DASH; }
  var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  var i = 0;
  n = Number(n);
  while (n >= 1024 && i < units.length - 1) { n = n / 1024; i = i + 1; }
  var txt = (i === 0) ? String(Math.round(n))
          : (n < 10 ? n.toFixed(1) : String(Math.round(n)));
  return txt + ' ' + units[i];
}

function fmtRate(n) {
  if (n === null || n === undefined || isNaN(n)) { return DASH; }
  return fmtBytes(n) + '/s';
}

function fmtDuration(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) { return DASH; }
  sec = Math.floor(Number(sec));
  var d = Math.floor(sec / 86400);
  var hh = Math.floor((sec % 86400) / 3600);
  var mm = Math.floor((sec % 3600) / 60);
  if (d > 0) { return d + 'd ' + hh + 'h'; }
  if (hh > 0) { return hh + 'h ' + mm + 'm'; }
  return mm + 'm';
}

function fmtNumber(value) {
  return (Math.round(value * 10) / 10).toString();
}
