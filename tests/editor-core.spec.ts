import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createEditorSession } from '../src/editor-core/session';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { movableMedia } from '../src/world/hierarchy';
import { shortcutCommand } from '../src/editor-core/shortcuts';
import type { DesignDocument } from '../src/design/types';
import type { EditorAsset, EditorCheckpoint, EditorPorts } from '../src/editor-core/types';
import { parseEditCommand } from '../src/studio/protocol';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { createStudioStateEncoder, createStudioStateDecoder } from '../src/studio/state-sync';
import { packCheckpoint, unpackCheckpoint } from '../src/studio/checkpoint-codec';
import { defaultModelSettings } from '../src/models/types';
import { defaultFollowMotion } from '../src/signals/motion';
import { commitDesign, editDesign, freezeTree, readDesign, shareDesign } from '../src/design/immutable';
import { inspectAsset } from '../src/assets/inspect';
import { vrmFixture } from './helpers/vrm-fixture';
import { CHARACTER_HOME } from '../src/characters/home';

function harness(validateAssets: () => Promise<void> = async () => undefined) {
  let value: DesignDocument | undefined,
    serial = 0;
  const listeners = new Set<(value: DesignDocument | undefined) => void>(),
    leases = new Map<string, readonly string[]>();
  const ports: EditorPorts<readonly EditorAsset[]> = {
    siteId: 'youtube',
    baseThemeId: 'retro',
    targets: [{ id: 'video-card', surface: 'video-card', label: '動画カード' }],
    makeId: (kind) => `${kind}-${++serial}`,
    validate: (doc) => {
      if (doc) parseDesign(doc);
    },
    geometry: {
      frameFor: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      samples: (doc, ids) =>
        movableMedia(ids, doc.decorations, doc.groups ?? []).map((layer) => ({
          id: layer.id,
          placement: layer.placement,
          frame: { left: 0, top: 0, width: 1000, height: 800 },
        })),
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
      validate: validateAssets,
      import: async (source) => source,
      cancelImport() {},
      save: async (doc) => {
        value = parseDesign(doc);
        listeners.forEach((accept) => accept(value));
      },
    },
  };
  const editor = createEditorSession(ports);
  return {
    editor,
    leases,
    ports,
    set(doc: DesignDocument) {
      value = parseDesign(doc);
      listeners.forEach((accept) => accept(value));
    },
  };
}
const assets = Array.from({ length: 3 }, (_, i) => ({
  id: `asset-${String(i).repeat(64)}`,
  name: `Material ${i}`,
  width: 200,
  height: 160,
}));

test('unknown initial settings are pending, while the first explicit OFF remains a terminal refusal', async () => {
  const { editor } = harness();
  try {
    await Promise.resolve();
    expect(editor.open()).toMatchObject({ ok: false, error: /設定を読み込み中/ });
    editor.setEnabled(false);
    expect(editor.open()).toMatchObject({
      ok: false,
      error: '「作品を表示する」がOFFです。ONにしてから編集してください。',
    });
    expect(editor.snapshot()).toMatchObject({ enabled: false, active: false });
    editor.setEnabled(true);
    expect(editor.open().ok).toBe(true);
    editor.setEnabled(false);
    expect(editor.snapshot()).toMatchObject({ enabled: false, active: false });
    expect(editor.open()).toMatchObject({ ok: false, error: /「作品を表示する」がOFF/ });
  } finally {
    editor.destroy();
  }
});
async function opened() {
  const h = harness();
  await Promise.resolve();
  h.editor.setEnabled(true);
  expect(h.editor.open().ok).toBe(true);
  await h.editor.import(assets);
  return h;
}

test('command allowlists reject invalid patches before touching the draft or history', async () => {
  const { editor } = await opened();
  const before = editor.checkpoint();
  const invalid = [
    { opacity: -0.1 },
    { opacity: 1.01 },
    { opacity: NaN },
    { opacity: Infinity },
    { zIndex: 0.5 },
    { zIndex: 101 },
    { visible: 'true' },
    { name: '' },
    { name: 'bad\nname' },
    { assetId: assets[0]!.id },
    { script: 'alert(1)' },
    { placement: { x: -1 } },
    { placement: { widthPx: 4097 } },
    { placement: { rotationDeg: Infinity } },
    { placement: { anchor: { kind: 'viewport', target: 'video' } } },
    { placement: { x: '0.5' } },
    { placement: { unknown: 1 } },
    { playback: { speed: NaN } },
    { playback: { playing: 1 } },
    { playback: { script: 'x' } },
    { model: { look: { yawLimit: 91 } } },
    { model: { speed: 5 } },
    { model: { vrm: { expressions: { happy: Infinity } } } },
    { model: { unknown: false } },
  ];
  for (const patch of invalid) {
    const command = { type: 'change', patch };
    expect(() => parseEditCommand(command)).toThrow();
    await expect(editor.execute(command as never)).rejects.toThrow();
    expect(editor.checkpoint()).toEqual(before);
  }
  const placement = before.draft.decorations[0]!.placement;
  for (const command of [
    { type: 'placements', changes: [{ id: before.draft.decorations[0]!.id, placement: { ...placement, y: NaN } }] },
    { type: 'placements', changes: [{ id: before.draft.decorations[0]!.id, placement: { ...placement, extra: 1 } }] },
    { type: 'nudge', delta: { x: 1, y: 2, script: 'x' } },
    { type: 'style', style: { borderRadiusPx: 49 } },
    { type: 'style', style: { backgroundColor: 'url(x)' } },
    { type: 'style', style: { border: { color: '#ffffff', widthPx: Infinity } } },
    { type: 'style', style: { unknown: '#ffffff' } },
  ])
    expect(() => parseEditCommand(command)).toThrow();
  const rule = defaultScrollOpacityRule(before.draft.decorations[0]!.id);
  for (const value of [NaN, Infinity, -1, 2, '0.5']) {
    const invalidRule = structuredClone(rule);
    invalidRule.keyframes[0]!.value = value as number;
    expect(() => parseEditCommand({ type: 'signal-rule', rule: invalidRule })).toThrow();
  }
  editor.destroy();
});

test('command type checks reject callbacks, accessors, cycles and coerced enum arrays without executing them', () => {
  let invoked = 0;
  const rule = defaultScrollOpacityRule('image-a');
  const values = [
    { type: 'tool', tool: ['select'] },
    { type: 'layout', mode: ['left'] },
    { type: 'change', patch: { motion: { ...defaultFollowMotion(), mode: ['smooth'] } } },
    { type: 'signal-rule', rule: { ...rule, source: { ...rule.source, signal: ['page.scroll.progress'] } } },
    { type: 'signal-rule', rule: { ...rule, source: { ...rule.source, axis: ['y'] } } },
    { type: 'signal-rule', rule: { ...rule, source: { ...rule.source, space: ['page'] } } },
    { type: 'signal-rule', rule: { ...rule, target: { ...rule.target, property: ['opacity'] } } },
    { type: 'signal-rule', rule: { ...rule, keyframes: [{ ...rule.keyframes[0], easing: ['linear'] }] } },
    {
      type: 'signal-rule',
      rule: {
        ...rule,
        source: {
          ...rule.source,
          signal: {
            toString() {
              invoked++;
              return 'page.scroll.progress';
            },
          },
        },
      },
    },
    {
      type: 'change',
      patch: {
        name: {
          toJSON() {
            invoked++;
            return 'Layer';
          },
        },
      },
    },
    {
      type: 'change',
      patch: {
        name: () => {
          invoked++;
          return 'Layer';
        },
      },
    },
    { type: 'change', patch: { name: Symbol('invalid') } },
    {
      type: 'change',
      get patch() {
        invoked++;
        return { name: 'Layer' };
      },
    },
  ];
  for (const value of values) expect(() => parseEditCommand(value)).toThrow();
  const cyclic: { type: string; patch?: unknown } = { type: 'change' };
  cyclic.patch = cyclic;
  expect(() => parseEditCommand(cyclic)).toThrow();
  expect(invoked).toBe(0);
});

test('immutable revisions share unchanged layers and history cannot be rewritten by later edits', async () => {
  const { editor } = await opened();
  await editor.execute({ type: 'save' });
  const saved = editor.snapshot().document;
  const id = saved.decorations[0]!.id;
  await editor.execute({ type: 'signal-rule', rule: defaultScrollOpacityRule(id) });
  const before = editor.snapshot().document;
  const placement = { ...before.decorations[0]!.placement, x: 0.7 };
  await editor.execute({ type: 'placements', changes: [{ id, placement }] });
  placement.x = 0.9;
  const after = editor.snapshot().document;
  expect(after.decorations[0]!.placement.x).toBe(0.7);
  expect(after.decorations[1]).toBe(before.decorations[1]);
  expect(after.rules).toBe(before.rules);
  expect(after.signalRules).toBe(before.signalRules);
  expect(editor.checkpoint().history.past.at(-1)).toBe(before);
  expect(Object.isFrozen(before)).toBe(true);
  expect(Object.isFrozen(before.decorations[0]!.placement)).toBe(true);
  expect(Object.isFrozen(before.signalRules![0]!.keyframes)).toBe(true);
  expect(() => {
    before.decorations[0]!.placement.x = 0.2;
  }).toThrow(TypeError);
  expect(() => {
    before.signalRules![0]!.keyframes[0]!.value = 0.8;
  }).toThrow(TypeError);
  await editor.execute({ type: 'undo' });
  expect(editor.snapshot().document).toBe(before);
  await editor.execute({ type: 'undo' });
  expect(editor.snapshot().document).toBe(saved);
  expect(editor.snapshot().view.dirty).toBe(false);
  await editor.execute({ type: 'redo' });
  await editor.execute({ type: 'redo' });
  expect(editor.snapshot().document).toBe(after);
  expect(editor.snapshot().view.dirty).toBe(true);
  const surviving = editor.snapshot().document.decorations[1];
  await editor.execute({ type: 'delete', id });
  expect(editor.snapshot().document.decorations[0]).toBe(surviving);
  editor.destroy();
});

test('freezing display data never marks invalid layers, styles, groups or signals as validated', async () => {
  const { editor } = await opened();
  const input = structuredClone(editor.snapshot().document);
  input.rules = [{ kind: 'surface-style', target: 'video-card', style: { borderRadiusPx: 8 } }];
  input.groups = [
    {
      kind: 'group',
      id: 'group-test',
      name: 'Group',
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      children: input.decorations.slice(0, 2).map((layer) => layer.id),
    },
  ];
  input.signalRules = [defaultScrollOpacityRule(input.decorations[0]!.id)];
  const previous = readDesign(input);
  const invalid: Array<(doc: DesignDocument) => void> = [
    (doc) => {
      doc.decorations[0]!.opacity = 1.01;
    },
    (doc) => {
      doc.decorations[0]!.placement.x = Infinity;
    },
    (doc) => {
      doc.groups![0]!.opacity = -0.1;
    },
    (doc) => {
      doc.rules[0]!.style.borderRadiusPx = 49;
    },
    (doc) => {
      doc.signalRules![0]!.keyframes[0]!.value = NaN;
    },
  ];
  try {
    for (const corrupt of invalid) {
      const value = structuredClone(input);
      corrupt(value);
      freezeTree(value);
      expect(Object.isFrozen(value.decorations[0]!)).toBe(true);
      expect(() => commitDesign(value, previous)).toThrow();
      expect(() => shareDesign(previous, value)).toThrow();
      expect(() => shareDesign(value, previous)).toThrow();
    }
    expect(previous).toEqual(input);
    // A valid frozen view also crosses the schema, rather than being adopted by reference.
    const display = freezeTree(structuredClone(input)),
      adopted = commitDesign(display),
      committed = commitDesign(display, previous);
    expect(adopted).toEqual(input);
    expect(adopted.decorations[0]).not.toBe(display.decorations[0]);
    expect(committed).toBe(previous);
    const wrongRole = editDesign(previous);
    wrongRole.decorations[0] = previous.groups![0] as never;
    expect(() => commitDesign(wrongRole, previous)).toThrow();
    const edited = editDesign(committed);
    edited.decorations[0] = { ...committed.decorations[0]!, opacity: 0.5 };
    const next = commitDesign(edited, committed);
    expect(next.decorations[1]).toBe(previous.decorations[1]);
    expect(next.rules).toBe(previous.rules);
    expect(next.groups).toBe(previous.groups);
    expect(next.signalRules).toBe(previous.signalRules);
  } finally {
    editor.destroy();
  }
});

test('Studio deltas preserve gestures, Undo/Redo, save/discard and the bounded history through JSON transport', async () => {
  const { editor } = await opened();
  const encoder = createStudioStateEncoder(),
    decoder = createStudioStateDecoder();
  const id = editor.snapshot().document.decorations[0]!.id;
  const wire = () => JSON.parse(JSON.stringify(encoder.encode(editor.snapshot(), editor.checkpoint())));
  decoder.accept(wire());
  const run = async (command: Parameters<typeof editor.execute>[0]) => {
    await editor.execute(command);
    const message = wire();
    expect(message.checkpoint).toBeUndefined();
    const received = decoder.accept(message);
    if (received) {
      expect(received.state).toEqual(editor.snapshot());
      expect(received.checkpoint).toEqual(editor.checkpoint());
    }
    return { message, received };
  };
  await run({ type: 'begin' });
  await run({ type: 'change', id, patch: { opacity: 0.5 } });
  await run({ type: 'end', cancel: true });
  await run({ type: 'begin' });
  await run({ type: 'change', id, patch: { opacity: 0.6 } });
  await run({ type: 'end' });
  await run({ type: 'undo' });
  await run({ type: 'redo' });
  await run({ type: 'select-target', target: 'video-card' });
  await run({ type: 'style', style: { backgroundColor: '#123456' } });
  const savedMessage = await run({ type: 'save' });
  expect(JSON.stringify(savedMessage.message)).not.toContain('schemaVersion');
  expect(savedMessage.received!.state.saved).toBe(savedMessage.received!.state.document);
  await run({ type: 'change', id, patch: { locked: true } });
  await run({ type: 'discard' });
  await run({ type: 'select-all' });
  await run({ type: 'group' });
  await run({ type: 'ungroup' });
  await run({ type: 'duplicate', id });
  await run({ type: 'undo' });
  await run({ type: 'delete', id });
  await run({ type: 'undo' });
  let last;
  for (let i = 0; i < 105; i++) {
    last = await run({ type: 'change', id, patch: { opacity: 0.1 + i / 1000 } });
    expect(Buffer.byteLength(JSON.stringify(last.message))).toBeLessThan(2500);
  }
  expect(last!.received!.checkpoint.history.past).toHaveLength(100);
  const packed = packCheckpoint(last!.received!.checkpoint);
  const restored = unpackCheckpoint(JSON.parse(JSON.stringify(packed)))!;
  expect(restored).toEqual(editor.checkpoint());
  expect(restored.history.past[0]!.decorations[1]).toBe(restored.history.past[1]!.decorations[1]);
  const recovered = harness();
  await Promise.resolve();
  // A reload reads the same persisted artwork before adopting its checkpoint.
  recovered.set(restored.saved!);
  recovered.editor.setEnabled(true);
  recovered.editor.open();
  await recovered.editor.restore(restored);
  const history = recovered.editor.checkpoint().history;
  expect(history.past[0]!.decorations[1]).toBe(history.past[1]!.decorations[1]);
  await recovered.editor.execute({ type: 'undo' });
  expect(recovered.editor.snapshot().document).toEqual(editor.checkpoint().history.past.at(-1));
  editor.destroy();
  recovered.editor.destroy();
});

test('editing one of 32 long rules sends changed keys and ordering IDs without resending unchanged keyframes', async () => {
  const a = await opened(),
    doc = structuredClone(a.editor.snapshot().document);
  const layer = doc.decorations[0]!;
  doc.decorations = Array.from({ length: 32 }, (_, i) => ({ ...layer, id: `image-${i}` }));
  doc.signalRules = doc.decorations.map((layer, index) => ({
    ...defaultScrollOpacityRule(layer.id),
    id: index === 31 ? 'constructor' : `scroll-${layer.id}`,
    keyframes: Array.from({ length: 64 }, (_, i) => ({
      id: `key-${i}`,
      input: i / 63,
      value: (index + i) / 100,
      easing: 'linear',
    })),
  }));
  const h = harness();
  h.set(doc);
  h.editor.setEnabled(true);
  h.editor.open();
  const encoder = createStudioStateEncoder(),
    decoder = createStudioStateDecoder();
  const wire = () => JSON.parse(JSON.stringify(encoder.encode(h.editor.snapshot(), h.editor.checkpoint())));
  decoder.accept(wire());
  const rule = structuredClone(doc.signalRules[0]!);
  rule.keyframes[0]!.value = 0.8;
  await h.editor.execute({ type: 'signal-rule', rule });
  const message = wire(),
    text = JSON.stringify(message);
  expect(text).not.toContain('key-63');
  expect(text).not.toContain('schemaVersion');
  expect(Buffer.byteLength(text)).toBeLessThan(5000);
  expect(decoder.accept(message)!.checkpoint).toEqual(h.editor.checkpoint());
  await h.editor.execute({ type: 'save' });
  const save = wire();
  expect(JSON.stringify(save)).not.toContain('keyframes');
  const saved = decoder.accept(save)!;
  expect(saved.state.saved).toBe(saved.state.document);
  expect(saved.checkpoint).toEqual(h.editor.checkpoint());
  a.editor.destroy();
  h.editor.destroy();
});

test('Studio detects missing or duplicate deltas atomically and reconnects from a new base', async () => {
  const { editor } = await opened();
  const encoder = createStudioStateEncoder(),
    decoder = createStudioStateDecoder();
  const first = JSON.parse(JSON.stringify(encoder.encode(editor.snapshot(), editor.checkpoint())));
  decoder.accept(first);
  await editor.execute({ type: 'snap', value: true });
  const skipped = JSON.parse(JSON.stringify(encoder.encode(editor.snapshot(), editor.checkpoint())));
  await editor.execute({ type: 'tool', tool: 'browse' });
  const later = JSON.parse(JSON.stringify(encoder.encode(editor.snapshot(), editor.checkpoint())));
  expect(() => decoder.accept(later)).toThrow(/順序/);
  expect(decoder.accept(skipped)!.state.view.tool).toBe('select');
  expect(() => decoder.accept(skipped)).toThrow(/順序/);
  expect(decoder.accept(later)!.state.view.tool).toBe('browse');
  const reconnected = createStudioStateEncoder();
  expect(
    decoder.accept(JSON.parse(JSON.stringify(reconnected.encode(editor.snapshot(), editor.checkpoint()))))!.state,
  ).toEqual(editor.snapshot());
  editor.destroy();
});

test('compact recovery reads legacy v1 unchanged and rejects cyclic or out-of-range graph references', async () => {
  const { editor } = await opened();
  const legacy = JSON.parse(JSON.stringify(editor.checkpoint()));
  expect(unpackCheckpoint(legacy)).toBe(legacy);
  expect(unpackCheckpoint(packCheckpoint(legacy))).toEqual(legacy);
  expect(unpackCheckpoint({ version: 99 })).toBeUndefined();
  expect(() => unpackCheckpoint({ version: 2, root: { ref: 1 }, nodes: [] })).toThrow();
  expect(() => unpackCheckpoint({ version: 2, root: { ref: 0 }, nodes: [{ array: [{ ref: 0 }] }] })).toThrow();
  const invalid = structuredClone(legacy);
  invalid.history.past[0].decorations.push({ script: 'x' });
  await expect(editor.restore(unpackCheckpoint(packCheckpoint(invalid))!)).rejects.toThrow();
  expect(editor.checkpoint()).toEqual(legacy);
  editor.destroy();
});

test('core views explain duplicate/import/group/layout capabilities including protected descendants and limits', async () => {
  const { editor } = await opened();
  expect(editor.snapshot().view.canDuplicate.allowed).toBe(true);
  await editor.execute({ type: 'clear-selection' });
  expect(editor.snapshot().view.canDuplicate).toMatchObject({ allowed: false, reason: /選択/ });
  await editor.execute({ type: 'select-all' });
  expect(editor.snapshot().view.canGroup.allowed).toBe(true);
  expect(editor.snapshot().view.canAlign.allowed).toBe(true);
  expect(editor.snapshot().view.canDistribute.allowed).toBe(true);
  await editor.execute({ type: 'group' });
  let view = editor.snapshot().view;
  expect(view.canUngroup.allowed).toBe(true);
  expect(view.canAlign.allowed).toBe(false);
  expect(view.canChangeAnchor.allowed).toBe(false);
  await editor.execute({ type: 'change', id: view.image!.id, patch: { opacity: 0.5 } });
  expect(editor.snapshot().view.canUngroup).toMatchObject({ allowed: false, reason: /100%/ });
  await editor.execute({ type: 'change', id: view.images[0]!.id, patch: { locked: true } });
  view = editor.snapshot().view;
  expect(view.canDuplicate.allowed).toBe(false);
  expect(view.canDelete.allowed).toBe(false);
  expect(view.canChangeMotion.allowed).toBe(false);
  const layer = view.images[0]!;
  const full = emptyDesign('youtube', 'retro');
  full.decorations = Array.from({ length: 32 }, (_, i) => ({ ...layer, id: `image-${i}`, locked: false }));
  const limited = harness();
  limited.set(full);
  limited.editor.setEnabled(true);
  limited.editor.open();
  view = limited.editor.snapshot().view;
  for (const value of [view.canAddImage, view.canAddModel, view.canAddAnimation]) {
    expect(value.allowed).toBe(false);
    expect(value.reason).toContain('32');
  }
  const source = { format: 'glb' as const, clips: [], bones: [], vertices: 0, triangles: 0, textureBytes: 0 };
  const modelDoc = emptyDesign('youtube', 'retro');
  modelDoc.decorations = Array.from({ length: 8 }, (_, i) => ({
    ...layer,
    id: `model-${i}`,
    kind: 'model3d',
    locked: false,
    source,
    model: defaultModelSettings(source),
  }));
  const models = harness();
  models.set(modelDoc);
  models.editor.setEnabled(true);
  models.editor.open();
  view = models.editor.snapshot().view;
  expect(view.canAddImage.allowed).toBe(true);
  expect(view.canAddAnimation.allowed).toBe(true);
  expect(view.canAddModel).toMatchObject({ allowed: false, reason: /8レイヤー/ });
  editor.destroy();
  limited.editor.destroy();
  models.editor.destroy();
});

test('an identical external save preserves the saved reference and cannot cancel an in-flight import', async () => {
  let deferred = false,
    release: () => void = () => {},
    reached: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const validating = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const h = harness(async () => {
    if (deferred) {
      reached();
      await gate;
    }
  });
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  await h.editor.import([assets[0]!]);
  await h.editor.execute({ type: 'save' });
  const saved = h.editor.snapshot().saved!;
  deferred = true;
  const importing = h.editor.import([assets[1]!]);
  await validating;
  h.set(structuredClone(saved));
  expect(h.editor.snapshot().saved).toBe(saved);
  expect(h.editor.snapshot().document).toBe(saved);
  release();
  await importing;
  expect(h.editor.snapshot().document.decorations).toHaveLength(2);
  expect(h.editor.snapshot().view.error).toBe(false);
  expect(h.editor.snapshot().view.dirty).toBe(true);
  h.editor.destroy();
});

test('signal key edits share gesture history, locks, save/discard and session recovery', async () => {
  const { editor } = await opened(),
    id = editor.snapshot().document.decorations[0]!.id,
    rule = defaultScrollOpacityRule(id);
  await editor.execute({ type: 'signal-rule', rule });
  const before = editor.snapshot().document,
    count = editor.checkpoint().history.past.length;
  await editor.execute({ type: 'begin' });
  for (let i = 1; i <= 10; i++) {
    const next = structuredClone(rule);
    next.keyframes[1]!.value = 1 - i * 0.05;
    await editor.execute({ type: 'signal-rule', rule: next });
  }
  await editor.execute({ type: 'end' });
  expect(editor.checkpoint().history.past).toHaveLength(count + 1);
  await editor.execute({ type: 'undo' });
  expect(editor.snapshot().document).toEqual(before);
  await editor.execute({ type: 'redo' });
  expect(editor.snapshot().document.signalRules![0]!.keyframes[1]!.value).toBe(0.5);
  await editor.execute({ type: 'change', id, patch: { locked: true } });
  const locked = editor.snapshot().document;
  await editor.execute({ type: 'remove-signal-rule', id: rule.id });
  expect(editor.snapshot().document).toEqual(locked);
  await editor.execute({ type: 'change', id, patch: { locked: false } });
  await editor.execute({ type: 'save' });
  await editor.execute({ type: 'remove-signal-rule', id: rule.id });
  expect(editor.snapshot().document.signalRules).toBeUndefined();
  await editor.execute({ type: 'discard' });
  expect(editor.snapshot().document.signalRules).toHaveLength(1);
  const checkpoint = editor.checkpoint(),
    recovered = harness();
  await Promise.resolve();
  recovered.set(checkpoint.saved!);
  recovered.editor.setEnabled(true);
  recovered.editor.open();
  await recovered.editor.restore(checkpoint);
  expect(recovered.editor.snapshot().document.signalRules).toEqual(editor.snapshot().document.signalRules);
  expect(parseEditCommand({ type: 'signal-rule', rule })).toEqual({ type: 'signal-rule', rule });
  expect(() => parseEditCommand({ type: 'signal-rule', rule: { ...rule, script: 'alert(1)' } })).toThrow();
  editor.destroy();
  recovered.editor.destroy();
});

test('Editor Core compiles with no browser APIs and UI modules do not import Chrome', () => {
  // The typescript alias supplies ESLint's 6.x API; compilation stays on 7.x.
  execFileSync(process.execPath, [
    'node_modules/@typescript/native/bin/tsc',
    '--noEmit',
    '-p',
    'tsconfig.editor-core.json',
  ]);
  for (const file of ['panel', 'workspace', 'layer-tree', 'effects-panel', 'number-scrub'])
    expect(readFileSync(`src/editor/${file}.ts`, 'utf8')).not.toMatch(/\bchrome\./);
  for (const file of ['app', 'connection', 'preferences', 'ui-actions', 'protocol', 'workbench', 'asset-library'])
    expect(readFileSync(`src/studio/${file}.ts`, 'utf8')).not.toMatch(/\bchrome\./);
});
test('the same commands select, group, move, protect, undo and save using memory-only ports', async () => {
  const { editor } = await opened();
  await editor.execute({ type: 'select-all' });
  await editor.execute({ type: 'group' });
  const group = editor.snapshot().document.groups![0]!,
    initial = editor.snapshot().document;
  await editor.execute({ type: 'begin' });
  for (let i = 0; i < 10; i++)
    await editor.execute({
      type: 'placements',
      changes: editor.snapshot().document.decorations.map((layer) => ({
        id: layer.id,
        placement: { ...layer.placement, x: layer.placement.x + 0.001 },
      })),
    });
  await editor.execute({ type: 'end' });
  const moved = editor.snapshot().document;
  expect(moved.decorations[0]!.placement.x - initial.decorations[0]!.placement.x).toBeCloseTo(0.01, 6);
  await editor.execute({ type: 'undo' });
  expect(editor.snapshot().document).toEqual(initial);
  await editor.execute({ type: 'redo' });
  expect(editor.snapshot().document).toEqual(moved);
  await editor.execute({ type: 'change', id: group.id, patch: { locked: true } });
  await editor.execute({ type: 'delete' });
  expect(editor.snapshot().document.decorations).toHaveLength(3);
  await editor.execute({ type: 'save' });
  expect(editor.snapshot().view.dirty).toBe(false);
  await editor.execute({ type: 'change', id: group.id, patch: { name: 'Changed' } });
  await editor.execute({ type: 'discard' });
  expect(editor.snapshot().document.groups![0]!.name).toBe(group.name);
  editor.destroy();
});
test('checkpoint reload preserves draft, selection, asset references and Undo; a newer save is a visible conflict', async () => {
  const a = await opened();
  await a.editor.execute({ type: 'select-all' });
  await a.editor.execute({ type: 'group' });
  const checkpoint = JSON.parse(JSON.stringify(a.editor.checkpoint())) as EditorCheckpoint;
  const b = harness();
  await Promise.resolve();
  b.editor.setEnabled(true);
  b.editor.open();
  await b.editor.restore(checkpoint);
  expect(b.editor.snapshot().document).toEqual(a.editor.snapshot().document);
  expect(b.editor.snapshot().view.selectedIds).toEqual(a.editor.snapshot().view.selectedIds);
  await b.editor.execute({ type: 'undo' });
  expect(b.editor.snapshot().document.groups ?? []).toEqual([]);
  expect(new Set(b.editor.checkpoint().draft.decorations.map((layer) => layer.assetId))).toEqual(
    new Set(assets.map((asset) => asset.id)),
  );
  const incoming = emptyDesign('youtube', 'retro');
  incoming.rules.push({ kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#123456' } });
  b.set(incoming);
  expect(b.editor.snapshot().view.error).toBe(true);
  expect(b.editor.snapshot().view.dirty).toBe(true);
  await b.editor.execute({ type: 'discard' });
  expect(b.editor.snapshot().document).toEqual(incoming);
  a.editor.destroy();
  b.editor.destroy();
});
test('a legacy dirty checkpoint without a proven base waits for the author', async () => {
  const a = await opened();
  const { origin: _origin, ...legacy } = a.editor.checkpoint();
  const b = harness();
  await Promise.resolve();
  b.editor.setEnabled(true);
  b.editor.open();
  await b.editor.restore(legacy);
  expect(b.editor.snapshot().recoveryPending).toBe(true);
  expect(b.editor.snapshot().document.decorations).toEqual([]);
  await b.editor.execute({ type: 'restore-draft' });
  expect(b.editor.snapshot().recoveryPending).toBeUndefined();
  expect(b.editor.snapshot().document).toEqual(legacy.draft);
  expect(b.editor.snapshot().saved).toBeUndefined();
  a.editor.destroy();
  b.editor.destroy();
});
test('shared shortcuts preserve modifier meanings and composing input is ignored', () => {
  const input = {
      key: 'ArrowRight',
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      altKey: false,
      isComposing: false,
    },
    state = { selectedIds: ['image-a'], saving: false };
  expect(shortcutCommand(input, state)).toEqual({ type: 'nudge', delta: { x: 10, y: 0 } });
  expect(shortcutCommand({ ...input, key: 'z', ctrlKey: true }, state)).toEqual({ type: 'redo' });
  expect(shortcutCommand({ ...input, key: 'Delete', isComposing: true }, state)).toBeUndefined();
});

test('legacy v7 saved checkpoints migrate before conflict comparison and failed migration cannot mutate a draft', async () => {
  const a = await opened();
  await a.editor.execute({ type: 'save' });
  const legacy = JSON.parse(
      JSON.stringify(a.editor.checkpoint()).replaceAll('"schemaVersion":17', '"schemaVersion":7'),
    ) as EditorCheckpoint,
    before = JSON.stringify(legacy);
  expect(legacy.saved!.schemaVersion).toBe(7);
  const b = harness();
  await Promise.resolve();
  b.set(legacy.saved!);
  b.editor.setEnabled(true);
  b.editor.open();
  await b.editor.restore(legacy);
  expect(b.editor.snapshot().document.schemaVersion).toBe(17);
  expect(b.editor.snapshot().view.dirty).toBe(false);
  expect(b.editor.snapshot().view.error).toBe(false);
  expect(JSON.stringify(legacy)).toBe(before);
  const invalid = structuredClone(legacy);
  Object.assign(invalid.saved!, { schemaVersion: 18 });
  const current = b.editor.snapshot().document;
  await expect(b.editor.restore(invalid)).rejects.toThrow();
  expect(b.editor.snapshot().document).toEqual(current);
  a.editor.destroy();
  b.editor.destroy();
});

test('Host geometry notifications update views without invalidating document command revisions', async () => {
  const { editor } = await opened();
  let notifications = 0;
  const off = editor.subscribe(() => notifications++);
  const before = editor.snapshot();
  editor.refreshGeometry();
  editor.refreshGeometry();
  editor.setEnabled(true);
  expect(notifications).toBe(2);
  expect(editor.snapshot().revision).toBe(before.revision);
  await editor.execute({ type: 'snap', value: true });
  expect(editor.snapshot().revision).toBeGreaterThan(before.revision);
  off();
  editor.destroy();
});

test('a delayed checkpoint validation cannot overwrite a new edit session', async () => {
  let release: () => void = () => {},
    reached: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const validating = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const a = await opened(),
    b = harness(async () => {
      reached();
      await pending;
    });
  await Promise.resolve();
  b.editor.setEnabled(true);
  b.editor.open();
  const restoring = b.editor.restore(a.editor.checkpoint());
  await validating;
  await b.editor.execute({ type: 'close' });
  b.editor.open();
  release();
  await restoring;
  expect(b.editor.snapshot().document.decorations).toHaveLength(0);
  expect(b.editor.snapshot().view.canUndo).toBe(false);
  a.editor.destroy();
  b.editor.destroy();
});

test('communication permits declarative commands and rejects malformed, executable or oversized input', () => {
  expect(parseEditCommand({ type: 'change', id: 'image-a', patch: { name: 'script' } })).toMatchObject({
    patch: { name: 'script' },
  });
  for (const value of [
    null,
    { type: 'execute', script: 'alert(1)' },
    { type: 'select' },
    { type: 'snap', value: 1 },
    { type: 'reorder', id: 'a', targetId: 'b' },
    { type: 'nudge', delta: { x: Infinity, y: 0 } },
    { type: 'placements', changes: [null] },
    { type: 'change', patch: { expression: 'x + 1' } },
    { type: 'change', patch: { name: 'a'.repeat(100_001) } },
    JSON.parse('{"type":"change","patch":{"__proto__":{}}}'),
  ])
    expect(() => parseEditCommand(value)).toThrow();
});

test('tools share commands/checkpoints without changing artwork/history, and import returns to authoring', async () => {
  const { editor } = await opened(),
    before = editor.snapshot().document,
    history = editor.checkpoint().history;
  await editor.execute({ type: 'tool', tool: 'browse' });
  expect(editor.snapshot().view.tool).toBe('browse');
  expect(editor.snapshot().document).toEqual(before);
  expect(editor.checkpoint().history).toEqual(history);
  const checkpoint = editor.checkpoint(),
    b = harness();
  await Promise.resolve();
  b.editor.setEnabled(true);
  b.editor.open();
  await b.editor.restore(checkpoint);
  expect(b.editor.snapshot().view.tool).toBe('browse');
  const { tool: _tool, ...old } = checkpoint;
  await b.editor.restore(old);
  expect(b.editor.snapshot().view.tool).toBe('select');
  await editor.import([assets[0]!]);
  expect(editor.snapshot().view.tool).toBe('select');
  expect(parseEditCommand({ type: 'tool', tool: 'card' })).toEqual({ type: 'tool', tool: 'card' });
  expect(() => parseEditCommand({ type: 'tool', tool: 'execute' })).toThrow();
  editor.destroy();
  b.editor.destroy();
});

test('geometry snapshots during asset preflight preserve selection until import is committed', async () => {
  let deferred = false,
    release: () => void = () => {},
    reached: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const validating = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const h = harness(async () => {
    if (deferred) {
      reached();
      await gate;
    }
  });
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  await h.editor.import([assets[0]!]);
  const old = h.editor.snapshot();
  deferred = true;
  const importing = h.editor.import([assets[1]!]);
  await validating;
  const pending = h.editor.snapshot();
  h.editor.refreshGeometry();
  h.editor.snapshot();
  expect(pending.document).toEqual(old.document);
  expect(pending.view.selectedIds).toEqual(old.view.selectedIds);
  release();
  await importing;
  const done = h.editor.snapshot();
  expect(done.document.decorations).toHaveLength(2);
  expect(done.view.selectedIds).toEqual([done.document.decorations[1]!.id]);
  await h.editor.execute({ type: 'undo' });
  expect(h.editor.snapshot().document).toEqual(old.document);
  h.editor.destroy();
});

test('a model is imported at the character home on the player, under its bars; an image keeps the viewport default', async () => {
  const h = harness(),
    model = inspectAsset(vrmFixture()).model!;
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  try {
    await h.editor.import([{ id: `asset-${'d'.repeat(64)}`, name: 'Character.vrm', width: 256, height: 256, model }]);
    await h.editor.import([assets[0]!]);
    const [character, image] = h.editor.snapshot().document.decorations;
    // Watching shows it right away: a model on the screen plane over the video is cut out where
    // the player's bars are, so a fresh import there was invisible until it was moved.
    expect(character).toMatchObject({ kind: 'model3d', placement: CHARACTER_HOME });
    expect(image!.placement.anchor).toEqual({ kind: 'viewport' });
  } finally {
    h.editor.destroy();
  }
});

test('without a player on the page, or dropped at a point, a model is imported on the viewport as before', async () => {
  const h = harness(),
    model = inspectAsset(vrmFixture()).model!;
  const frame = h.ports.geometry.frameFor;
  h.ports.geometry.frameFor = (placement) => (placement.anchor.kind === 'viewport' ? frame(placement) : undefined);
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  try {
    await h.editor.import([{ id: `asset-${'e'.repeat(64)}`, name: 'Character.vrm', width: 256, height: 256, model }]);
    expect(h.editor.snapshot().document.decorations[0]!.placement).toMatchObject({
      anchor: { kind: 'viewport' },
      x: 0.45,
      y: 0.45,
    });
    h.ports.geometry.frameFor = frame;
    await h.editor.import([{ id: `asset-${'f'.repeat(64)}`, name: 'Dropped.vrm', width: 256, height: 256, model }], {
      x: 100,
      y: 80,
    });
    expect(h.editor.snapshot().document.decorations[1]!.placement).toMatchObject({
      anchor: { kind: 'viewport' },
      x: 0.1,
      y: 0.1,
    });
  } finally {
    h.editor.destroy();
  }
});

test('reimporting a VRM refreshes its body without adding a layer or losing edits and history', async () => {
  const h = harness(),
    measured = inspectAsset(vrmFixture()).model!,
    legacy = structuredClone(measured),
    id = `asset-${'c'.repeat(64)}`;
  delete legacy.vrm!.body;
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  try {
    await h.editor.import([{ id, name: 'Legacy.vrm', width: 200, height: 200, model: legacy }]);
    await h.editor.execute({ type: 'change', patch: { name: 'Keep edits', opacity: 0.6, model: { playing: false } } });
    const before = h.editor.snapshot().document,
      expected = structuredClone(before);
    if (expected.decorations[0]?.kind !== 'model3d') throw new Error('Expected a model layer');
    expected.decorations[0].source = measured;
    await h.editor.import([{ id, name: 'Renamed.vrm', width: 200, height: 200, model: measured }]);
    expect(h.editor.snapshot().document).toEqual(expected);
    await h.editor.execute({ type: 'undo' });
    expect(h.editor.snapshot().document).toEqual(before);
    await h.editor.execute({ type: 'redo' });
    expect(h.editor.snapshot().document).toEqual(expected);
    await h.editor.execute({ type: 'save' });
    expect(await h.ports.storage.read()).toEqual(expected);
    // Every layer is measured now: reading the same VRM again adds a second instance as it
    // always did (Shota's decision, 2026-11-05), leaving the first one untouched.
    await h.editor.import([{ id, name: 'Renamed.vrm', width: 200, height: 200, model: measured }]);
    const twice = h.editor.snapshot().document.decorations;
    expect(twice).toHaveLength(2);
    expect(twice[0]).toEqual(expected.decorations[0]);
    expect(twice[1]).toMatchObject({ kind: 'model3d', assetId: id, source: measured });
  } finally {
    h.editor.destroy();
  }
});

test('reimporting refreshes every unmeasured copy of a VRM and adds none; a fully measured VRM adds a layer', async () => {
  const h = harness(),
    measured = inspectAsset(vrmFixture()).model!,
    legacy = structuredClone(measured),
    id = `asset-${'e'.repeat(64)}`;
  delete legacy.vrm!.body;
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  try {
    await h.editor.import([{ id, name: 'Legacy.vrm', width: 200, height: 200, model: legacy }]);
    await h.editor.execute({ type: 'duplicate' });
    const ids = h.editor.snapshot().document.decorations.map((layer) => layer.id);
    expect(ids).toHaveLength(2);
    await h.editor.import([{ id, name: 'Legacy.vrm', width: 200, height: 200, model: measured }]);
    const refreshed = h.editor.snapshot().document.decorations;
    expect(refreshed.map((layer) => layer.id)).toEqual(ids);
    for (const layer of refreshed) expect(layer).toMatchObject({ kind: 'model3d', source: measured });
    await h.editor.import([{ id, name: 'Legacy.vrm', width: 200, height: 200, model: measured }]);
    expect(h.editor.snapshot().document.decorations).toHaveLength(3);
  } finally {
    h.editor.destroy();
  }
});
