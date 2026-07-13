/* =============================================================================
 * format.js  —  generic utilities: DOM helpers and number formatting.
 *
 * No dependencies. Loaded before widgets.js / dashboard.js, which use
 * these functions. Pure JavaScript ES5 (Safari 9 / iPad 2).
 * ===========================================================================*/

var DASH = '—'; /* em-dash used when no value is available */

/* Read a nested value by path 'a.b.0.c' (array indices are numbers). */
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

/* Safely set the text of an element (creates the text node if missing). */
function setText(node, text) {
  if (!node) { return; }
  if (node.firstChild && node.firstChild.nodeType === 3) {
    node.firstChild.nodeValue = text;
  } else {
    node.innerHTML = '';
    node.appendChild(document.createTextNode(text));
  }
}

/* Create an element with a class and optional text content. */
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

/* Set a progress-bar fill level (0..100) via a GPU-composited transform
   instead of animating `width` (which forces layout + paint every frame — a
   real cost on the iPad 2 when it happens on many bars every metrics cycle).
   The fill element must be width:100% with transform-origin:left (cards.css). */
function setBarFill(node, pct) {
  if (!node) { return; }
  if (typeof pct !== 'number' || !isFinite(pct)) { pct = 0; }
  if (pct < 0) { pct = 0; } else if (pct > 100) { pct = 100; }
  var s = 'scaleX(' + (pct / 100) + ')';
  node.style.webkitTransform = s;
  node.style.transform = s;
}

/* Build a safe CSS url("...") value from an untrusted string (e.g. an image
   URL from an RSS feed). Escapes the quote and backslash that would otherwise
   break out of the quoted string, and drops newlines. */
function cssUrl(u) {
  var s = String(u === null || u === undefined ? '' : u)
            .replace(/[\\"]/g, '\\$&')
            .replace(/[\r\n]/g, '');
  return 'url("' + s + '")';
}
