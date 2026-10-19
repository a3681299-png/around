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

function harness(validateAssets: () => Promise<void> = async () => undefined) {
  let value: DesignDocument | undefined, serial = 0;
  const listeners = new Set<(value: DesignDocument | undefined) => void>(), leases = new Map<string, readonly string[]>();
  const ports: EditorPorts<readonly EditorAsset[]> = {
    siteId: 'youtube', baseThemeId: 'retro', targets: [{ id: 'video-card', surface: 'video-card', label: '動画カード' }], makeId: (kind) => `${kind}-${++serial}`, validate: (doc) => { if (doc) parseDesign(doc); },
    geometry: { frameFor: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      samples: (doc, ids) => movableMedia(ids, doc.decorations, doc.groups ?? []).map((layer) => ({ id: layer.id, placement: layer.placement, frame: { left: 0, top: 0, width: 1000, height: 800 } })),
      importFrame: (point) => ({ width: 1000, height: 800, origin: point ?? { x: 450, y: 360 } }) },
    storage: { read: async () => value, watch(accept) { listeners.add(accept); void Promise.resolve().then(() => listeners.has(accept) && accept(value)); return () => { listeners.delete(accept); }; },
      retain: async (session, ids) => { leases.set(session, [...ids]); }, release: async (session) => { leases.delete(session); }, validate: validateAssets,
      import: async (source) => source, cancelImport() {}, save: async (doc) => { value = parseDesign(doc); listeners.forEach((accept) => accept(value)); } },
  };
  const editor = createEditorSession(ports);
  return { editor, leases, ports, set(doc: DesignDocument) { value = parseDesign(doc); listeners.forEach((accept) => accept(value)); } };
}
const assets = Array.from({ length: 3 }, (_, i) => ({ id: `asset-${String(i).repeat(64)}`, name: `Material ${i}`, width: 200, height: 160 }));
async function opened() { const h = harness(); await Promise.resolve(); h.editor.setEnabled(true); expect(h.editor.open().ok).toBe(true); await h.editor.import(assets); return h; }

test('signal key edits share gesture history, locks, save/discard and session recovery', async () => {
  const { editor } = await opened(), id = editor.snapshot().document.decorations[0]!.id, rule = defaultScrollOpacityRule(id);
  await editor.execute({ type: 'signal-rule', rule }); const before = editor.snapshot().document, count = editor.checkpoint().history.past.length;
  await editor.execute({ type: 'begin' });
  for (let i = 1; i <= 10; i++) { const next = structuredClone(rule); next.keyframes[1]!.value = 1 - i * .05; await editor.execute({ type: 'signal-rule', rule: next }); }
  await editor.execute({ type: 'end' }); expect(editor.checkpoint().history.past).toHaveLength(count + 1);
  await editor.execute({ type: 'undo' }); expect(editor.snapshot().document).toEqual(before);
  await editor.execute({ type: 'redo' }); expect(editor.snapshot().document.signalRules![0]!.keyframes[1]!.value).toBe(.5);
  await editor.execute({ type: 'change', id, patch: { locked: true } }); const locked = editor.snapshot().document;
  await editor.execute({ type: 'remove-signal-rule', id: rule.id }); expect(editor.snapshot().document).toEqual(locked);
  await editor.execute({ type: 'change', id, patch: { locked: false } }); await editor.execute({ type: 'save' });
  await editor.execute({ type: 'remove-signal-rule', id: rule.id }); expect(editor.snapshot().document.signalRules).toBeUndefined(); await editor.execute({ type: 'discard' });
  expect(editor.snapshot().document.signalRules).toHaveLength(1);
  const checkpoint = editor.checkpoint(), recovered = harness(); await Promise.resolve(); recovered.editor.setEnabled(true); recovered.editor.open(); await recovered.editor.restore(checkpoint);
  expect(recovered.editor.snapshot().document.signalRules).toEqual(editor.snapshot().document.signalRules);
  expect(parseEditCommand({ type: 'signal-rule', rule })).toEqual({ type: 'signal-rule', rule });
  expect(() => parseEditCommand({ type: 'signal-rule', rule: { ...rule, script: 'alert(1)' } })).toThrow();
  editor.destroy(); recovered.editor.destroy();
});

test('Editor Core compiles with no browser APIs and UI modules do not import Chrome', () => {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.editor-core.json']);
  for (const file of ['panel', 'workspace', 'layer-tree', 'effects-panel', 'number-scrub']) expect(readFileSync(`src/editor/${file}.ts`, 'utf8')).not.toMatch(/\bchrome\./);
  for (const file of ['app', 'connection', 'preferences', 'ui-actions', 'protocol', 'workbench', 'asset-library']) expect(readFileSync(`src/studio/${file}.ts`, 'utf8')).not.toMatch(/\bchrome\./);
});
test('the same commands select, group, move, protect, undo and save using memory-only ports', async () => {
  const { editor } = await opened(); await editor.execute({ type: 'select-all' }); await editor.execute({ type: 'group' });
  const group = editor.snapshot().document.groups![0]!, initial = editor.snapshot().document;
  await editor.execute({ type: 'begin' });
  for (let i = 0; i < 10; i++) await editor.execute({ type: 'placements', changes: editor.snapshot().document.decorations.map((layer) => ({ id: layer.id, placement: { ...layer.placement, x: layer.placement.x + .001 } })) });
  await editor.execute({ type: 'end' }); const moved = editor.snapshot().document;
  expect(moved.decorations[0]!.placement.x - initial.decorations[0]!.placement.x).toBeCloseTo(.01, 6);
  await editor.execute({ type: 'undo' }); expect(editor.snapshot().document).toEqual(initial);
  await editor.execute({ type: 'redo' }); expect(editor.snapshot().document).toEqual(moved);
  await editor.execute({ type: 'change', id: group.id, patch: { locked: true } }); await editor.execute({ type: 'delete' }); expect(editor.snapshot().document.decorations).toHaveLength(3);
  await editor.execute({ type: 'save' }); expect(editor.snapshot().view.dirty).toBe(false);
  await editor.execute({ type: 'change', id: group.id, patch: { name: 'Changed' } }); await editor.execute({ type: 'discard' }); expect(editor.snapshot().document.groups![0]!.name).toBe(group.name);
  editor.destroy();
});
test('checkpoint reload preserves draft, selection, asset references and Undo; a newer save is a visible conflict', async () => {
  const a = await opened(); await a.editor.execute({ type: 'select-all' }); await a.editor.execute({ type: 'group' });
  const checkpoint = JSON.parse(JSON.stringify(a.editor.checkpoint())) as EditorCheckpoint;
  const b = harness(); await Promise.resolve(); b.editor.setEnabled(true); b.editor.open(); await b.editor.restore(checkpoint);
  expect(b.editor.snapshot().document).toEqual(a.editor.snapshot().document); expect(b.editor.snapshot().view.selectedIds).toEqual(a.editor.snapshot().view.selectedIds);
  await b.editor.execute({ type: 'undo' }); expect(b.editor.snapshot().document.groups ?? []).toEqual([]);
  expect(new Set(b.editor.checkpoint().draft.decorations.map((layer) => layer.assetId))).toEqual(new Set(assets.map((asset) => asset.id)));
  const incoming = emptyDesign('youtube', 'retro'); incoming.rules.push({ kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#123456' } });
  b.set(incoming); expect(b.editor.snapshot().view.error).toBe(true); expect(b.editor.snapshot().view.dirty).toBe(true);
  await b.editor.execute({ type: 'discard' }); expect(b.editor.snapshot().document).toEqual(incoming);
  a.editor.destroy(); b.editor.destroy();
});
test('shared shortcuts preserve modifier meanings and composing input is ignored', () => {
  const input = { key: 'ArrowRight', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false, isComposing: false }, state = { selectedIds: ['image-a'], saving: false };
  expect(shortcutCommand(input, state)).toEqual({ type: 'nudge', delta: { x: 10, y: 0 } });
  expect(shortcutCommand({ ...input, key: 'z', ctrlKey: true }, state)).toEqual({ type: 'redo' });
  expect(shortcutCommand({ ...input, key: 'Delete', isComposing: true }, state)).toBeUndefined();
});

test('legacy v7 saved checkpoints migrate before conflict comparison and failed migration cannot mutate a draft', async () => {
  const a = await opened(); await a.editor.execute({ type: 'save' });
  const legacy = JSON.parse(JSON.stringify(a.editor.checkpoint()).replaceAll('"schemaVersion":9', '"schemaVersion":7')) as EditorCheckpoint, before = JSON.stringify(legacy);
  const b = harness(); await Promise.resolve(); b.set(legacy.saved!); b.editor.setEnabled(true); b.editor.open(); await b.editor.restore(legacy);
  expect(b.editor.snapshot().document.schemaVersion).toBe(9); expect(b.editor.snapshot().view.dirty).toBe(false); expect(b.editor.snapshot().view.error).toBe(false);
  expect(JSON.stringify(legacy)).toBe(before);
  const invalid = structuredClone(legacy); Object.assign(invalid.saved!, { schemaVersion: 10 }); const current = b.editor.snapshot().document;
  await expect(b.editor.restore(invalid)).rejects.toThrow(); expect(b.editor.snapshot().document).toEqual(current);
  a.editor.destroy(); b.editor.destroy();
});

test('Host geometry notifications update views without invalidating document command revisions', async () => {
  const { editor } = await opened(); let notifications = 0; const off = editor.subscribe(() => notifications++);
  const before = editor.snapshot(); editor.refreshGeometry(); editor.refreshGeometry(); editor.setEnabled(true);
  expect(notifications).toBe(2); expect(editor.snapshot().revision).toBe(before.revision);
  await editor.execute({ type: 'snap', value: true }); expect(editor.snapshot().revision).toBeGreaterThan(before.revision);
  off(); editor.destroy();
});

test('a delayed checkpoint validation cannot overwrite a new edit session', async () => {
  const a = await opened(), b = harness(); await Promise.resolve(); b.editor.setEnabled(true); b.editor.open();
  let release: () => void = () => {}; const pending = new Promise<void>((resolve) => { release = resolve; }); b.ports.storage.validate = () => pending;
  const restoring = b.editor.restore(a.editor.checkpoint()); await Promise.resolve(); await Promise.resolve();
  await b.editor.execute({ type: 'close' }); b.editor.open(); release(); await restoring;
  expect(b.editor.snapshot().document.decorations).toHaveLength(0); expect(b.editor.snapshot().view.canUndo).toBe(false);
  a.editor.destroy(); b.editor.destroy();
});

test('communication permits declarative commands and rejects malformed, executable or oversized input', () => {
  expect(parseEditCommand({ type: 'change', id: 'image-a', patch: { name: 'script' } })).toMatchObject({ patch: { name: 'script' } });
  for (const value of [null, { type: 'execute', script: 'alert(1)' }, { type: 'select' }, { type: 'snap', value: 1 }, { type: 'reorder', id: 'a', targetId: 'b' },
    { type: 'nudge', delta: { x: Infinity, y: 0 } }, { type: 'placements', changes: [null] }, { type: 'change', patch: { expression: 'x + 1' } },
    { type: 'change', patch: { name: 'a'.repeat(100_001) } }, JSON.parse('{"type":"change","patch":{"__proto__":{}}}')]) expect(() => parseEditCommand(value)).toThrow();
});


test('tools share commands/checkpoints without changing artwork/history, and import returns to authoring', async () => {
  const { editor } = await opened(), before = editor.snapshot().document, history = editor.checkpoint().history;
  await editor.execute({ type: 'tool', tool: 'browse' }); expect(editor.snapshot().view.tool).toBe('browse');
  expect(editor.snapshot().document).toEqual(before); expect(editor.checkpoint().history).toEqual(history);
  const checkpoint = editor.checkpoint(), b = harness(); await Promise.resolve(); b.editor.setEnabled(true); b.editor.open(); await b.editor.restore(checkpoint);
  expect(b.editor.snapshot().view.tool).toBe('browse');
  const { tool: _tool, ...old } = checkpoint; await b.editor.restore(old); expect(b.editor.snapshot().view.tool).toBe('select');
  await editor.import([assets[0]!]); expect(editor.snapshot().view.tool).toBe('select');
  expect(parseEditCommand({ type: 'tool', tool: 'card' })).toEqual({ type: 'tool', tool: 'card' });
  expect(() => parseEditCommand({ type: 'tool', tool: 'execute' })).toThrow();
  editor.destroy(); b.editor.destroy();
});


test('geometry snapshots during asset preflight preserve selection until import is committed', async () => {
  let deferred = false, release: () => void = () => {}, reached: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const validating = new Promise<void>((resolve) => { reached = resolve; });
  const h = harness(async () => { if (deferred) { reached(); await gate; } });
  await Promise.resolve(); h.editor.setEnabled(true); h.editor.open(); await h.editor.import([assets[0]!]);
  const old = h.editor.snapshot(); deferred = true;
  const importing = h.editor.import([assets[1]!]); await validating;
  const pending = h.editor.snapshot(); h.editor.refreshGeometry(); h.editor.snapshot();
  expect(pending.document).toEqual(old.document); expect(pending.view.selectedIds).toEqual(old.view.selectedIds);
  release(); await importing;
  const done = h.editor.snapshot(); expect(done.document.decorations).toHaveLength(2);
  expect(done.view.selectedIds).toEqual([done.document.decorations[1]!.id]);
  await h.editor.execute({ type: 'undo' }); expect(h.editor.snapshot().document).toEqual(old.document); h.editor.destroy();
});
