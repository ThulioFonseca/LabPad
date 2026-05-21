/* =============================================================================
 * sparkline.js  —  mini-grafico de linha em <canvas> (ES5, sem bibliotecas).
 *
 * <canvas> 2D funciona bem no Safari 9.
 * ===========================================================================*/

/* drawSparkline(canvas, values, color)
 *   canvas  elemento <canvas> (com width/height ja definidos em pixels)
 *   values  array de numeros; entradas nao-numericas sao ignoradas
 *   color   cor da linha (string CSS)
 */
function drawSparkline(canvas, values, color) {
  var ctx = canvas.getContext('2d');
  var w = canvas.width;
  var h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  if (!values || values.length < 2) { return; }

  /* mantem apenas valores numericos validos */
  var nums = [];
  var i;
  for (i = 0; i < values.length; i++) {
    if (typeof values[i] === 'number' && isFinite(values[i])) {
      nums.push(values[i]);
    }
  }
  if (nums.length < 2) { return; }

  /* faixa vertical */
  var min = nums[0];
  var max = nums[0];
  for (i = 1; i < nums.length; i++) {
    if (nums[i] < min) { min = nums[i]; }
    if (nums[i] > max) { max = nums[i]; }
  }
  var range = max - min;
  if (range <= 0) { range = 1; min = min - 0.5; }

  var pad = 2;
  var stepX = (w - pad * 2) / (nums.length - 1);

  function px(idx) { return pad + stepX * idx; }
  function py(val) { return h - pad - ((val - min) / range) * (h - pad * 2); }

  /* preenchimento sutil sob a linha */
  ctx.beginPath();
  ctx.moveTo(px(0), h);
  for (i = 0; i < nums.length; i++) { ctx.lineTo(px(i), py(nums[i])); }
  ctx.lineTo(px(nums.length - 1), h);
  ctx.closePath();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;

  /* a linha */
  ctx.beginPath();
  ctx.moveTo(px(0), py(nums[0]));
  for (i = 1; i < nums.length; i++) { ctx.lineTo(px(i), py(nums[i])); }
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}
