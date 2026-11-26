import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { image, isolate, media, open, reinject, save, watch } from './helpers/world-host';
import { defaultCircleMask } from '../src/effects/types';
import type { DesignDocument } from '../src/design/types';

test('measure old/new browser callbacks with identical 32-media / 16-group pointer traces', async ({
  popup,
  youtube,
  extensionId,
}, info) => {
  test.setTimeout(90_000);
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  await save(panel);
  await watch(youtube);
  const key = 'around.design.youtube';
  const original = await popup.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument,
    key,
  );
  const decorations = Array.from({ length: 32 }, (_, i) => ({
    ...original.decorations[0]!,
    id: `image-${i}`,
    name: `world-${i}`,
    placement: {
      anchor: { kind: 'viewport' as const },
      x: 0.15 + (i % 8) * 0.1,
      y: 0.2 + Math.floor(i / 8) * 0.18,
      widthPx: 90,
      heightPx: 70,
      rotationDeg: i * 5,
    },
    visible: true,
    opacity: 1,
    zIndex: i % 3,
    effects: [defaultCircleMask()],
  }));
  const groups = Array.from({ length: 16 }, (_, i) => ({
    kind: 'group' as const,
    id: `group-${i}`,
    name: `world-${i}`,
    children: [`image-${i * 2}`, `image-${i * 2 + 1}`],
    visible: true,
    locked: false,
    opacity: 0.8,
    zIndex: i % 3,
    effects: [defaultCircleMask()],
  }));
  await popup.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), {
    key,
    value: { ...original, baseThemeId: null, decorations, groups },
  });
  await expect(youtube.locator(media)).toHaveCount(32);
  const runtime = await isolate(youtube, extensionId);
  await runtime.evaluate(`(() => {
    globalThis.__aroundPerfSamples = [];
    globalThis.__aroundPerfNativeFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => __aroundPerfNativeFrame(time => {
      const start = performance.now(); callback(time); __aroundPerfSamples.push(performance.now() - start);
    });
  })()`);
  const samples: Record<'legacy' | 'runtime', number[]> = { legacy: [], runtime: [] };
  let baseline: string[] | undefined;
  const order = ['legacy', 'runtime', 'runtime', 'legacy'] as const;
  for (const mode of order) {
    await reinject(runtime, mode, false);
    await expect(youtube.locator(`${media}[data-playback="still"]`)).toHaveCount(32);
    const values = await runtime.evaluate<number[]>(`(async () => {
      for (let i = -15; i < 80; i++) {
        if (i === 0) __aroundPerfSamples = [];
        document.dispatchEvent(new PointerEvent('pointermove', { isPrimary: true, pointerId: 17, clientX: 80 + ((i + 15) * 13 % 900), clientY: 120 + ((i + 15) * 7 % 450) }));
        await new Promise(resolve => __aroundPerfNativeFrame(resolve));
      }
      return __aroundPerfSamples;
    })()`);
    expect(values.length).toBeGreaterThanOrEqual(80);
    expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    samples[mode].push(...values);
    const painted = await youtube
      .locator('#around-decorations .group-content, #around-decorations .media')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.maskImage));
    expect(painted).toHaveLength(48);
    if (baseline) expect(painted).toEqual(baseline);
    else baseline = painted;
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b),
      round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      samples: sorted.length,
      medianMs: round(sorted[Math.floor(sorted.length / 2)]!),
      p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]!),
      meanMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    };
  };
  const report = {
    browser: youtube.context().browser()?.version(),
    media: 32,
    groups: 16,
    measuredPointerFramesPerRound: 80,
    warmupFramesPerRound: 15,
    order,
    includes: 'actual extension RAF callback: numeric evaluation, CSS writes and visibility callbacks',
    excludes: 'asynchronous layout/paint, GPU, decoding, input dispatch and RAF wait',
    timing: 'isolated-world performance.now; browser timer precision applies',
    legacy: stats(samples.legacy),
    runtime: stats(samples.runtime),
  };
  await mkdir('.work/verification', { recursive: true });
  await writeFile('.work/verification/world-browser-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  await info.attach('world-browser-benchmark', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  await runtime.session.detach();
});
