import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign, parseSurfaceSkin } from '../src/design/schema';
import { commitDesign, editDesign, freezeTree, readDesign } from '../src/design/immutable';
import { compileDesign, skinCompactNeeds } from '../src/design/renderer';
import { designAssetIds } from '../src/design/references';
import { SKIN_LIMITS, type DesignDocument, type DesignTarget, type SurfaceSkin } from '../src/design/types';
import { validateDocumentAssets } from '../src/assets/design-assets';
import { YOUTUBE_DESIGN_TARGETS } from '../src/sites/youtube-targets';
import type { AssetMetadata } from '../src/assets/validation';

const fixtures = 'tests/fixtures/designs/';
const A = `asset-${'a'.repeat(64)}`,
  B = `asset-${'b'.repeat(64)}`,
  C = `asset-${'c'.repeat(64)}`;
const frame = (assetId = A, extra: object = {}) => ({
  assetId,
  slices: { top: 12, right: 16, bottom: 12, left: 16 },
  center: 'stretch',
  scalePct: 100,
  ...extra,
});
const skin = (extra: object = {}): SurfaceSkin =>
  ({ states: { normal: frame(), hover: frame(B), pressed: frame(B, { center: 'repeat' }) }, ...extra }) as SurfaceSkin;
const doc = (rules: object[], version = 13) => ({
  schemaVersion: version,
  id: 'skins',
  siteId: 'youtube',
  baseThemeId: null,
  rules,
  decorations: [],
});
const target: DesignTarget = {
  id: 'subscribe-button',
  surface: 'subscribe-button',
  label: 'チャンネル登録ボタン',
  skin: {
    states: {
      hover: '&:hover',
      pressed: '&:active',
      focus: '&:focus-visible',
      selected: 'ytd-subscribe-button-renderer[subscribed] &',
      disabled: '&:is([disabled],[aria-disabled="true"])',
    },
  },
};
const urls = (id: string) =>
  ({ [A]: 'blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-000000000001' })[id] ??
  (id === B ? 'blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-000000000002' : undefined);

test('v13 skin rules roundtrip canonically, freeze, and keep the existing style next to them', () => {
  const parsed = parseDesign(
    doc([{ kind: 'surface-style', target: 'subscribe-button', style: { backgroundColor: '#ABCDEF' }, skin: skin() }]),
  );
  expect(parsed.schemaVersion).toBe(13);
  expect(parsed.rules[0]).toStrictEqual({
    kind: 'surface-style',
    target: 'subscribe-button',
    style: { backgroundColor: '#abcdef' },
    skin: { states: { normal: frame(), hover: frame(B), pressed: frame(B, { center: 'repeat' }) } },
  });
  expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toStrictEqual(parsed);
  const compact = parseSurfaceSkin(skin({ compact: { kind: 'color', color: '#FF00AA' } }));
  expect(compact.compact).toStrictEqual({ kind: 'color', color: '#ff00aa' });
  expect(parseSurfaceSkin(skin({ compact: { kind: 'frame', frame: frame(C) } })).compact).toStrictEqual({
    kind: 'frame',
    frame: frame(C),
  });
  // A skin-only rule is valid; the style may be empty.
  expect(
    parseDesign(doc([{ kind: 'surface-style', target: 'video-card', style: {}, skin: skin() }])).rules,
  ).toHaveLength(1);
  const committed = readDesign(parsed);
  expect(Object.isFrozen(committed.rules[0]!.skin!.states.normal.slices)).toBe(true);
  expect(commitDesign(editDesign(committed), committed)).toBe(committed);
});

test('skin data rejects executable or out-of-range values at the entrance', () => {
  const bad: unknown[] = [
    skin({ extra: 1 }),
    { states: {} },
    { states: { hover: frame() } },
    { states: { normal: frame(), active: frame() } },
    { states: { normal: frame('javascript:alert(1)') } },
    { states: { normal: frame(A, { center: 'stretch;}body{display:none' }) } },
    { states: { normal: frame(A, { center: 'round' }) } },
    { states: { normal: frame(A, { scalePct: SKIN_LIMITS.scaleMin - 1 }) } },
    { states: { normal: frame(A, { scalePct: SKIN_LIMITS.scaleMax + 1 }) } },
    { states: { normal: frame(A, { scalePct: 50.5 }) } },
    { states: { normal: frame(A, { slices: { top: 1, right: 1, bottom: 1 } }) } },
    { states: { normal: frame(A, { slices: { top: 1, right: 1, bottom: 1, left: -1 } }) } },
    { states: { normal: frame(A, { slices: { top: 1.5, right: 1, bottom: 1, left: 1 } }) } },
    { states: { normal: frame(A, { slices: { top: SKIN_LIMITS.slice + 1, right: 1, bottom: 1, left: 1 } }) } },
    { states: { normal: frame(A, { slices: { top: 1, right: 1, bottom: 1, left: 1, url: 'x' } }) } },
    { states: { normal: frame(A, { css: 'border:0' }) } },
    { states: { normal: frame(A) }, compact: { kind: 'color', color: 'red' } },
    { states: { normal: frame(A) }, compact: { kind: 'color', color: '#ffffff', frame: frame() } },
    { states: { normal: frame(A) }, compact: { kind: 'css', value: 'x' } },
    { states: { normal: frame(A) }, compact: { kind: 'frame', frame: { ...frame(), assetId: 'asset-1' } } },
    { states: { normal: frame(A) }, compact: { kind: 'frame' } },
    { states: { normal: frame(A) }, compact: { kind: 'frame', frame: frame(), minWidthPx: 1 } },
    { states: { normal: frame(A), hover: null } },
    { states: { normal: frame(A) }, selector: '.x' },
  ];
  for (const value of bad) expect(() => parseSurfaceSkin(value), JSON.stringify(value)).toThrow();
  // The rule limit still holds, and skins may not exceed their own asset budget.
  const many = Array.from({ length: 17 }, (_, i) => ({
    kind: 'surface-style',
    target: `target-${i}`,
    style: {},
    skin: { states: { normal: frame() } },
  }));
  expect(() => parseDesign(doc(many))).toThrow();
  const assets = Array.from({ length: SKIN_LIMITS.assets + 1 }, (_, i) => `asset-${i.toString(16).padStart(64, '0')}`);
  const wide = Array.from({ length: 6 }, (_, i) => ({
    kind: 'surface-style',
    target: `target-${i}`,
    style: {},
    skin: {
      states: Object.fromEntries(
        ['normal', 'hover', 'pressed', 'selected', 'disabled', 'focus'].map((state, j) => [
          state,
          frame(assets[(i * 6 + j) % assets.length]),
        ]),
      ),
    },
  }));
  expect(() => parseDesign(doc(wide))).toThrow('着せ替え');
  // commitDesign validates changed rules through the same parser.
  const committed = readDesign(doc([]));
  const edited = editDesign(committed);
  edited.rules.push({
    kind: 'surface-style',
    target: 'video-card',
    style: {},
    skin: { states: { normal: { ...frame(), center: 'x' } } } as never,
  });
  expect(() => commitDesign(edited, committed)).toThrow();
});

test('v12 documents cannot carry skins and migrate to v13 without any other change', () => {
  const rule = { kind: 'surface-style', target: 'video-card', style: {}, skin: skin() };
  expect(() => parseDesign(doc([rule], 12))).toThrow();
  for (const version of [1, 2, 6, 11]) {
    const data = JSON.parse(readFileSync(fixtures + `v${Math.min(version, 9)}.json`, 'utf8'));
    expect(() => parseDesign({ ...data, rules: [rule] })).toThrow();
  }
  const v12 = JSON.parse(readFileSync(fixtures + 'history-v12.json', 'utf8'));
  const migrated = parseDesign(v12);
  expect(migrated.schemaVersion).toBe(13);
  expect({ ...migrated, schemaVersion: 12 }).toStrictEqual(
    JSON.parse(JSON.stringify({ ...migrated, schemaVersion: 12 })),
  );
});

test('every historical fixture compiles to exactly the CSS the v12 renderer produced', () => {
  const expected = JSON.parse(readFileSync(fixtures + 'css-expected.json', 'utf8')) as {
    targets: DesignTarget[];
    css: Record<string, string>;
  };
  for (const [file, css] of Object.entries(expected.css)) {
    const design = parseDesign(JSON.parse(readFileSync(fixtures + file, 'utf8')));
    expect(compileDesign(design, expected.targets), file).toBe(css);
    // The bundled YouTube targets keep the historical card output too.
    expect(compileDesign(design, YOUTUBE_DESIGN_TARGETS), file).toBe(css);
  }
});

test('skin CSS uses only border-image and background painting, ordered states, and engine-built URLs', () => {
  const design = parseDesign(
    doc([
      {
        kind: 'surface-style',
        target: 'subscribe-button',
        style: {},
        skin: skin({ compact: { kind: 'color', color: '#112233' } }),
      },
    ]),
  );
  const css = compileDesign(design, [target], urls);
  expect(css).toContain('border-image-source:url("blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-000000000001")');
  expect(css).toContain('border-image-slice:12 16 12 16 fill');
  expect(css).toContain('border-image-width:12px 16px 12px 16px');
  expect(css).toContain('border-image-repeat:stretch');
  expect(css).toContain('border-image-repeat:round');
  expect(css).toContain('border-image-outset:0');
  expect(css).toContain('background-color:transparent');
  // Geometry and hit-testing properties are never written.
  const properties = new Set([...css.matchAll(/[{;]([a-z-]+):/g)].map((match) => match[1]!));
  expect(properties.size).toBeGreaterThan(0);
  for (const property of properties)
    expect(
      [
        'border-image-source',
        'border-image-slice',
        'border-image-width',
        'border-image-repeat',
        'border-image-outset',
        'background-color',
        'background-image',
      ],
      property,
    ).toContain(property);
  expect(css).not.toMatch(
    /padding|margin|(?<!image-)width:|height|position|transform|inset:|border-style|border-width|outline|pointer-events|display|z-index/,
  );
  // Natural states follow the adapter's conditions in a fixed priority order; forced previews win.
  const order = ['&:hover', '&:active'].map((condition) =>
    css.indexOf(condition.replace('&', '[data-ww-surface~="subscribe-button"]')),
  );
  expect(order.every((index) => index > 0)).toBe(true);
  expect(order[0]!).toBeLessThan(order[1]!);
  expect(css).toContain('[data-ww-skin-force="subscribe-button:pressed"]');
  expect(css).toContain(':not([data-ww-skin-force^="subscribe-button:"])');
  expect(css).toContain('[data-ww-skin-compact~="subscribe-button"]');
  expect(css).toContain('background-color:#112233');
  // Unresolved or unsafe URLs leave the native look instead of writing CSS.
  expect(compileDesign(design, [target], () => undefined)).not.toContain('border-image');
  expect(compileDesign(design, [target], () => 'blob:https://evil.example/");}*{x:y')).not.toContain('border-image');
  expect(compileDesign(design, [target], () => 'https://www.youtube.com/a.png')).not.toContain('border-image');
  // Without a resolver (validation), skins compile to nothing and never throw.
  expect(() => compileDesign(design, [target])).not.toThrow();
  // A target without adapter skin support rejects skin data.
  expect(() =>
    compileDesign(design, [{ id: target.id, surface: target.surface, label: target.label }], urls),
  ).toThrow();
  // Adapter conditions must come from bundled definitions with exactly one placeholder.
  expect(() => compileDesign(design, [{ ...target, skin: { states: { hover: ':hover' } } }], urls)).toThrow();
});

test('scale changes only the drawn edge width and compact needs come from the normal frame', () => {
  const design = parseDesign(
    doc([
      {
        kind: 'surface-style',
        target: 'subscribe-button',
        style: { backgroundColor: '#010203' },
        skin: { states: { normal: frame(A, { scalePct: 50 }) }, compact: { kind: 'frame', frame: frame(B) } },
      },
    ]),
  );
  const css = compileDesign(design, [target], urls);
  expect(css).toContain('border-image-width:6px 8px 6px 8px');
  // The explicit background colour replaces the transparent default under the art.
  expect(css).toContain('background-color:#010203');
  expect(skinCompactNeeds(design)).toStrictEqual([{ target: 'subscribe-button', minWidth: 16, minHeight: 12 }]);
  expect(
    skinCompactNeeds(parseDesign(doc([{ kind: 'surface-style', target: 'video-card', style: {}, skin: skin() }]))),
  ).toStrictEqual([]);
});

test('asset references include skins, and saved skins must reference small static images that fit the slices', () => {
  const design = parseDesign(
    doc([
      {
        kind: 'surface-style',
        target: 'subscribe-button',
        style: {},
        skin: skin({ compact: { kind: 'frame', frame: frame(C) } }),
      },
    ]),
  );
  expect(designAssetIds(design).sort()).toStrictEqual([A, B, C].sort());
  const image = (id: string, extra: Partial<AssetMetadata> = {}): AssetMetadata => ({
    id,
    name: id,
    byteLength: 10,
    mime: 'image/png',
    width: 64,
    height: 48,
    ...extra,
  });
  const all = new Map([A, B, C].map((id) => [id, image(id)]));
  expect(() => validateDocumentAssets(design, all)).not.toThrow();
  expect(() => validateDocumentAssets(design, new Map([[A, image(A)]]))).toThrow();
  expect(() =>
    validateDocumentAssets(design, new Map([...all, [B, image(B, { animation: { format: 'gif' } as never })]])),
  ).toThrow();
  expect(() => validateDocumentAssets(design, new Map([...all, [B, image(B, { width: 31 })]]))).toThrow('切り位置');
  expect(() => validateDocumentAssets(design, new Map([...all, [C, image(C, { height: 23 })]]))).toThrow('切り位置');
  expect(() =>
    validateDocumentAssets(design, new Map([...all, [A, image(A, { width: SKIN_LIMITS.edge + 1 })]])),
  ).toThrow();
});

test('bundled YouTube targets have fixed semantic ids and adapter-owned state conditions', () => {
  const ids = YOUTUBE_DESIGN_TARGETS.map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of [
    'video-card',
    'subscribe-button',
    'like-button',
    'dislike-button',
    'action-button',
    'search-box',
    'filter-chip',
    'description-panel',
    'comment-input',
  ])
    expect(ids).toContain(id);
  for (const item of YOUTUBE_DESIGN_TARGETS) {
    expect(item.id).toMatch(/^[a-z][a-z-]+$/);
    expect(item.id).not.toMatch(/\d/);
    expect(item.skin, item.id).toBeDefined();
    for (const condition of Object.values(item.skin!.states))
      expect(condition!.split('&').length, `${item.id} ${condition}`).toBe(2);
  }
  // All bundled targets compile together with every state set.
  const all: DesignDocument = parseDesign(
    doc(
      YOUTUBE_DESIGN_TARGETS.map((item) => ({
        kind: 'surface-style',
        target: item.id,
        style: {},
        skin: {
          states: Object.fromEntries(
            ['normal', 'hover', 'pressed', 'selected', 'disabled', 'focus'].map((state) => [state, frame()]),
          ),
        },
      })),
    ),
  );
  const css = compileDesign(all, YOUTUBE_DESIGN_TARGETS, urls);
  expect(css.split('\n').length).toBeGreaterThan(YOUTUBE_DESIGN_TARGETS.length);
  expect(freezeTree(all)).toBe(all);
});
