import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign, parseSurfaceSkin } from '../src/design/schema';
import { commitDesign, editDesign, freezeTree, readDesign } from '../src/design/immutable';
import { compileDesign, createDesignRenderer, skinCompactNeeds } from '../src/design/renderer';
import { designAssetIds } from '../src/design/references';
import { SKIN_LIMITS, type DesignDocument, type DesignTarget, type SurfaceSkin } from '../src/design/types';
import { validateDocumentAssets } from '../src/assets/design-assets';
import { YOUTUBE_DESIGN_TARGETS } from '../src/sites/youtube-targets';
import type { AssetMetadata } from '../src/assets/validation';
import { INK } from '../src/design/contrast';

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
  expect(parsed.schemaVersion).toBe(15);
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

test('v12 documents cannot carry skins and migrate to v14 without any other change', () => {
  const rule = { kind: 'surface-style', target: 'video-card', style: {}, skin: skin() };
  expect(() => parseDesign(doc([rule], 12))).toThrow();
  for (const version of [1, 2, 6, 11]) {
    const data = JSON.parse(readFileSync(fixtures + `v${Math.min(version, 9)}.json`, 'utf8'));
    expect(() => parseDesign({ ...data, rules: [rule] })).toThrow();
  }
  const v12 = JSON.parse(readFileSync(fixtures + 'history-v12.json', 'utf8'));
  const migrated = parseDesign(v12);
  expect(migrated.schemaVersion).toBe(15);
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
  // Viewers get no preview rules; the editor compiles them while the skin tool is open.
  expect(compileDesign(design, [target], urls)).not.toContain('data-ww-skin-force=');
  const css = compileDesign(design, [target], urls, { previews: true });
  // Every rule keys on the part attribute (outside :where) so the browser can bucket it.
  const key = '[data-ww-surface~="subscribe-button"]';
  for (const line of css.split(String.fromCharCode(10))) {
    const selector = line.slice(0, line.indexOf('{'));
    const last = selector.slice(selector.lastIndexOf(' ' + key) + 1);
    expect(selector.lastIndexOf(' ' + key), selector).toBeGreaterThan(0);
    expect(
      last === key || last.startsWith(key + ':where(') || last === key + '[data-ww-skin-compact~="subscribe-button"]',
      last,
    ).toBe(true);
  }
  expect(css).toContain('border-image-source:url("blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-000000000001")');
  expect(css).toContain('border-image-slice:12 16 12 16 fill');
  expect(css).toContain('border-image-width:12px 16px 12px 16px');
  expect(css).toContain('border-image-repeat:stretch');
  expect(css).toContain('border-image-repeat:round');
  expect(css).toContain('border-image-outset:0');
  // UI1.1: the native background stays under the art. The only background a skin writes is the
  // colour the author chose for small parts; the only colour is the engine's legibility plan.
  for (const line of css.split(String.fromCharCode(10)))
    if (!line.includes('[data-ww-skin-compact~=') && !line.includes('data-ww-skin-force-compact'))
      expect(line, line).not.toMatch(/background|[{;]color:/);
  expect(css).not.toContain('transparent');
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
      ],
      property,
    ).toContain(property);
  expect(css).not.toMatch(
    /padding|margin|(?<!image-)width:|height|position|transform|inset:|border-style|border-width|outline|pointer-events|display|z-index/,
  );
  // Natural states follow the adapter's conditions in a fixed priority order; forced previews win.
  const order = [':where(*:hover)', ':where(*:active)'].map((condition) =>
    css.indexOf('[data-ww-surface~="subscribe-button"]' + condition),
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
  // The author's explicit colour comes from the existing style rule; the skin adds none.
  expect(css).toContain('background:#010203 !important');
  expect(css.split(String.fromCharCode(10)).filter((line) => line.includes('border-image-source'))).not.toEqual(
    expect.arrayContaining([expect.stringContaining('background')]),
  );
  expect(skinCompactNeeds(design)).toStrictEqual([{ target: 'subscribe-button', minWidth: 16, minHeight: 12 }]);
  expect(
    skinCompactNeeds(parseDesign(doc([{ kind: 'surface-style', target: 'video-card', style: {}, skin: skin() }]))),
  ).toStrictEqual([]);
});

test('a forced state whose new art is still loading shows the normal art instead of nothing', () => {
  const design = parseDesign(
    doc([
      {
        kind: 'surface-style',
        target: 'subscribe-button',
        style: {},
        skin: { states: { normal: frame(A), hover: frame(C) } },
      },
    ]),
  );
  // C has no URL yet: the natural hover rule is omitted (normal applies), and the forced hover
  // preview — which switches natural rules off — falls back to the normal art.
  const css = compileDesign(design, [target], urls, { previews: true });
  const forced = css.split(String.fromCharCode(10)).find((line) => line.includes('="subscribe-button:hover"]'));
  expect(forced).toContain('0b8f1d3e-0000-4000-8000-000000000001');
  expect(css).not.toContain(':where(*:hover){');
});

test('parts with an adapter outset draw outward by at most the measured gap, the rest inside', () => {
  const outward: DesignTarget = { ...target, skin: { ...target.skin!, outset: 4 } };
  const design = (scalePct: number) =>
    parseDesign(
      doc([
        {
          kind: 'surface-style',
          target: 'subscribe-button',
          style: {},
          skin: { states: { normal: frame(A, { scalePct }) } },
        },
      ]),
    );
  // Widths 12/16px are capped at 4px outside; the remaining 8/12px stay inside.
  expect(compileDesign(design(100), [outward], urls)).toContain('border-image-outset:4px 4px 4px 4px');
  // Thin frames (3/4px) lie wholly outside.
  expect(compileDesign(design(25), [outward], urls)).toContain('border-image-outset:3px 4px 3px 4px');
  // Without an adapter outset the frame stays inside.
  expect(compileDesign(design(100), [target], urls)).toContain('border-image-outset:0 !important');
  // The bundled card and comment entry draw outward; the other seven parts do not.
  expect(
    YOUTUBE_DESIGN_TARGETS.filter((item) => item.skin?.outset)
      .map((item) => [item.id, item.skin!.outset])
      .sort(),
  ).toEqual([
    ['comment-input', 8],
    ['video-card', 4],
  ]);
});

test('legibility colours are white or black only, per mode, part and state, and reach the adapter descendants', () => {
  const inked: DesignTarget = { ...target, skin: { ...target.skin!, ink: '& span, & input::placeholder' } };
  const design = parseDesign(doc([{ kind: 'surface-style', target: 'subscribe-button', style: {}, skin: skin() }]));
  const css = compileDesign(design, [inked], urls, {
    inks: { light: { 'subscribe-button': { normal: INK.black, hover: INK.white } } },
  });
  const ink = css.split(String.fromCharCode(10)).filter((line) => line.includes('color:'));
  expect(ink).toHaveLength(2);
  expect(ink[0]).toContain('html[data-ww-design][data-ww-site][data-ww-mode="light"]');
  expect(ink[0]).toContain('[data-ww-surface~="subscribe-button"] span,');
  expect(ink[0]).toContain('[data-ww-surface~="subscribe-button"] input::placeholder{color:#000000 !important;}');
  // Hover follows normal in source order, as the art does.
  expect(ink[1]).toContain(':where(*:hover)');
  expect(ink[1]).toContain('color:#ffffff');
  expect(css).not.toContain('data-ww-mode="dark"');
  // Only the two engine colours; nothing from artwork reaches `color`.
  expect(() =>
    compileDesign(design, [inked], urls, { inks: { light: { 'subscribe-button': { normal: '#123456' as never } } } }),
  ).toThrow();
  expect(() =>
    compileDesign(design, [{ ...target, skin: { ...target.skin!, ink: 'span{color:red}' } }], urls, {
      inks: { light: { 'subscribe-button': { normal: INK.black } } },
    }),
  ).toThrow();
  // Forced previews and the compact look carry the colour of their state.
  const previews = compileDesign(design, [inked], urls, {
    previews: true,
    inks: { dark: { 'subscribe-button': { normal: INK.white, compact: INK.black } } },
  });
  expect(previews).toContain(
    '[data-ww-mode="dark"]:not([data-ww-ink-off])[data-ww-skin-force="subscribe-button:pressed"]',
  );
  // Every colour rule steps aside while the engine reads native colours.
  for (const line of previews.split(String.fromCharCode(10)).filter((item) => item.includes('color:')))
    expect(line).toContain(':not([data-ww-ink-off])');
  expect(previews).toMatch(/\[data-ww-skin-compact~="subscribe-button"\] span,[^{]*\{color:#000000/);
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

test('the page renderer loads skin art once, writes CSS only after it is ready, and revokes replaced URLs', async () => {
  const attributes = new Map<string, string>();
  const style = { id: '', textContent: '', isConnected: false, remove() {} } as unknown as HTMLStyleElement;
  const page = {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      append() {},
    },
    head: {
      append() {
        (style as { isConnected: boolean }).isConnected = true;
      },
    },
    createElement: () => style,
    defaultView: undefined,
  } as unknown as Document;
  const loads: string[] = [],
    revoked: string[] = [];
  const pending = new Map<string, (url: string) => void>();
  const failures = new Map<string, (error: Error) => void>();
  let statusCalls = 0;
  const renderer = createDesignRenderer(
    page,
    [target],
    {
      load: (id) =>
        new Promise<string>((resolve, reject) => {
          loads.push(id);
          pending.set(id, resolve);
          failures.set(id, reject);
        }),
      revoke: (url) => revoked.push(url),
    },
    () => statusCalls++,
  );
  const design = (assetId: string) =>
    parseDesign(
      doc([
        { kind: 'surface-style', target: 'subscribe-button', style: {}, skin: { states: { normal: frame(assetId) } } },
      ]),
    );
  renderer.update(design(A));
  renderer.update(design(A));
  expect(loads).toEqual([A]);
  expect(renderer.assetStatus(A)).toStrictEqual({ state: 'loading' });
  expect(style.textContent).toBe('');
  pending.get(A)!('blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-00000000000a');
  await Promise.resolve();
  await Promise.resolve();
  expect(renderer.assetStatus(A)).toStrictEqual({ state: 'ready' });
  expect(style.textContent).toContain('0b8f1d3e-0000-4000-8000-00000000000a');
  expect(attributes.get('data-ww-design')).toBe('skins');
  // Replacing the art releases the old object URL; a failed load is a reason, not CSS.
  renderer.update(design(B));
  expect(revoked).toEqual(['blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-00000000000a']);
  failures.get(B)!(new Error('素材が見つかりません。'));
  await Promise.resolve();
  await Promise.resolve();
  expect(renderer.assetStatus(B)).toStrictEqual({ state: 'error', message: '素材が見つかりません。' });
  expect(statusCalls).toBeGreaterThan(0);
  renderer.dispose();
  expect(attributes.has('data-ww-design')).toBe(false);
});

test('compact sizing observes only parts the site just marked; page changes never query the whole document', async () => {
  let queries = 0;
  const observed: unknown[] = [];
  const part = (matches: boolean) =>
    ({
      isConnected: true,
      matches: () => matches,
      hasAttribute: () => false,
      getAttribute: () => null,
      setAttribute() {},
      removeAttribute() {},
    }) as unknown as Element;
  const style = { id: '', textContent: '', isConnected: true, remove() {} } as unknown as HTMLStyleElement;
  const page = {
    documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {}, append() {} },
    head: { append() {} },
    createElement: () => style,
    querySelectorAll: () => {
      queries++;
      return [];
    },
    defaultView: {
      ResizeObserver: class {
        observe(element: unknown) {
          observed.push(element);
        }
        unobserve() {}
        disconnect() {}
      },
    },
  } as unknown as Document;
  const renderer = createDesignRenderer(page, [target], {
    load: async () => 'blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-00000000000a',
    revoke() {},
  });
  renderer.update(
    parseDesign(
      doc([
        {
          kind: 'surface-style',
          target: 'subscribe-button',
          style: {},
          skin: { states: { normal: frame() }, compact: { kind: 'color', color: '#112233' } },
        },
      ]),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  // Finding the parts once when the design arrives is expected.
  const initial = queries;
  expect(initial).toBeGreaterThan(0);
  const button = part(true),
    other = part(false);
  for (let i = 0; i < 50; i++) renderer.refresh('structure', i === 10 ? [button, other] : []);
  renderer.refresh('content', []);
  expect(queries).toBe(initial);
  expect(observed).toEqual([button]);
  renderer.dispose();
});

test('the renderer plans legibility once from the art and the native colours, and reports it', async () => {
  const centre = (rgba: number[]) => {
    const data = new Uint8ClampedArray(48 * 48 * 4);
    for (let i = 0; i < 48 * 48; i++) data.set(rgba, i * 4);
    return { width: 96, height: 96, sampleWidth: 48, sampleHeight: 48, data };
  };
  let art = centre([245, 245, 245, 255]),
    reads = 0;
  const button = {
    parentElement: null,
    getBoundingClientRect: () => ({ width: 130, height: 36 }),
    matches: () => true,
  } as unknown as Element;
  const style = { id: '', textContent: '', isConnected: true, remove() {} } as unknown as HTMLStyleElement;
  const page = {
    documentElement: {
      getAttribute: (name: string) => (name === 'data-ww-mode' ? 'light' : null),
      setAttribute() {},
      removeAttribute() {},
    },
    head: { append() {} },
    createElement: () => style,
    querySelectorAll: () => [button],
    // The button's text inherits its colour: no descendant colours to add.
    createTreeWalker: () => ({ nextNode: () => null }),
    defaultView: {
      getComputedStyle: () => {
        reads++;
        // The subscribe button: white text on #0f0f0f.
        return { color: 'rgb(241, 241, 241)', backgroundColor: 'rgb(15, 15, 15)' };
      },
    },
  } as unknown as Document;
  const renderer = createDesignRenderer(page, [target], {
    load: async () => 'blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-00000000000a',
    revoke() {},
    pixels: async () => art,
  });
  const design = parseDesign(
    doc([{ kind: 'surface-style', target: 'subscribe-button', style: {}, skin: { states: { normal: frame() } } }]),
  );
  renderer.update(design);
  await expect.poll(() => style.textContent).toContain('color:#000000');
  expect(style.textContent).toContain('[data-ww-mode="light"]');
  expect(renderer.inkStatus('subscribe-button')!.normal).toMatchObject({ ink: INK.black, warn: false });
  // A page change does not replan: nothing is read again.
  const settled = reads;
  renderer.refresh('structure', []);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(reads).toBe(settled);
  // Transparent art shows the native black button: native white text stays, no colour rule.
  art = centre([0, 0, 0, 0]);
  renderer.update(
    parseDesign(
      doc([
        {
          kind: 'surface-style',
          target: 'subscribe-button',
          style: {},
          skin: { states: { normal: frame(B) } },
        },
      ]),
    ),
  );
  await expect.poll(() => style.textContent).not.toContain('color:');
  expect(renderer.inkStatus('subscribe-button')!.normal!.ink).toBeUndefined();
  renderer.dispose();
});

test('a stored result paints readable text before any native colour is read; a miss is judged at once and stored', async () => {
  const art = { width: 96, height: 96, sampleWidth: 48, sampleHeight: 48, data: new Uint8ClampedArray(48 * 48 * 4) };
  art.data.fill(245);
  let reads = 0;
  const button = {
    parentElement: null,
    getBoundingClientRect: () => ({ width: 130, height: 36 }),
    matches: () => true,
  } as unknown as Element;
  const style = { id: '', textContent: '', isConnected: true, remove() {} } as unknown as HTMLStyleElement;
  const page = {
    documentElement: {
      getAttribute: (name: string) => (name === 'data-ww-mode' ? 'light' : null),
      setAttribute() {},
      removeAttribute() {},
    },
    head: { append() {} },
    createElement: () => style,
    querySelectorAll: () => [button],
    createTreeWalker: () => ({ nextNode: () => null }),
    defaultView: {
      getComputedStyle: () => {
        reads++;
        return { color: 'rgb(241, 241, 241)', backgroundColor: 'rgb(15, 15, 15)' };
      },
    },
  } as unknown as Document;
  const design = parseDesign(
    doc([{ kind: 'surface-style', target: 'subscribe-button', style: {}, skin: { states: { normal: frame() } } }]),
  );
  const writes: unknown[] = [];
  const port = (stored: unknown) => ({
    load: async () => 'blob:https://www.youtube.com/0b8f1d3e-0000-4000-8000-00000000000a',
    revoke() {},
    pixels: async () => art,
    readInks: async () => stored,
    writeInks: (cache: unknown) => void writes.push(cache),
  });
  // Miss (and junk in storage): judged at once, then stored.
  const miss = createDesignRenderer(page, [target], port({ junk: 1 }));
  miss.update(design);
  await expect.poll(() => style.textContent).toContain('color:#000000');
  await expect.poll(() => writes.length).toBe(1);
  miss.dispose();
  // Hit: the stored colour is used while no native colour has been read yet.
  const key = Object.keys(writes[0] as object)[0]!;
  reads = 0;
  style.textContent = '';
  const hit = createDesignRenderer(page, [target], port(writes[0]));
  hit.update(design);
  await expect.poll(() => style.textContent).toContain('color:#000000');
  expect(reads).toBe(0);
  expect(key).toMatch(/^[0-9a-f]{8}$/);
  hit.dispose();
});
