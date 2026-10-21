import { test } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { createEditorSession } from '../src/editor-core/session';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { createStudioStateEncoder } from '../src/studio/state-sync';
import { packCheckpoint } from '../src/studio/checkpoint-codec';

test('editor benchmark: placements and Studio wire bytes (informational, no performance threshold)', async ({}, info) => {
  const results = [];
  for (const keys of [0, 8, 64]) {
    const doc = emptyDesign('youtube', 'retro');
    doc.decorations = Array.from({ length: 32 }, (_, index) => ({
      kind: 'image',
      id: `image-${index}`,
      assetId: `asset-${'a'.repeat(64)}`,
      name: `Layer ${index}`,
      placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 200, heightPx: 160, rotationDeg: 0 },
      opacity: 1,
      zIndex: index,
      visible: true,
      locked: false,
    }));
    if (keys)
      doc.signalRules = doc.decorations.map((layer) => ({
        ...defaultScrollOpacityRule(layer.id),
        keyframes: Array.from({ length: keys }, (_, index) => ({
          id: `key-${index}`,
          input: index / (keys - 1),
          value: index % 2,
          easing: 'linear',
        })),
      }));
    let serial = 0;
    const editor = createEditorSession({
      siteId: 'youtube',
      baseThemeId: 'retro',
      targets: [],
      makeId: () => `session-${++serial}`,
      validate: (value) => {
        if (value) parseDesign(value);
      },
      geometry: {
        frameFor: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
        samples: () => [],
        importFrame: () => ({ width: 1920, height: 1080, origin: { x: 960, y: 540 } }),
      },
      storage: {
        read: async () => doc,
        watch: (accept) => {
          accept(doc);
          return () => {};
        },
        retain: async () => {},
        release: async () => {},
        validate: async () => {},
        save: async () => {},
        import: async () => [],
        cancelImport() {},
      },
    });
    editor.setEnabled(true);
    editor.open();
    const times = [];
    const encoder = createStudioStateEncoder();
    for (let index = 0; index < 110; index++) {
      const placement = { ...doc.decorations[0]!.placement, x: 0.4 + index / 1000 };
      if (index === 109) encoder.encode(editor.snapshot(), editor.checkpoint());
      const start = performance.now();
      await editor.execute({ type: 'placements', changes: [{ id: 'image-0', placement }] });
      if (index >= 10) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const start = performance.now();
    const message = JSON.stringify({ type: 'state', ...encoder.encode(editor.snapshot(), editor.checkpoint()) });
    const encodeMs = performance.now() - start;
    results.push({
      layers: 32,
      rules: keys ? 32 : 0,
      keys,
      documentBytes: Buffer.byteLength(JSON.stringify(doc)),
      samples: times.length,
      placementsMedianMs: times[Math.floor(times.length / 2)],
      placementsMaxMs: times.at(-1),
      historyEntries: editor.checkpoint().history.past.length,
      studioBytes: Buffer.byteLength(message),
      encodeMs,
      recoveryBytes: Buffer.byteLength(JSON.stringify(packCheckpoint(editor.checkpoint()))),
    });
    editor.destroy();
  }
  console.log(`EDITOR_BENCHMARK ${JSON.stringify(results)}`);
  await info.attach('editor-benchmark.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});
