import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseDesign } from '../src/design/schema';
import { compileDesign, createDesignRenderer } from '../src/design/renderer';
import { validateDocumentAssets } from '../src/assets/design-assets';
import { YOUTUBE_DESIGN_TARGETS } from '../src/sites/youtube-targets';
import type { AssetMetadata } from '../src/assets/validation';
import { hasFrameColour } from './helpers/skin-pixels';

const asset = (index = 1) => `asset-${index.toString(16).padStart(64, '0')}`;
const frame = (index = 1) => ({
  assetId: asset(index),
  slices: { top: 24, right: 24, bottom: 24, left: 24 },
  scalePct: 25,
  center: 'stretch',
});
const rule = (target = 'search-box') => ({
  kind: 'surface-style',
  target,
  style: {},
  skin: { states: { normal: frame() } },
});
const documentWith = (rules: unknown[]) => ({
  schemaVersion: 13,
  id: 'independent-skin-data',
  siteId: 'youtube',
  baseThemeId: null,
  rules,
  decorations: [],
});
const meta = (width = 96, height = 96): AssetMetadata => ({
  id: asset(),
  name: 'frame.png',
  mime: 'image/png',
  byteLength: 100,
  width,
  height,
});

test('the paint oracle accepts native white compositing and rejects missing or differently coloured edges', () => {
  const source = [0, 112, 192];
  for (const alpha of [0, 0.05, 0.15, 0.3, 0.5]) {
    const painted = source.map((value) => Math.round(value + (255 - value) * alpha));
    expect(hasFrameColour(painted, source)).toBe(true);
  }
  for (const wrong of [
    [255, 255, 255],
    [15, 15, 15],
    [128, 64, 192],
    [0, 97, 103],
    [224, 48, 48],
  ])
    expect(hasFrameColour(wrong, source)).toBe(false);
});

test('all twelve historical schema versions reject the new skin field before migrating', () => {
  const names = [
    'v1',
    'v2',
    'v3',
    'v4',
    'v5',
    'v6',
    'history-v7',
    'history-v8',
    'history-v9',
    'history-v10',
    'history-v11',
    'history-v12',
  ];
  for (const name of names) {
    const input = JSON.parse(readFileSync(`tests/fixtures/designs/${name}.json`, 'utf8'));
    input.rules = [rule()];
    expect(() => parseDesign(input), `${name} must reject skin`).toThrow();
  }
});

test('16 rules and 32 distinct skin assets are accepted, the next one is rejected', () => {
  const rules = Array.from({ length: 16 }, (_, i) => rule(`part-${i}`));
  expect(parseDesign(documentWith(rules)).rules).toHaveLength(16);
  expect(() => parseDesign(documentWith([...rules, rule('part-16')]))).toThrow();
  const withAssets = (count: number) =>
    Array.from({ length: 6 }, (_, i) => ({
      ...rule(`part-${i}`),
      skin: {
        states: Object.fromEntries(
          ['normal', 'hover', 'focus', 'selected', 'pressed', 'disabled'].map((state, j) => [
            state,
            frame((i * 6 + j) % count),
          ]),
        ),
      },
    }));
  expect(() => parseDesign(documentWith(withAssets(32)))).not.toThrow();
  expect(() => parseDesign(documentWith(withAssets(33)))).toThrow();
});

test('image dimensions and slice sums accept the exact limit and reject one beyond it', () => {
  const design = parseDesign(documentWith([rule()]));
  for (const [w, h] of [
    [1024, 1024],
    [48, 48],
  ])
    expect(() => validateDocumentAssets(design, new Map([[asset(), meta(w, h)]]))).not.toThrow();
  for (const [w, h] of [
    [1025, 1024],
    [1024, 1025],
    [47, 48],
    [48, 47],
  ])
    expect(() => validateDocumentAssets(design, new Map([[asset(), meta(w, h)]]))).toThrow();
  const boundary = {
    ...rule(),
    skin: { states: { normal: { ...frame(), slices: { top: 512, right: 512, bottom: 512, left: 512 } } } },
  };
  expect(() =>
    validateDocumentAssets(parseDesign(documentWith([boundary])), new Map([[asset(), meta(1024, 1024)]])),
  ).not.toThrow();
  expect(() =>
    parseDesign(
      documentWith([
        {
          ...boundary,
          skin: { states: { normal: { ...frame(), slices: { top: 513, right: 0, bottom: 0, left: 0 } } } },
        },
      ]),
    ),
  ).toThrow();
});

for (const payload of [
  '#ffffff;position:fixed',
  'url(https://evil.example/a)',
  'data:image/png;base64,AA',
  'javascript:alert(1)',
  'http://evil.example/a',
  'blob:https://www.youtube.com/11111111-1111-4111-8111-111111111111',
  '\";}*{pointer-events:none}/*',
]) {
  test(`artist strings cannot escape into CSS: ${payload}`, () => {
    const candidates: unknown[] = [
      { ...rule(), style: { backgroundColor: payload } },
      { ...rule(), target: payload },
      { ...rule(), skin: { states: { [payload]: frame(), normal: frame() } } },
      { ...rule(), skin: { states: { normal: { ...frame(), assetId: payload } } } },
      {
        ...rule(),
        skin: { states: { normal: { ...frame(), slices: { top: payload, right: 24, bottom: 24, left: 24 } } } },
      },
      { ...rule(), skin: { states: { normal: frame() }, compact: { kind: 'color', color: payload } } },
    ];
    for (const value of candidates)
      expect(() => compileDesign(parseDesign(documentWith([value])), YOUTUBE_DESIGN_TARGETS)).toThrow();
  });
}

test('every forbidden geometry or interaction property is rejected at every skin entrance', () => {
  for (const property of [
    'width',
    'height',
    'padding',
    'margin',
    'position',
    'display',
    'pointer-events',
    'transform',
    'z-index',
    'outline',
  ]) {
    for (const value of [
      { ...rule(), [property]: 'none' },
      { ...rule(), style: { [property]: 'none' } },
      { ...rule(), skin: { states: { normal: frame() }, [property]: 'none' } },
      { ...rule(), skin: { states: { normal: { ...frame(), [property]: 'none' } } } },
    ])
      expect(() => parseDesign(documentWith([value])), property).toThrow();
  }
});

test('all nine parts emit only the five border-image properties, and every non-object URL is rejected', () => {
  const design = parseDesign(documentWith(YOUTUBE_DESIGN_TARGETS.map((target) => rule(target.id))));
  // UI1.1: the native background stays; `color` appears only with an engine legibility plan.
  const allowed = [
    'border-image-source',
    'border-image-slice',
    'border-image-width',
    'border-image-outset',
    'border-image-repeat',
  ].sort();
  const good = 'blob:https://www.youtube.com/11111111-1111-4111-8111-111111111111';
  const css = compileDesign(design, YOUTUBE_DESIGN_TARGETS, () => good);
  expect([...new Set([...css.matchAll(/[{;]([a-z-]+):/g)].map((match) => match[1]))].sort()).toEqual(allowed);
  for (const url of [
    'data:image/png;base64,AA',
    'http://evil.example/a',
    'https://evil.example/a',
    'javascript:alert(1)',
    'url(' + good + ')',
    good + 'url(',
    good + '\");outline:0',
  ]) {
    // Nine rejected rules still contribute their eight separators, and no CSS declarations.
    expect(
      compileDesign(design, YOUTUBE_DESIGN_TARGETS, () => url),
      url,
    ).toBe('\n\n\n\n\n\n\n\n');
  }
});

test('navigation removes compact marks from detached native parts before forgetting them', async () => {
  const attributes = new Map<string, string>();
  const old = {
    isConnected: true,
    matches: () => true,
    hasAttribute: (name: string) => attributes.has(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  let notify: ResizeObserverCallback | undefined;
  const style = { id: '', textContent: '', isConnected: true, remove() {} };
  const root = new Map<string, string>();
  const page = {
    documentElement: {
      getAttribute: (name: string) => root.get(name) ?? null,
      setAttribute: (name: string, value: string) => root.set(name, value),
      removeAttribute: (name: string) => root.delete(name),
    },
    createElement: () => style,
    head: { append() {} },
    querySelectorAll: () => [old],
    defaultView: {
      ResizeObserver: class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    },
  } as unknown as Document;
  const renderer = createDesignRenderer(page, YOUTUBE_DESIGN_TARGETS, {
    load: async () => 'blob:https://www.youtube.com/11111111-1111-4111-8111-111111111111',
    revoke() {},
  });
  const input = {
    ...rule('subscribe-button'),
    skin: { states: { normal: frame() }, compact: { kind: 'color', color: '#123456' } },
  };
  renderer.update(parseDesign(documentWith([input])));
  await Promise.resolve();
  await Promise.resolve();
  notify!(
    [{ target: old, borderBoxSize: [{ inlineSize: 1, blockSize: 1 }] } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  expect(old.getAttribute('data-around-skin-compact')).toBe('subscribe-button');
  old.isConnected = false;
  renderer.refresh('navigation', []);
  expect(old.getAttribute('data-around-skin-compact')).toBeNull();
  renderer.dispose();
});
