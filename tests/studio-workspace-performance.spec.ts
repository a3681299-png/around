import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import type { DesignDocument } from '../src/design/types';

const key = 'webWorldThemes.design.youtube', overlay = '#web-world-themes-decorations';
test('32 layers remain editable with locked/hidden selection; measure quick and live workspace costs', async ({ popup, youtube }, info) => {
  test.setTimeout(90_000); await youtube.setViewportSize({ width: 1366, height: 900 });
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const panel = youtube.locator('#web-world-themes-creator');
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator(overlay + ' [data-image-id]')).toHaveCount(1);
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  const saved = await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
  const decorations = Array.from({ length: 32 }, (_, i) => ({ ...saved.decorations[0]!, id: 'ui-' + i, name: '素材 ' + String(i + 1).padStart(2, '0'),
    locked: i % 8 === 0, visible: i % 8 !== 1, zIndex: i,
    placement: { ...saved.decorations[0]!.placement, x: .24 + i % 8 * .05, y: .32 + Math.floor(i / 8) * .09, widthPx: 48, heightPx: 48 } }));
  await popup.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), { key, value: { ...saved, decorations } });
  await expect(youtube.locator(overlay + ' [data-image-id]')).toHaveCount(32);
  const cdp = await youtube.context().newCDPSession(youtube); await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((item) => [item.name, item.value]));
  const samples: Record<string, unknown> = {};
  for (const [name, launcher] of [['quick', '#creator-editor-open'], ['inpage', '#creator-studio-inpage']]) {
    await popup.locator(launcher!).evaluate((button: HTMLButtonElement) => button.click());
    await panel.getByRole('button', { name: 'すべて選択', exact: true }).click(); await expect(panel.locator('.selected-count')).toHaveText('32個選択中');
    await youtube.bringToFront(); const before = await metrics();
    const measured = await youtube.evaluate(async () => {
      const calls: number[] = [], intervals: number[] = []; let last = performance.now();
      for (let i = -10; i < 60; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); const frame = performance.now();
        const start = performance.now(); document.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowLeft' : 'ArrowRight', code: i % 2 ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
        if (i >= 0) { calls.push(performance.now() - start); intervals.push(frame - last); } last = frame;
      }
      const stats = (values: number[]) => { const v = [...values].sort((a, b) => a - b); return { count: v.length, medianMs: v[Math.floor(v.length / 2)], p95Ms: v[Math.floor(v.length * .95)] }; };
      return { synchronousCommand: stats(calls), frameInterval: stats(intervals) };
    });
    const after = await metrics(); samples[name!] = { ...measured, taskMs: (after.TaskDuration! - before.TaskDuration!) * 1000, scriptMs: (after.ScriptDuration! - before.ScriptDuration!) * 1000,
      layoutMs: (after.LayoutDuration! - before.LayoutDuration!) * 1000, recalcStyleMs: (after.RecalcStyleDuration! - before.RecalcStyleDuration!) * 1000, jsHeapUsedMiB: after.JSHeapUsedSize! / 1024 / 1024 };
    expect(measured.synchronousCommand.count).toBe(60);
  }
  await expect(panel.locator('.layer')).toHaveCount(32); await expect(panel.locator('.layers')).toBeVisible();
  const scroll = await panel.locator('.layers').evaluate((node) => ({ height: node.clientHeight, scroll: node.scrollHeight })); expect(scroll.scroll).toBeGreaterThan(scroll.height);
  await panel.getByRole('button', { name: '画像を削除', exact: true }).click();
  await expect(panel.locator('.layer')).toHaveCount(4); // Locked layers survive; hidden unlocked layers are editable from the list.
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(panel.locator('.layer')).toHaveCount(32);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await youtube.screenshot({ path: info.outputPath('inpage-32-layers.png') });
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(panel).toHaveCount(0); await expect(youtube.locator(overlay)).toHaveCount(0);
  await expect(youtube.locator('#web-world-themes-studio-layout')).toHaveCount(0);
  const report = { browser: youtube.context().browser()?.version(), viewport: '1366x900', fixture: true, layers: 32, locked: 4, hidden: 4, warmupFrames: 10,
    scope: 'same extension, same document and nudge trace; current Quick UI vs new in-page Workbench; CDP task/style/layout and JS heap for the page',
    exclusions: 'not an old-commit comparison; GPU, browser process memory and real YouTube media/network excluded; heap is not a leak measurement', samples };
  await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/studio-workspace-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  await info.attach('studio-workspace-benchmark', { body: JSON.stringify(report, null, 2), contentType: 'application/json' }); await cdp.detach();
});
