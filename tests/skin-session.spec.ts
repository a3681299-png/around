import { test, expect } from '@playwright/test';
import { createEditorSession } from '../src/editor-core/session';
import { parseEditCommand } from '../src/editor-core/commands';
import { shortcutCommand } from '../src/editor-core/shortcuts';
import { parseDesign } from '../src/design/schema';
import { defaultSkinFrame } from '../src/editor-core/skins';
import type { DesignDocument, SurfaceSkin } from '../src/design/types';
import type { EditorAsset, EditorPorts } from '../src/editor-core/types';
import { YOUTUBE_DESIGN_TARGETS } from '../src/sites/youtube-targets';
import { skinReason, skinStateName, skinStates } from '../src/editor/skin-status';

function harness() {
  let value: DesignDocument | undefined,
    serial = 0;
  const leases = new Map<string, readonly string[]>();
  const listeners = new Set<(value: DesignDocument | undefined) => void>();
  const ports: EditorPorts<readonly EditorAsset[]> = {
    siteId: 'youtube',
    baseThemeId: 'retro',
    targets: [...YOUTUBE_DESIGN_TARGETS, { id: 'plain', surface: 'plain', label: '着せ替えなし' }],
    makeId: (kind) => `${kind}-${++serial}`,
    validate: (doc) => {
      if (doc) parseDesign(doc);
    },
    geometry: {
      frameFor: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      samples: () => [],
      importFrame: (point) => ({ width: 1000, height: 800, origin: point ?? { x: 450, y: 360 } }),
    },
    storage: {
      read: async () => value,
      watch(accept) {
        listeners.add(accept);
        void Promise.resolve().then(() => listeners.has(accept) && accept(value));
        return () => {
          listeners.delete(accept);
        };
      },
      retain: async (session, ids) => {
        leases.set(session, [...ids]);
      },
      release: async (session) => {
        leases.delete(session);
      },
      validate: async () => undefined,
      import: async (source) => source,
      cancelImport() {},
      save: async (doc) => {
        value = parseDesign(doc);
        listeners.forEach((accept) => accept(value));
      },
    },
  };
  return { editor: createEditorSession(ports), leases };
}
const image = (n: number, extra: Partial<EditorAsset> = {}): EditorAsset => ({
  id: `asset-${String(n).repeat(64)}`,
  name: `Frame ${n}`,
  width: 96,
  height: 48,
  ...extra,
});
async function opened() {
  const h = harness();
  await Promise.resolve();
  h.editor.setEnabled(true);
  expect(h.editor.open().ok).toBe(true);
  await h.editor.execute({ type: 'tool', tool: 'skin' });
  return h;
}
const skinOf = (doc: DesignDocument, target: string) => doc.rules.find((rule) => rule.target === target)?.skin;

test('default slices take a third of each side, capped for small native parts', () => {
  expect(defaultSkinFrame(image(1))).toStrictEqual({
    assetId: image(1).id,
    slices: { top: 16, right: 32, bottom: 16, left: 32 },
    center: 'stretch',
    scalePct: 100,
  });
  expect(defaultSkinFrame(image(1, { width: 1024, height: 2 })).slices).toStrictEqual({
    top: 0,
    right: 64,
    bottom: 0,
    left: 64,
  });
});

test('the skin tool, its shortcut and its commands are validated at the entrance', () => {
  expect(parseEditCommand({ type: 'tool', tool: 'skin' })).toEqual({ type: 'tool', tool: 'skin' });
  const key = (k: string) =>
    shortcutCommand(
      {
        key: k,
        code: `Key${k.toUpperCase()}`,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      } as never,
      { selectedIds: [], tool: 'select' } as never,
      true,
    );
  expect(key('u')).toEqual({ type: 'tool', tool: 'skin' });
  expect(parseEditCommand({ type: 'skin', skin: null })).toEqual({ type: 'skin', skin: null });
  expect(() => parseEditCommand({ type: 'skin', skin: { states: { normal: { assetId: 'x' } } } })).toThrow();
  expect(() => parseEditCommand({ type: 'skin', skin: { states: {} }, css: 'x' })).toThrow();
  expect(parseEditCommand({ type: 'skin-preview', state: 'pressed' })).toEqual({
    type: 'skin-preview',
    state: 'pressed',
  });
  expect(parseEditCommand({ type: 'skin-preview', compact: true })).toEqual({ type: 'skin-preview', compact: true });
  for (const bad of [{ state: 'active' }, { state: '&:hover' }, { compact: 'yes' }, { selector: '*' }])
    expect(() => parseEditCommand({ type: 'skin-preview', ...bad })).toThrow();
});

test('importing into a state creates the skin as one undo step and keeps its asset leased', async () => {
  const { editor, leases } = await opened();
  try {
    await editor.execute({ type: 'select-target', target: 'subscribe-button' });
    await editor.importSkin([image(1)], 'normal');
    let state = editor.snapshot();
    expect(skinOf(state.document, 'subscribe-button')).toStrictEqual({
      states: { normal: defaultSkinFrame(image(1)) },
    });
    expect(state.view.skin).toStrictEqual(skinOf(state.document, 'subscribe-button'));
    expect(state.view.target).toBe('subscribe-button');
    expect(state.document.decorations).toHaveLength(0);
    expect(state.view.dirty).toBe(true);
    await expect.poll(() => [...leases.values()].flat()).toContain(image(1).id);
    // A second state may use another asset; the compact slot uses the frame form.
    await editor.importSkin([image(2)], 'pressed');
    await editor.importSkin([image(3)], 'compact');
    state = editor.snapshot();
    expect(Object.keys(skinOf(state.document, 'subscribe-button')!.states)).toEqual(['normal', 'pressed']);
    expect(skinOf(state.document, 'subscribe-button')!.compact).toStrictEqual({
      kind: 'frame',
      frame: defaultSkinFrame(image(3)),
    });
    await editor.execute({ type: 'undo' });
    await editor.execute({ type: 'undo' });
    expect(Object.keys(skinOf(editor.snapshot().document, 'subscribe-button')!.states)).toEqual(['normal']);
    await editor.execute({ type: 'undo' });
    expect(skinOf(editor.snapshot().document, 'subscribe-button')).toBeUndefined();
    expect(editor.snapshot().view.dirty).toBe(false);
    await editor.execute({ type: 'redo' });
    expect(skinOf(editor.snapshot().document, 'subscribe-button')!.states.normal.assetId).toBe(image(1).id);
  } finally {
    editor.destroy();
  }
});

test('slice drags between begin and end are one undo step; removing the skin keeps the style', async () => {
  const { editor } = await opened();
  try {
    await editor.execute({ type: 'select-target', target: 'video-card' });
    await editor.execute({ type: 'style', style: { backgroundColor: '#112233' } });
    await editor.importSkin([image(1)], 'normal');
    const start = editor.snapshot().view.skin!;
    await editor.execute({ type: 'begin' });
    for (const left of [10, 12, 14]) {
      const skin: SurfaceSkin = {
        states: { normal: { ...start.states.normal, slices: { ...start.states.normal.slices, left } } },
      };
      await editor.execute({ type: 'skin', skin });
    }
    await editor.execute({ type: 'end' });
    expect(editor.snapshot().view.skin!.states.normal.slices.left).toBe(14);
    await editor.execute({ type: 'undo' });
    expect(editor.snapshot().view.skin!.states.normal.slices.left).toBe(start.states.normal.slices.left);
    await editor.execute({ type: 'skin', skin: null });
    const rule = editor.snapshot().document.rules.find((item) => item.target === 'video-card');
    expect(rule).toStrictEqual({ kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#112233' } });
    // The style editor keeps an existing skin when it rewrites colours.
    await editor.execute({ type: 'undo' });
    await editor.execute({ type: 'style', style: { backgroundColor: '#445566' } });
    expect(editor.snapshot().view.skin).toBeDefined();
  } finally {
    editor.destroy();
  }
});

test('previews are view state only, follow the target, and never enter history or the document', async () => {
  const { editor } = await opened();
  try {
    await editor.execute({ type: 'select-target', target: 'like-button' });
    await editor.importSkin([image(1)], 'normal');
    const before = editor.snapshot();
    await editor.execute({ type: 'skin-preview', state: 'pressed' });
    let state = editor.snapshot();
    expect(state.view.skinPreview).toStrictEqual({ state: 'pressed' });
    expect(state.document).toBe(before.document);
    expect(state.view.canUndo).toBe(before.view.canUndo);
    await editor.execute({ type: 'skin-preview', compact: true });
    expect(editor.snapshot().view.skinPreview).toStrictEqual({ compact: true });
    await editor.execute({ type: 'select-target', target: 'search-box' });
    expect(editor.snapshot().view.skinPreview).toStrictEqual({});
    await editor.execute({ type: 'skin-preview', state: 'hover' });
    await editor.execute({ type: 'tool', tool: 'select' });
    state = editor.snapshot();
    expect(state.view.skinPreview).toStrictEqual({});
  } finally {
    editor.destroy();
  }
});

test('unsupported parts and non-image assets are refused with a reason and leave the draft unchanged', async () => {
  const { editor } = await opened();
  try {
    await editor.importSkin([image(1)], 'normal');
    expect(editor.snapshot().view.error).toBe(true);
    expect(editor.snapshot().view.status).toMatch(/部品を選/);
    await editor.execute({ type: 'select-target', target: 'plain' });
    await editor.importSkin([image(1)], 'normal');
    expect(editor.snapshot().view.status).toMatch(/着せ替えに対応していません/);
    await editor.execute({ type: 'select-target', target: 'subscribe-button' });
    const before = editor.snapshot().document;
    await editor.importSkin([image(2, { animation: { format: 'gif' } })], 'normal');
    expect(editor.snapshot().view.status).toMatch(/静止画像/);
    expect(editor.snapshot().document).toBe(before);
    await editor.importSkin([image(3, { width: 2048 })], 'normal');
    expect(editor.snapshot().view.status).toMatch(/1024/);
    await editor.importSkin([image(1), image(2)], 'normal');
    expect(editor.snapshot().view.status).toMatch(/1枚/);
    // A state other than normal needs the normal art first.
    await editor.importSkin([image(4)], 'hover');
    expect(editor.snapshot().view.status).toMatch(/通常/);
    expect(editor.snapshot().document).toBe(before);
    await expect(
      editor.execute({ type: 'skin', skin: { states: { normal: defaultSkinFrame(image(1)) } } }),
    ).resolves.toBe(undefined);
    await editor.execute({ type: 'select-target', target: 'plain' });
    await expect(
      editor.execute({ type: 'skin', skin: { states: { normal: defaultSkinFrame(image(1)) } } }),
    ).rejects.toThrow(/着せ替えに対応していません/);
  } finally {
    editor.destroy();
  }
});

test('part status words: missing parts say where they live, loading and errors are reasons, not silence', () => {
  const card = YOUTUBE_DESIGN_TARGETS.find((item) => item.id === 'video-card')!;
  const subscribe = YOUTUBE_DESIGN_TARGETS.find((item) => item.id === 'subscribe-button')!;
  const skin = { states: { normal: defaultSkinFrame(image(1)) } };
  expect(skinReason(subscribe, skin, { id: subscribe.id, count: 0 })).toStrictEqual({
    status: 'missing',
    text: 'このページに見つかりません（動画ページ・チャンネルページにあります）',
  });
  expect(skinReason(card, undefined, { id: card.id, count: 6, width: 300, height: 280 }).text).toBe(
    '未設定・ページ上に6個',
  );
  expect(
    skinReason(card, skin, { id: card.id, count: 6, width: 300, height: 280, asset: { state: 'loading' } }).status,
  ).toBe('loading');
  expect(
    skinReason(card, skin, {
      id: card.id,
      count: 6,
      width: 300,
      height: 280,
      asset: { state: 'error', message: '素材が見つかりません。' },
    }).text,
  ).toBe('絵を読み込めません：素材が見つかりません。');
  expect(skinReason(card, skin, { id: card.id, count: 2, width: 0, height: 0 }).status).toBe('missing');
  expect(skinReason(card, skin, { id: card.id, count: 6, width: 300, height: 280 }).text).toBe('6個に反映中');
  // Tabs follow the adapter's conditions and its part-specific names.
  expect(skinStates(subscribe)).toEqual(['normal', 'hover', 'focus', 'selected', 'pressed', 'disabled']);
  expect(skinStates(card)).toEqual(['normal', 'hover', 'focus', 'pressed']);
  expect(skinStateName(subscribe, 'selected')).toBe('登録済み');
  expect(skinStateName(card, 'hover')).toBe('ホバー');
});
