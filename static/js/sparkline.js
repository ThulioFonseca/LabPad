/* =============================================================================
 * sparkline.js  —  mini-grafico de linha em <canvas> (ES5, sem bibliotecas).
 *
 * <canvas> 2D funciona bem no Safari 9.
 * ===========================================================================*/

/* drawSparkline(canvas, values, color)
 *   canvas  elemento <canvas> (com width/height ja definidos em pixels)
 *   values  array of numbers; non-numeric entries are ignored
 *   color   cor da linha (string CSS)
 */
function drawSparkline(canvas, values, color) {
  var ctx = canvas.getContext('2d');
  var w = canvas.width;
  var h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  if (!values || values.length < 2) { return; }

  /* Um unico passo: conta as amostras validas e acha a faixa vertical SEM
     alocar um array intermediario. drawSparkline roda para cada sparkline
     visivel a cada ciclo de metricas (5s), para sempre — alocar um array
     novo (e, antes, duas closures px/py) a cada chamada acumulava lixo de GC
     no iPad 2 (512 MB) ao longo de dias ligado, exatamente a classe de leak
     por-ciclo que o CLAUDE.md combate. Mantido sem alocacao: mesma saida,
     zero churn de heap por ciclo. Valores nao-numericos sao ignorados
     (a serie comprime, como antes). */
  var count = 0;
  var min = Infinity, max = -Infinity;
  var i, v;
  for (i = 0; i < values.length; i++) {
    v = values[i];
    if (typeof v === 'number' && isFinite(v)) {
      if (v < min) { min = v; }
      if (v > max) { max = v; }
      count = count + 1;
    }
  }
  if (count < 2) { return; }

  var range = max - min;
  if (range <= 0) { range = 1; min = min - 0.5; }

  var pad = 2;
  var stepX = (w - pad * 2) / (count - 1);
  var innerH = h - pad * 2;
  var j, x, y;

  /* preenchimento sutil sob a linha */
  j = 0;
  ctx.beginPath();
  ctx.moveTo(pad, h);
  for (i = 0; i < values.length; i++) {
    v = values[i];
    if (typeof v === 'number' && isFinite(v)) {
      ctx.lineTo(pad + stepX * j, h - pad - ((v - min) / range) * innerH);
      j = j + 1;
    }
  }
  ctx.lineTo(pad + stepX * (count - 1), h);
  ctx.closePath();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;

  /* a linha */
  j = 0;
  ctx.beginPath();
  for (i = 0; i < values.length; i++) {
    v = values[i];
    if (typeof v === 'number' && isFinite(v)) {
      x = pad + stepX * j;
      y = h - pad - ((v - min) / range) * innerH;
      if (j === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      j = j + 1;
    }
  }
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}
