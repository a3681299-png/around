import { test, expect } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openEditor, closeEditorPages } from '../../tests/helpers/editor';
import { waitForAdvertToEnd, declinePromotion } from '../../tests/helpers/youtube-live';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('same Playground artwork on real YouTube', async () => {
  const label = process.env.VERIFY_LABEL ?? 'after';
  await mkdir('.work/evidence', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/live-')), false);
  const result: any = { label, states: {} };
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeEnabled();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 60000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    await page.bringToFront();
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          if (tab?.id === undefined) return null;
          try {
            return (
              (await chrome.tabs.sendMessage(tab.id, { type: 'web-world-themes:probe-editor-target' }))?.siteId ?? null
            );
          } catch {
            return null;
          }
        }),
      )
      .toBe('youtube');
    const source = path.resolve('.work/playground/content');
    const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
    const design = JSON.parse(await readFile(path.join(source, 'design.json'), 'utf8'));
    const editor = await openEditor(popup, page);
    const files: any[] = Object.values(manifest.assets);
    await editor.panel
      .locator('.model-file')
      .setInputFiles(path.join(source, files.find((e) => e.file.endsWith('.vrm')).file));
    await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    await editor.panel
      .getByLabel('画像素材を追加')
      .setInputFiles(path.join(source, files.find((e) => e.file.endsWith('.png')).file));
    await expect(editor.panel.locator('.layer')).toHaveCount(2);
    await editor.panel.locator('.save').click();
    await expect(editor.panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    design.siteId = 'youtube';
    // Position comparison uses the same decoration document. Playground-only skin targets
    // (page/primary-heading) are not YouTube target IDs and are deliberately omitted.
    design.rules = design.rules.filter((r: any) => r.target === 'video-card');
    await popup.evaluate(async (d) => {
      await chrome.storage.local.set({ 'webWorldThemes.design.youtube': d });
    }, design);
    const media = page.locator('.model-media');
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    await page.mouse.move(10, 10);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(1500);
    async function snapshot(name: string, expectedY = 0) {
      // y=0 is the exact Playground placement. On YouTube it can be wholly clipped by the
      // native header/top control band, so this pass measures geometry and records the pixels.
      // The separate y=.45 pass below requires actual rendered pixels.
      if (expectedY !== 0)
        await expect
          .poll(
            () =>
              media.locator('canvas').evaluate(
                (c: HTMLCanvasElement) =>
                  c
                    .getContext('2d')!
                    .getImageData(0, 0, c.width, c.height)
                    .data.filter((v, i) => i % 4 === 3 && v > 0).length,
              ),
            { timeout: 20000 },
          )
          .toBeGreaterThan(50);
      result.states[name] = await media.evaluate((m: HTMLElement) => {
        const layer = m.closest('[data-image-id="resident"]') as HTMLElement;
        const p =
          document.querySelector('[data-ww-surface~="player-window"]') ?? document.querySelector('#movie_player');
        const r = layer.getBoundingClientRect(),
          pr = p!.getBoundingClientRect();
        const canvas = m.querySelector('canvas')!;
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          player: pr.toJSON(),
          character: r.toJSON(),
          normalized: { x: (r.x + r.width / 2 - pr.x) / pr.width, y: (r.y + r.height / 2 - pr.y) / pr.height },
          painted: pixels.filter((v, i) => i % 4 === 3 && v > 0).length,
          safety: document.documentElement.getAttribute('data-ww-safety'),
          viewport: [innerWidth, innerHeight],
          url: location.href,
        };
      });
      if (expectedY !== 0) expect(result.states[name].painted).toBeGreaterThan(50);
      expect(result.states[name].normalized.x).toBeCloseTo(0.86, 2);
      expect(result.states[name].normalized.y).toBeCloseTo(expectedY, 2);
      await page.screenshot({ path: `.work/evidence/live-${label}-${name}.png` });
    }
    await snapshot('watch');
    const button = page.locator('.ytp-play-button');
    result.nativeHit = await button.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(result.nativeHit).toBe(true);
    // Chrome's extension command is native UI; Playwright's synthetic page key cannot invoke
    // it headlessly. Exercise the same emergency store through its public popup control.
    await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
    await expect(media).toHaveCount(0);
    await popup.getByRole('button', { name: /再開/ }).click();
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    result.emergency = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    await page.waitForTimeout(1500);
    await snapshot('reload');
    const visible = structuredClone(design);
    visible.decorations.find((d: any) => d.kind === 'model3d').placement.y = 0.45;
    await popup.evaluate(async (d) => {
      await chrome.storage.local.set({ 'webWorldThemes.design.youtube': d });
    }, visible);
    await expect
      .poll(() =>
        page
          .locator('[data-image-id="resident"]')
          .boundingBox()
          .then((b) => b?.y),
      )
      .not.toBe(result.states.reload.character.y);
    await snapshot('visible-reference', 0.45);
    const oldPaused = await page
      .locator('video')
      .first()
      .evaluate((v: HTMLVideoElement) => v.paused);
    await button.click();
    await expect
      .poll(() =>
        page
          .locator('video')
          .first()
          .evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(!oldPaused);
    result.nativeClick = true;
    result.video = await page
      .locator('video')
      .first()
      .evaluate((v: HTMLVideoElement) => ({
        ready: v.readyState,
        error: v.error?.code ?? null,
        paused: v.paused,
        time: v.currentTime,
      }));
  } finally {
    await writeFile(`.work/evidence/live-${label}.json`, JSON.stringify(result, null, 2));
    await context.close();
  }
});
