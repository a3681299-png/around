import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { image, isolate, media, open, save, watch } from './helpers/world-host';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { defaultCircleMask } from '../src/effects/types';
import type { DesignDocument } from '../src/design/types';

test('scroll geometry and signal callbacks share one evaluation; 32 layers / 16 group masks keep identical output', async ({ popup, youtube, extensionId }, info) => {
  test.setTimeout(90_000);
  const panel = await open(popup, youtube); await image(panel, youtube); await save(panel); await watch(youtube);
  const key = 'webWorldThemes.design.youtube', original = await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
  const decorations = Array.from({ length: 32 }, (_, i) => ({ ...original.decorations[0]!, id: `image-${i}`, visible: true, opacity: 1,
    placement: { anchor: { kind: 'viewport' as const }, x: .1 + i % 8 * .1, y: .2 + Math.floor(i / 8) * .15, widthPx: 90, heightPx: 70, rotationDeg: 0 }, zIndex: i % 2 }));
  const groups = Array.from({ length: 16 }, (_, i) => ({ kind: 'group' as const, id: `group-${i}`, name: `World ${i}`, children: [`image-${i * 2}`, `image-${i * 2 + 1}`], visible: true, locked: false, opacity: .8, zIndex: i, effects: [defaultCircleMask()] }));
  await popup.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), { key, value: { ...original, baseThemeId: null, decorations, groups, signalRules: decorations.map((layer) => defaultScrollOpacityRule(layer.id)) } });
  await expect(youtube.locator(media)).toHaveCount(32); await youtube.evaluate(() => { document.body.style.minHeight = '12000px'; });
  const runtime = await isolate(youtube, extensionId), results: Record<string, { samples: number[]; opacity: string[] }> = {};
  try {
    for (const mode of ['before', 'coalesced']) {
      await runtime.evaluate('globalThis.__wwSignalSamples = []');
      const bundle = await build({ entryPoints: ['src/content/index.ts'], bundle: true, write: false, target: 'chrome120', format: 'iife', loader: { '.css': 'text' },
        plugins: [{ name: 'test-only-evaluation-meter', setup(builder) { builder.onLoad({ filter: /[\\/]host[\\/]world-session\.ts$/ }, async ({ path }) => {
          let contents = await readFile(path, 'utf8');
          if (mode === 'before') contents = contents.replace(/const reconcile = \(\) => \{[\s\S]*?\n  \};/, (block) => block.replaceAll('    cancel();\n', ''));
          const expression = 'overridden ?? evaluatePreparedWorld(prepared, state, input, context.scene.signalRules)';
          if (!contents.includes(expression)) throw new Error('Evaluation meter must be updated');
          contents = contents.replace(expression, `(() => { const start = performance.now(); const result = ${expression}; (globalThis as any).__wwSignalSamples.push(performance.now() - start); return result; })()`);
          return { contents, loader: 'ts' };
        }); } }], logLevel: 'silent' });
      await runtime.evaluate(bundle.outputFiles[0]!.text); await expect(youtube.locator(media)).toHaveCount(32); await youtube.waitForTimeout(120);
      results[mode] = await runtime.evaluate(`(async () => {
        globalThis.__wwSignalSamples = []; const opacity = [];
        for (let i = 1; i <= 120; i++) {
          const root = document.scrollingElement; scrollTo(0, Math.round((root.scrollHeight - root.clientHeight) * (i % 60) / 60));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          opacity.push(document.querySelector('#web-world-themes-decorations').shadowRoot.querySelector('.media').style.opacity);
        }
        return { samples: globalThis.__wwSignalSamples, opacity };
      })()`);
    }
    const before = results['before']!, current = results['coalesced']!;
    expect(current.opacity).toEqual(before.opacity); expect(current.samples.length).toBeGreaterThanOrEqual(118);
    expect(current.samples.length).toBeLessThan(before.samples.length * .75);
    const stats = (samples: number[]) => { const sorted = [...samples].sort((a, b) => a - b); return { evaluations: samples.length, totalMs: samples.reduce((a, b) => a + b, 0), medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] }; };
    const report = { browser: youtube.context().browser()?.version(), media: 32, groupMasks: 16, rules: 32, scrollSteps: 120, before: stats(before.samples), coalesced: stats(current.samples),
      includes: 'numeric World evaluation only, isolated-world performance.now', excludes: 'DOM writes, layout, paint, GPU, decoding, browser wait; timer precision applies' };
    await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/signal-browser-benchmark.json', JSON.stringify(report, null, 2));
    await info.attach('scroll-evaluations', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  } finally { await runtime.session.detach(); }
});
