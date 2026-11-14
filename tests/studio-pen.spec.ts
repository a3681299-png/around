import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { arc, centreline, goldenSpiral, line, penOutline } from '../src/editor/pen';

type Points = [number, number][];
interface Reference {
  penOutline(points: Points, opts?: { width?: number; tip?: number; bias?: number }): string;
  centreline(points: Points): string;
  line(x1: number, y1: number, x2: number, y2: number, n?: number): Points;
  arc(cx: number, cy: number, r: number, a0: number, a1: number, n?: number): Points;
  goldenSpiral(x: number, y: number, sizes: number[]): Points;
}

// The design system's bundle.js is the reference; the extension's port must draw the same shapes.
function reference(): Reference {
  const window: { AroundStudio?: Reference } = {};
  const source = readFileSync(path.resolve('docs/around-studio-design-system/components/bundle.js'), 'utf8');
  runInNewContext(source, { window, document: {}, Math });
  return window.AroundStudio!;
}

test('G-pen outline, lines, arcs and the golden spiral match bundle.js point for point', () => {
  const ref = reference();
  const shapes: { points: Points; opts?: { width?: number; tip?: number; bias?: number } }[] = [
    { points: ref.line(-4, 0, 224, 0) },
    { points: ref.line(0, 140, 0, -4), opts: { width: 3.4 } },
    { points: ref.arc(68, 136, 152, Math.atan2(-136, 68), 0), opts: { width: 1.8 } },
    { points: ref.goldenSpiral(0, 0, [136, 84, 52, 32, 20, 12]), opts: { width: 3.4 } },
    {
      points: ref.arc(22, 22, 17, -Math.PI / 2 + 0.35, Math.PI * 1.5 - 0.35),
      opts: { width: 2.4, tip: 0.2, bias: 0.45 },
    },
    { points: [[5, 5]] },
  ];
  for (const { points, opts } of shapes) expect(penOutline(points, opts)).toBe(ref.penOutline(points, opts));
  expect(line(-4, 0, 224, 0)).toEqual(ref.line(-4, 0, 224, 0));
  expect(line(1, 2, 3, 4, 3)).toEqual(ref.line(1, 2, 3, 4, 3));
  expect(arc(68, 136, 152, -1.1, 0)).toEqual(ref.arc(68, 136, 152, -1.1, 0));
  expect(arc(22, 22, 17, 0, 6, 40)).toEqual(ref.arc(22, 22, 17, 0, 6, 40));
  expect(goldenSpiral(8, 8, [136, 84, 52, 32, 20, 12])).toEqual(ref.goldenSpiral(8, 8, [136, 84, 52, 32, 20, 12]));
  expect(centreline(ref.line(0, 0, 10, 10))).toBe(ref.centreline(ref.line(0, 0, 10, 10)));
});

test('the G-pen is thin at both tips and fullest a little before the middle', () => {
  const points = line(0, 0, 100, 0, 100);
  const outline = penOutline(points, { width: 2.4, tip: 0.2, bias: 0.45 });
  const ys = [...outline.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].slice(0, points.length).map((m) => Math.abs(Number(m[2])));
  expect(ys[0]).toBeCloseTo(0.1, 1);
  expect(ys.at(-1)).toBeCloseTo(0.1, 1);
  expect(Math.max(...ys)).toBeCloseTo(1.2, 1);
  // Rounded to 0.1, the fullest part is a plateau; it holds at 45% and thins toward both tips.
  expect(ys[45]).toBe(Math.max(...ys));
  expect(ys[10]).toBeLessThan(ys[45]!);
  expect(ys[90]).toBeLessThan(ys[45]!);
  expect(ys[90]).toBeLessThan(ys[70]!);
});
