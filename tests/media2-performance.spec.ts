import { exposeEditorControls } from './helpers/editor-workspace';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from './fixtures';

const overlay = '#web-world-themes-decorations',
  layers = `${overlay} [data-image-id]`;
const cases = [
  { name: '10 GIF / native', file: 'medium.gif', count: 10, controlled: false, scroll: false },
  { name: '10 GIF / controlled', file: 'medium.gif', count: 10, controlled: true, scroll: false },
  { name: '3 alpha WebM / 1080p', file: 'alpha1080.webm', count: 3, controlled: false, scroll: false },
  { name: '45s WebM / scrolling player anchor', file: 'long.webm', count: 3, controlled: false, scroll: true },
  { name: '10 GIF / native / scrolling player anchor', file: 'medium.gif', count: 10, controlled: false, scroll: true },
];

for (const [index, scenario] of cases.entries())
  test(`media benchmark: ${scenario.name}`, async ({ popup, youtube, context }, info) => {
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await youtube.bringToFront();
    await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
    const panel = youtube.getByRole('dialog', { name: 'デザインエディター' });
    await expect(async () => {
      if (!(await panel.isVisible()))
        await popup.locator('#creator-editor-open').evaluate((n: HTMLButtonElement) => n.click());
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await exposeEditorControls(panel);
    if (scenario.scroll) {
      await youtube.locator('#navigate').evaluate((n: HTMLButtonElement) => n.click());
      await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
    }
    for (let remaining = scenario.count; remaining > 0; remaining -= 8) {
      await panel
        .getByLabel('アニメーション素材を追加')
        .setInputFiles(Array(Math.min(8, remaining)).fill(path.resolve(`tests/fixtures/motion/${scenario.file}`)));
      await expect(youtube.locator(layers)).toHaveCount(scenario.count - Math.max(0, remaining - 8));
      await expect(panel.getByRole('button', { name: 'アニメーションを追加', exact: true })).toBeEnabled();
    }
    await expect(youtube.locator(layers)).toHaveCount(scenario.count);
    if (scenario.controlled || scenario.scroll)
      for (const row of await panel.locator('[data-layer-id]').all()) {
        await row.locator('[data-action="select"]').click();
        if (scenario.controlled) await panel.getByLabel('再生方式', { exact: true }).selectOption('controlled');
        if (scenario.scroll) await panel.getByLabel('配置の基準').selectOption('video-player');
      }
    await expect(youtube.locator(`${layers} .media[data-playback="playing"]`)).toHaveCount(scenario.count);
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    await expect(panel.locator('.status')).toHaveText('保存しました。');
    await panel.getByRole('button', { name: '編集を終了' }).click();
    if (scenario.scroll)
      await youtube.evaluate(() => {
        document.body.style.minHeight = '1800px';
      });
    const session = await context.newCDPSession(youtube),
      browser = context.browser(),
      root = browser ? await browser.newBrowserCDPSession() : undefined;
    await session.send('Performance.enable');
    let gpu: unknown = 'unavailable';
    try {
      const info = await root?.send('SystemInfo.getInfo');
      gpu = info?.gpu ? { devices: info.gpu.devices, renderer: info.gpu.auxAttributes?.['glRenderer'] } : 'unavailable';
    } catch {
      /* GPU execution time and VRAM remain unmeasured. */
    }
    await youtube.waitForTimeout(200);
    const before = await session.send('Performance.getMetrics'),
      processBefore = await root?.send('SystemInfo.getProcessInfo').catch(() => undefined);
    const collectGpu = process.env.WW_GPU_METRICS === '1' && process.platform === 'win32' && processBefore;
    const osMetrics = collectGpu
      ? promisify(execFile)(
          path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            path.resolve('scripts/measure-gpu.ps1'),
            '-ProcessList',
            processBefore.processInfo.map((p) => p.id).join(','),
          ],
          { timeout: 20_000, maxBuffer: 262_144, windowsHide: true },
        ).then(({ stdout }) => JSON.parse(stdout) as unknown)
      : undefined;
    const intervals = await youtube.evaluate(
      (scroll) =>
        new Promise<number[]>((resolve) => {
          const samples: number[] = [];
          let start: number | undefined, previous: number | undefined;
          const tick = (time: number) => {
            start ??= time;
            if (previous !== undefined) samples.push(time - previous);
            previous = time;
            if (scroll) window.scrollTo(0, 70 + 60 * Math.sin((time - start) / 180));
            if (time - start >= 1800) resolve(samples);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      scenario.scroll,
    );
    const windowsResources = osMetrics ? await osMetrics : undefined;
    const after = await session.send('Performance.getMetrics'),
      processAfter = await root?.send('SystemInfo.getProcessInfo').catch(() => undefined);
    const metric = (data: typeof before, name: string) => data.metrics.find((m) => m.name === name)!.value;
    const times = [...intervals].sort((a, b) => a - b),
      round = (n: number) => Math.round(n * 100) / 100;
    const cpu =
      processBefore && processAfter
        ? processAfter.processInfo.map((p) => ({
            type: p.type,
            ms:
              Math.max(
                0,
                p.cpuTime - (processBefore.processInfo.find((old) => old.id === p.id)?.cpuTime ?? p.cpuTime),
              ) * 1000,
          }))
        : undefined;
    const stats = JSON.parse((await youtube.locator(overlay).getAttribute('data-ww-media-stats'))!) as {
      encodedBytes: number;
      decodedBytes: number;
      cacheBytes: number;
      peakDecodedBytes: number;
      inFlight: number;
    };
    const result = {
      name: scenario.name,
      browser: browser?.version(),
      sampledMs: round(intervals.reduce((a, b) => a + b, 0)),
      metricsWindowMs: round((metric(after, 'Timestamp') - metric(before, 'Timestamp')) * 1000),
      count: scenario.count,
      scriptMs: round((metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000),
      mainTaskMs: round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000),
      processCpuMs: cpu ? round(cpu.reduce((n, p) => n + p.ms, 0)) : null,
      gpuProcessCpuMs: cpu ? round(cpu.filter((p) => p.type === 'GPU').reduce((n, p) => n + p.ms, 0)) : null,
      jsHeapMiB: round(metric(after, 'JSHeapUsedSize') / 1024 / 1024),
      rafMedianMs: round(times[Math.floor(times.length * 0.5)]!),
      rafP95Ms: round(times[Math.floor(times.length * 0.95)]!),
      intervalsOver25ms: times.filter((n) => n > 25).length,
      stats,
      gpu,
      processTypes: [...new Set(processBefore?.processInfo.map((p) => p.type) ?? [])],
      ...(windowsResources ? { windowsResources } : {}),
      unmeasured: [
        'GPU execution time',
        'exact physical VRAM residency',
        'browser internal decoded-frame/cache memory',
      ],
      fixture: true,
    };
    expect(times.length).toBeGreaterThan(20);
    expect(stats.peakDecodedBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(stats.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(stats.encodedBytes).toBeLessThanOrEqual(96 * 1024 * 1024);
    await mkdir('.work/verification', { recursive: true });
    const output = collectGpu
      ? '.work/verification/media2-performance-gpu-run.json'
      : '.work/verification/media2-performance.json';
    let results: { name: string }[] = [];
    if (index)
      try {
        results = JSON.parse(await readFile(output, 'utf8'));
      } catch {
        /* Individual cases can run on their own. */
      }
    results = results.filter((entry) => entry.name !== result.name);
    results.push(result);
    await writeFile(output, JSON.stringify(results, null, 2));
    await info.attach('media-benchmark', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    await root?.detach();
    await session.detach();
  });
