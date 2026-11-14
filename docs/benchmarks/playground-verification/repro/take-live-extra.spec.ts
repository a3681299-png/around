// Focused real-site port check. The older wheel/HOLD test remains unchanged and red in both revisions.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openEditor } from '../../tests/helpers/editor';
import { waitForAdvertToEnd, declinePromotion } from '../../tests/helpers/youtube-live';
import { createTakeSampler } from '../../src/world/takes';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('real YouTube: record, save and reload a take through the page port, then export its backup', async () => {
  test.setTimeout(240000);
  const side = process.env.VERIFY_LABEL ?? 'after',
    result: any = { side };
  const context = await launchExtension(await mkdtemp(path.resolve('.work/take-live-')), false);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeEnabled();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 60000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    await page.bringToFront();
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const t = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          try {
            return (await chrome.tabs.sendMessage(t!.id!, { type: 'around:probe-editor-target' }))?.siteId;
          } catch {
            return null;
          }
        }),
      )
      .toBe('youtube');
    const { panel, studio } = await openEditor(popup, page);
    await panel.getByLabel('アニメーション素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.gif'));
    await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
    await panel.locator('.timeline-toggle').click();
    await panel.locator('.timeline-connect').click();
    await expect(panel.locator('.timeline-key')).toHaveCount(3);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await panel.locator('.take-record').click();
    await expect(panel.locator('.signal-timeline')).toHaveAttribute('data-recording', '');
    for (const fraction of [0, 0.5, 1, 0.5, 0]) {
      await page.evaluate(async (f) => {
        scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f);
        for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame);
      }, fraction);
      await page.waitForTimeout(150);
    }
    await panel.locator('.take-stop').click();
    await expect(panel.locator('.take-source')).toHaveText('PREVIEW');
    await panel.locator('.take-store').click();
    await expect(panel.locator('.take-saved')).toHaveText('テイク保存済み');
    const take = await popup.evaluate(async () => {
      const list = await chrome.runtime.sendMessage({
        type: 'around:signal-takes',
        action: 'list',
        siteId: 'youtube',
      });
      if (!list.ok || list.value.length !== 1) throw Error('Expected one stored take');
      const response = await chrome.runtime.sendMessage({
        type: 'around:signal-takes',
        action: 'get',
        siteId: 'youtube',
        id: list.value[0].id,
      });
      if (!response.ok) throw Error(response.error);
      return response.value;
    });
    expect(take.inputs.length).toBeGreaterThan(3);
    expect(JSON.stringify(take)).not.toMatch(/https?:|cookie|asset-|signalRules|decorations/);
    const design: any = await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    );
    expect(design).not.toHaveProperty('takes');
    result.recordedSamples = take.inputs.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    await expect(panel.locator('.take-library-select')).toBeEnabled();
    await expect(panel.locator(`.take-library-select option[value="${take.id}"]`)).toHaveCount(1);
    await panel.locator('.take-library-select').selectOption(take.id);
    await expect(panel.locator('.take-source')).toHaveText('PREVIEW');
    result.reloaded = true;
    const sample = take.inputs.find((input: (typeof take.inputs)[number]) => {
      const scroll = input.signals.scroll;
      return scroll?.maxY > 0 && scroll.y / scroll.maxY > 0.4 && scroll.y / scroll.maxY < 0.6;
    });
    expect(sample, 'The take must record actual scroll near the midpoint').toBeDefined();
    const time = sample.timeMs - take.inputs[0].timeMs;
    const expected = createTakeSampler(design, take).at(time).frame.layout.layers[0]!.layer.opacity;
    await panel.locator('.take-position').fill(String(time / 1000));
    await panel.locator('.take-position').press('Tab');
    const media = page.locator(`[data-image-id="${design.decorations[0].id}"] .media`);
    await expect.poll(() => media.evaluate((e: HTMLElement) => Number(e.style.opacity))).toBeCloseTo(expected, 5);
    result.previewed = true;
    const backup = await context.newPage();
    await backup.goto(`chrome-extension://${id}/backup/index.html`);
    await expect(backup.locator('#backup-export')).toBeEnabled();
    const downloaded = backup.waitForEvent('download');
    await backup.locator('#backup-export').click();
    const archive = path.resolve(`.work/evidence/live-take-${side}.aroundbackup`);
    await (await downloaded).saveAs(archive);
    const { size: bytes } = await stat(archive);
    expect(bytes).toBeGreaterThan(0);
    await context.close();

    // Exercise the real decoder in the extension worker, which can decode the GIF.
    const restoredContext = await launchExtension(await mkdtemp(path.resolve('.work/take-restore-')));
    try {
      const worker = restoredContext.serviceWorkers()[0] ?? (await restoredContext.waitForEvent('serviceworker'));
      const restored = await restoredContext.newPage();
      await restored.goto(`chrome-extension://${new URL(worker.url()).host}/backup/index.html`);
      await restored.locator('#backup-file').setInputFiles(archive);
      await restored.locator('#backup-inspect').click();
      await expect(restored.locator('#backup-restore')).toBeEnabled();
      await expect(restored.locator('.backup-summary')).toContainText(/作品 1件 \/ 素材 1個.*テイク 1個/);
      await restored.locator('#backup-restore').click();
      await expect(restored.locator('.backup-status')).toContainText('読み込みが完了');
      const restoredData = await restored.evaluate(async (id: string) => {
        const stored = (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'];
        const response = await chrome.runtime.sendMessage({
          type: 'around:signal-takes',
          action: 'get',
          siteId: 'youtube',
          id,
        });
        if (!response.ok) throw Error(response.error);
        return { design: stored, take: response.value };
      }, take.id);
      expect(restoredData).toEqual({ design, take });
      result.completed = true;
      result.samples = take.inputs.length;
      result.expectedOpacity = expected;
      result.backup = { bytes, designs: 1, takes: 1, assets: 1, restored: true };
    } finally {
      await restoredContext.close();
    }
  } finally {
    await mkdir('.work/evidence', { recursive: true });
    await writeFile(`.work/evidence/take-live-${side}.json`, JSON.stringify(result, null, 2));
    await context.close();
  }
});
