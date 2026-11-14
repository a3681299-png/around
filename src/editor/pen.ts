/* The two lines of the Around Studio design system, ported from docs/around-studio-design-system/components/
   bundle.js (AroundStudio). A G-pen line is a filled outline (入り抜き): thin at both tips, fullest a little
   before the middle. It is never a stroked path or a border. tests/studio-pen.spec.ts keeps this port
   point for point equal to the reference. */

export type Point = [number, number];
export interface PenOptions {
  /** Width at its fullest; `pen` 2.4, `pen-large` 3.4. */
  width?: number;
  /** Width at both tips; `pen-tip` 0.2. */
  tip?: number;
  /** Where along the line it is fullest; a little before the middle. */
  bias?: number;
}

const SVG = 'http://www.w3.org/2000/svg';
/** One 12fps frame (コマ打ち), in ms. */
export const FRAME_MS = 1000 / 12;

function fmt(p: Point) {
  return p[0].toFixed(1) + ' ' + p[1].toFixed(1);
}

/* Width along the line: tip → widest at `bias` → tip. */
function widthAt(t: number, max: number, tip: number, bias: number) {
  const k = t < bias ? t / bias : (1 - t) / (1 - bias);
  return tip + (max - tip) * Math.pow(Math.sin((Math.min(1, k) * Math.PI) / 2), 0.7);
}

/** SVG path data of the filled G-pen stroke along the centreline samples. */
export function penOutline(points: readonly Point[], opts: PenOptions = {}): string {
  const max = opts.width || 2.4,
    tip = opts.tip == null ? 0.2 : opts.tip,
    bias = opts.bias || 0.45;
  const n = points.length,
    lengths = [0];
  for (let i = 1; i < n; i++)
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const total = lengths[n - 1] || 1,
    left: Point[] = [],
    right: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]!,
      b = points[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d,
      ny = dx / d,
      w = widthAt(lengths[i]! / total, max, tip, bias) / 2;
    left.push([points[i]![0] + nx * w, points[i]![1] + ny * w]);
    right.push([points[i]![0] - nx * w, points[i]![1] - ny * w]);
  }
  return 'M ' + left.map(fmt).join(' L ') + ' L ' + right.reverse().map(fmt).join(' L ') + ' Z';
}

export function centreline(points: readonly Point[]): string {
  return 'M ' + points.map(fmt).join(' L ');
}

export function line(x1: number, y1: number, x2: number, y2: number, n = 8): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) out.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]);
  return out;
}

export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n?: number): Point[] {
  const steps = n || Math.max(8, Math.round((Math.abs(a1 - a0) * r) / 4));
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** The golden spiral through a φ rectangle at (x, y); `sizes` are the square sides, largest first. */
export function goldenSpiral(x: number, y: number, sizes: readonly number[]): Point[] {
  let X = x,
    Y = y,
    W = sizes[0]! + sizes[1]!,
    H = sizes[0]!,
    pts: Point[] = [];
  sizes.forEach((s, i) => {
    let c: Point, a: [number, number];
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
    const p = arc(c[0], c[1], s, a[0], a[1]);
    pts = pts.concat(pts.length ? p.slice(1) : p);
  });
  return pts;
}

let uid = 0;
export interface DrawOptions extends PenOptions {
  /** A CSS colour for the ink (`var(--cobalt)`). */
  color?: string;
  /** Frames before it starts. */
  delay?: number;
  /** Frames it takes to draw; 4 for a mark, up to 12 for a spiral. */
  frames?: number;
}
/** Draws a G-pen line into an <svg> (or <g>), revealed from its start on 12fps steps. */
export function drawPen(target: SVGElement, points: readonly Point[], opts: DrawOptions = {}): SVGPathElement {
  const doc = target.ownerDocument;
  const id = 'around-pen-' + ++uid;
  const mask = doc.createElementNS(SVG, 'mask');
  mask.setAttribute('id', id);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', '-10000');
  mask.setAttribute('y', '-10000');
  mask.setAttribute('width', '20000');
  mask.setAttribute('height', '20000');
  const reveal = doc.createElementNS(SVG, 'path');
  reveal.setAttribute('d', centreline(points));
  reveal.setAttribute('pathLength', '1');
  reveal.setAttribute('fill', 'none');
  reveal.setAttribute('stroke', '#fff');
  reveal.setAttribute('stroke-linecap', 'round');
  reveal.setAttribute('stroke-width', String((opts.width || 2.4) * 4));
  reveal.setAttribute('class', 'around-draw');
  reveal.style.setProperty('--around-frames', String(opts.frames || 4));
  reveal.style.setProperty('--around-delay', Math.round((opts.delay || 0) * FRAME_MS) + 'ms');
  mask.appendChild(reveal);
  const pen = doc.createElementNS(SVG, 'path');
  pen.setAttribute('d', penOutline(points, opts));
  pen.setAttribute('class', 'around-pen');
  pen.setAttribute('mask', 'url(#' + id + ')');
  if (opts.color) pen.style.color = opts.color;
  target.appendChild(mask);
  target.appendChild(pen);
  return pen;
}

/** A ruler line for construction guides, ruled in on 12fps steps. */
export function drawRule(target: SVGElement, d: string, delay = 0, frames = 4): SVGPathElement {
  const rule = target.ownerDocument.createElementNS(SVG, 'path');
  rule.setAttribute('d', d);
  rule.setAttribute('pathLength', '1');
  rule.setAttribute('class', 'around-rule around-draw');
  rule.style.setProperty('--around-frames', String(frames));
  rule.style.setProperty('--around-delay', Math.round(delay * FRAME_MS) + 'ms');
  target.appendChild(rule);
  return rule;
}

export function svg(doc: Document, viewBox: string, className: string): SVGSVGElement {
  const node = doc.createElementNS(SVG, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  return node;
}
