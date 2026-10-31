import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import { launchExtension } from './fixtures';
import { openEditor, openSidePanelFromIcon } from './helpers/editor';
import { sidePanelDriver } from './helpers/side-panel';
import type { DesignDocument } from '../src/design/types';

const key = 'webWorldThemes.design.youtube',
  overlay = '#web-world-themes-decorations';

/** The page's cost of 60 keyboard nudges of 32 selected layers, while one editor holds the edit. */
async function nudge(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((item) => [item.name, item.value]));
  const before = await metrics();
  const measured = await page.evaluate(async () => {
    const calls: number[] = [],
      intervals: number[] = [];
    let last = performance.now();
    for (let i = -10; i < 60; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const frame = performance.now();
      const start = performance.now();
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: i % 2 ? 'ArrowLeft' : 'ArrowRight',
          code: i % 2 ? 'ArrowLeft' : 'ArrowRight',
          bubbles: true,
        }),
      );
      if (i >= 0) {
        calls.push(performance.now() - start);
        intervals.push(frame - last);
      }
      last = frame;
    }
    const stats = (values: number[]) => {
      const v = [...values].sort((a, b) => a - b);
      return { count: v.length, medianMs: v[Math.floor(v.length / 2)], p95Ms: v[Math.floor(v.length * 0.95)] };
    };
    return { synchronousCommand: stats(calls), frameInterval: stats(intervals) };
  });
  const after = await metrics();
  await cdp.detach();
  return {
    ...measured,
    taskMs: (after.TaskDuration! - before.TaskDuration!) * 1000,
    scriptMs: (after.ScriptDuration! - before.ScriptDuration!) * 1000,
    layoutMs: (after.LayoutDuration! - before.LayoutDuration!) * 1000,
    recalcStyleMs: (after.RecalcStyleDuration! - before.RecalcStyleDuration!) * 1000,
    jsHeapUsedMiB: after.JSHeapUsedSize! / 1024 / 1024,
  };
}

test('32 layers remain editable with locked/hidden selection; measure the page while the side panel or the window edits', async ({}, info) => {
  // UI0-d 3.1: the comparison is now the editor's two places, the side panel (S) and its window (W),
  // on one extension, one document and one nudge trace. The side panel needs a headed browser.
  test.setTimeout(120_000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-workspace-perf-')), true, {
    headed: true,
  });
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const youtube = await context.newPage();
    await youtube.goto('https://www.youtube.com/watch?v=fixture');
    await popup.getByRole('switch', { name: 'テーマを使う' }).check();
    let { panel, studio } = await openEditor(popup, youtube);
    await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await expect(youtube.locator(overlay + ' [data-image-id]')).toHaveCount(1);
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
    await studio.close();
    const saved = await popup.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument,
      key,
    );
    const decorations = Array.from({ length: 32 }, (_, i) => ({
      ...saved.decorations[0]!,
      id: 'ui-' + i,
      name: '素材 ' + String(i + 1).padStart(2, '0'),
      locked: i % 8 === 0,
      visible: i % 8 !== 1,
      zIndex: i,
      placement: {
        ...saved.decorations[0]!.placement,
        x: 0.24 + (i % 8) * 0.05,
        y: 0.32 + Math.floor(i / 8) * 0.09,
        widthPx: 48,
        heightPx: 48,
      },
    }));
    await popup.evaluate(async ({ key, value }) => chrome.storage.local.set({ [key]: value }), {
      key,
      value: { ...saved, decorations },
    });
    await expect(youtube.locator(overlay + ' [data-image-id]')).toHaveCount(32);
    const samples: Record<string, unknown> = {};
    // S: Chrome's side panel, opened from the in-video icon.
    await openSidePanelFromIcon(popup, youtube);
    const side = await sidePanelDriver(context, youtube, id);
    await side.click('.select-all');
    await expect.poll(() => side.text('.selected-count')).toBe('32個選択中');
    await youtube.bringToFront();
    samples.sidepanel = await nudge(youtube);
    expect((samples.sidepanel as { synchronousCommand: { count: number } }).synchronousCommand.count).toBe(60);
    const tab = Number(await side.evaluate<string>('new URL(location.href).searchParams.get("target")'));
    await side.detach();
    await popup.evaluate(async (tabId) => {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.sidePanel.setOptions({ tabId, enabled: true });
    }, tab);
    // W: the editor's window (as a tab), on the same draft.
    ({ panel, studio } = await openEditor(popup, youtube));
    await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
    await expect(panel.locator('.selected-count')).toHaveText('32個選択中');
    await youtube.bringToFront();
    samples.window = await nudge(youtube);
    expect((samples.window as { synchronousCommand: { count: number } }).synchronousCommand.count).toBe(60);
    await expect(panel.locator('.layer')).toHaveCount(32);
    await expect(panel.locator('.layers')).toBeVisible();
    const scroll = await panel
      .locator('.layers')
      .evaluate((node) => ({ height: node.clientHeight, scroll: node.scrollHeight }));
    expect(scroll.scroll).toBeGreaterThan(scroll.height);
    await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
    await panel.getByRole('button', { name: '画像を削除', exact: true }).click();
    await expect(panel.locator('.layer')).toHaveCount(4); // Locked layers survive; hidden unlocked layers are editable from the list.
    await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(panel.locator('.layer')).toHaveCount(32);
    await panel.getByRole('button', { name: '変更を破棄', exact: true }).click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await studio.screenshot({ path: info.outputPath('window-32-layers.png') });
    await popup.getByRole('switch', { name: 'テーマを使う' }).uncheck();
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
    await expect(youtube.locator(overlay)).toHaveCount(0);
    const report = {
      browser: context.browser()?.version(),
      fixture: true,
      layers: 32,
      locked: 4,
      hidden: 4,
      warmupFrames: 10,
      scope:
        'same extension, same document and nudge trace; the side panel (S) vs the editor window (W) holding the edit; CDP task/style/layout and JS heap for the YouTube page',
      exclusions:
        'not an old-commit comparison; GPU, browser process memory and real YouTube media/network excluded; heap is not a leak measurement',
      samples,
    };
    await mkdir('.work/verification', { recursive: true });
    await writeFile('.work/verification/studio-workspace-benchmark.json', JSON.stringify(report, null, 2) + '\n');
    await info.attach('studio-workspace-benchmark', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await context.close();
  }
});
