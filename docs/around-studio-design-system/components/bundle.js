/* Around Studio — construction helpers.
   G-pen lines are filled outlines (入り抜き), never stroked paths, so they keep their taper at every size.
   This file is the reference implementation of the outline: the extension's TypeScript port must
   produce the same shape from the same points and widths. */
(function () {
  var PHI = (1 + Math.sqrt(5)) / 2;
  var SCALE = [4, 8, 12, 20, 32, 52, 84, 136];
  var SVG = 'http://www.w3.org/2000/svg';
  var FRAME = 1000 / 12;

  function fmt(p) {
    return p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  }

  /* Width along the line: tip → widest at `bias` (a little before the middle) → tip. */
  function widthAt(t, max, tip, bias) {
    var k = t < bias ? t / bias : (1 - t) / (1 - bias);
    return tip + (max - tip) * Math.pow(Math.sin((Math.min(1, k) * Math.PI) / 2), 0.7);
  }

  /* points: centreline samples [[x, y], …]. Returns the SVG path data of the filled stroke. */
  function penOutline(points, opts) {
    opts = opts || {};
    var max = opts.width || 2.4,
      tip = opts.tip == null ? 0.2 : opts.tip,
      bias = opts.bias || 0.45;
    var n = points.length,
      lengths = [0],
      i;
    for (i = 1; i < n; i++)
      lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    var total = lengths[n - 1] || 1,
      left = [],
      right = [];
    for (i = 0; i < n; i++) {
      var a = points[Math.max(0, i - 1)],
        b = points[Math.min(n - 1, i + 1)];
      var dx = b[0] - a[0],
        dy = b[1] - a[1],
        d = Math.hypot(dx, dy) || 1;
      var nx = -dy / d,
        ny = dx / d,
        w = widthAt(lengths[i] / total, max, tip, bias) / 2;
      left.push([points[i][0] + nx * w, points[i][1] + ny * w]);
      right.push([points[i][0] - nx * w, points[i][1] - ny * w]);
    }
    return 'M ' + left.map(fmt).join(' L ') + ' L ' + right.reverse().map(fmt).join(' L ') + ' Z';
  }

  function centreline(points) {
    return 'M ' + points.map(fmt).join(' L ');
  }

  function line(x1, y1, x2, y2, n) {
    n = n || 8;
    var out = [];
    for (var i = 0; i <= n; i++) out.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]);
    return out;
  }

  function arc(cx, cy, r, a0, a1, n) {
    n = n || Math.max(8, Math.round((Math.abs(a1 - a0) * r) / 4));
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + ((a1 - a0) * i) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }

  /* The golden spiral through a φ rectangle at (x, y): squares cut left, top, right, bottom in turn.
     sizes: the square sides, largest first (e.g. [136, 84, 52, 32, 20, 12]). */
  function goldenSpiral(x, y, sizes) {
    var X = x,
      Y = y,
      W = sizes[0] + sizes[1],
      H = sizes[0],
      pts = [];
    sizes.forEach(function (s, i) {
      var c, a;
      switch (i % 4) {
        case 0:
          c = [X + s, Y + s];
          a = [Math.PI, 1.5 * Math.PI];
          X += s;
          W -= s;
          break;
        case 1:
          c = [X, Y + s];
          a = [1.5 * Math.PI, 2 * Math.PI];
          Y += s;
          H -= s;
          break;
        case 2:
          c = [X + W - s, Y];
          a = [0, 0.5 * Math.PI];
          W -= s;
          break;
        default:
          c = [X + s, Y + H - s];
          a = [0.5 * Math.PI, Math.PI];
          H -= s;
          break;
      }
      var p = arc(c[0], c[1], s, a[0], a[1]);
      pts = pts.concat(pts.length ? p.slice(1) : p);
    });
    return pts;
  }

  var uid = 0;
  /* Draws a G-pen line into an <svg> (or <g>), revealed from its start in `frames` 12fps frames.
     opts: width, tip, color, delay (frames before it starts), frames (default 4). */
  function drawPen(target, points, opts) {
    opts = opts || {};
    var id = 'around-pen-' + ++uid;
    var mask = document.createElementNS(SVG, 'mask');
    mask.setAttribute('id', id);
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('x', '-10000');
    mask.setAttribute('y', '-10000');
    mask.setAttribute('width', '20000');
    mask.setAttribute('height', '20000');
    var reveal = document.createElementNS(SVG, 'path');
    reveal.setAttribute('d', centreline(points));
    reveal.setAttribute('pathLength', '1');
    reveal.setAttribute('fill', 'none');
    reveal.setAttribute('stroke', '#fff');
    reveal.setAttribute('stroke-linecap', 'round');
    reveal.setAttribute('stroke-width', String((opts.width || 2.4) * 4));
    reveal.setAttribute('class', 'around-draw');
    reveal.style.setProperty('--around-frames', String(opts.frames || 4));
    reveal.style.setProperty('--around-delay', Math.round((opts.delay || 0) * FRAME) + 'ms');
    mask.appendChild(reveal);
    var pen = document.createElementNS(SVG, 'path');
    pen.setAttribute('d', penOutline(points, opts));
    pen.setAttribute('class', 'around-pen');
    pen.setAttribute('mask', 'url(#' + id + ')');
    if (opts.color) pen.style.color = opts.color;
    target.appendChild(mask);
    target.appendChild(pen);
    return pen;
  }

  window.AroundStudio = {
    PHI: PHI,
    SCALE: SCALE,
    FRAME_MS: FRAME,
    penOutline: penOutline,
    centreline: centreline,
    line: line,
    arc: arc,
    goldenSpiral: goldenSpiral,
    drawPen: drawPen,
  };
})();
