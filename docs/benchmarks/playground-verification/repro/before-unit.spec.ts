import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createEditorSession } from '../../../playground-v1-before/src/editor-core/session';
import { emptyDesign, parseDesign } from '../../src/design/schema';
import { movableMedia } from '../../src/world/hierarchy';
import { shortcutCommand } from '../../src/editor-core/shortcuts';
import type { DesignDocument } from '../../src/design/types';
import type { EditorAsset, EditorCheckpoint, EditorPorts } from '../../src/editor-core/types';
import { parseEditCommand } from '../../src/studio/protocol';
import { defaultScrollOpacityRule } from '../../src/signals/keyframes';
import { createStudioStateEncoder, createStudioStateDecoder } from '../../src/studio/state-sync';
import { packCheckpoint, unpackCheckpoint } from '../../src/studio/checkpoint-codec';
import { defaultModelSettings } from '../../src/models/types';
import { defaultFollowMotion } from '../../src/signals/motion';
import { commitDesign, editDesign, freezeTree, readDesign, shareDesign } from '../../src/design/immutable';
import { inspectAsset } from '../../src/assets/inspect';
import { vrmFixture } from '../../tests/helpers/vrm-fixture';

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

test('verification mixed VRM instances: refresh missing bodies, preserve measured copies, then add', async () => {
  const h = harness(),
    measured = inspectAsset(vrmFixture()).model!,
    legacy = structuredClone(measured),
    id = `asset-${'a'.repeat(64)}`;
  delete legacy.vrm!.body;
  await Promise.resolve();
  h.editor.setEnabled(true);
  h.editor.open();
  try {
    await h.editor.import([{ id, name: 'legacy.vrm', width: 200, height: 200, model: legacy }]);
    await h.editor.execute({ type: 'duplicate' });
    const doc = structuredClone(h.editor.snapshot().document);
    (doc.decorations[0] as any).source = measured;
    h.set(doc);
    await h.editor.execute({ type: 'discard' });
    const ids = h.editor.snapshot().document.decorations.map((d) => d.id);
    await h.editor.import([{ id, name: 'measured.vrm', width: 200, height: 200, model: measured }]);
    expect(h.editor.snapshot().document.decorations.map((d) => d.id)).toEqual(ids);
    for (const d of h.editor.snapshot().document.decorations) expect(d).toMatchObject({ source: measured });
    await h.editor.execute({ type: 'undo' });
    expect((h.editor.snapshot().document.decorations[1] as any).source.vrm.body).toBeUndefined();
    await h.editor.execute({ type: 'redo' });
    await h.editor.import([{ id, name: 'measured.vrm', width: 200, height: 200, model: measured }]);
    expect(h.editor.snapshot().document.decorations).toHaveLength(3);
  } finally {
    h.editor.destroy();
  }
});
