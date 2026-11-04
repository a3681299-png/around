// Private avatar screenshots and traces stay local, outside report/evidence commits.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openEditor, closeEditorPages } from '../../tests/helpers/editor';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const model = process.env.WW_VRM_FILE ?? 'C:/Users/sm787/Desktop/ローポリモデル用/out/trusie.vrm';
const motionRoot = process.env.WW_VRMA_DIR ?? 'C:/Users/sm787/Desktop/ローポリモデル用/out/anim';
for (const label of ['before', 'after'])
  test(`R31 live visual ${label}: default placement, player placement, native input and emergency OFF`, async () => {
    test.skip(process.env.WW_R31_LIVE !== '1');
    test.setTimeout(240000);
    const instrumented = process.env.R31_VISUAL_PROBE === '1',
      shot = (instrumented ? 'probe-' : '') + label;
    const result: any = { label, instrumented };
    await mkdir('.work/r31-private', { recursive: true });
    const extensionPath = path.resolve(
      label === 'before'
        ? '../r31-before/.work/' + (instrumented ? 'r31-perf' : 'r31-normal')
        : '.work/' + (instrumented ? 'r31-perf' : 'r31-normal'),
    );
    const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-r31-visual-')), false, {
      headed: true,
      width: 1938,
      height: 1176,
      extensionPath,
    });
    try {
      const manager = await context.newPage();
      await manager.goto('chrome://extensions/');
      const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
      await item.waitFor();
      const id = await item.evaluate((e: any) => e.data?.id ?? e.id);
      await manager.close();
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      const youtube = await context.newPage();
      await youtube.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
      await expect(youtube.locator('#movie_player')).toBeVisible({ timeout: 45000 });
      await popup.getByRole('switch', { name: '作品を表示する' }).check();
      const { panel } = await openEditor(popup, youtube);
      await panel.locator('.model-file').setInputFiles(path.resolve(model));
      const media = youtube.locator('.model-media');
      await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 100000 });
      await panel.locator('[data-image-prop="widthPx"]').fill('210');
      await panel.locator('[data-image-prop="heightPx"]').fill('280');
      await panel.locator('[data-image-prop="heightPx"]').press('Tab');
      await youtube.waitForTimeout(1200);
      await youtube.screenshot({ path: `.work/r31-private/${shot}-default.png` });
      result.default = await media.evaluate((e: any) => ({
        rect: e.getBoundingClientRect().toJSON(),
        clip: getComputedStyle(e.parentElement).clipPath,
        frame: e.dataset.modelFrame,
        pose: e.dataset.vrmPose,
      }));
      await panel.locator('[data-image-prop="anchor"]').selectOption('video-player');
      await panel.locator('[data-image-prop="x"]').fill('75');
      await panel.locator('[data-image-prop="y"]').fill('45');
      await panel.locator('[data-image-prop="y"]').press('Tab');
      if (label === 'after') {
        await panel.locator('.character-file').setInputFiles(path.join(motionRoot, 'trusie', 'idle.vrma'));
        await expect(panel.locator('.character-motions li')).toHaveCount(1, { timeout: 60000 });
        result.body = await panel.locator('.character-body').textContent();
      }
      await panel.locator('.save').click();
      await expect(panel.locator('.dirty')).toHaveText('保存済み');
      await closeEditorPages(youtube);
      await youtube.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await youtube.mouse.move(10, 10);
      await youtube.waitForTimeout(1200);
      result.player = await media.evaluate((e: any) => ({
        rect: e.getBoundingClientRect().toJSON(),
        pointerEvents: getComputedStyle(e).pointerEvents,
        playback: e.dataset.playback,
        frame: JSON.parse(e.dataset.modelFrame),
        pose: e.dataset.vrmPose,
      }));
      result.canvas = await media.locator('canvas').evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        return { width: c.width, height: c.height, painted: d.filter((v, i) => i % 4 === 3 && v > 0).length };
      });
      expect(result.canvas.painted).toBeGreaterThan(100);
      await youtube.screenshot({ path: `.work/r31-private/${shot}-player.png` });
      result.viewport = await youtube.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        hidden: document.hidden,
        dpr: devicePixelRatio,
      }));
      result.native = await youtube.locator('.ytp-play-button').evaluate((e) => {
        const r = e.getBoundingClientRect();
        return {
          rect: r.toJSON(),
          hit: e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        };
      });
      expect(result.native.hit).toBe(true);
      await youtube.locator('.ytp-play-button').click();
      const paused = await youtube
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) => v.paused);
      await youtube.locator('.ytp-play-button').click();
      await expect
        .poll(() =>
          youtube
            .locator('video')
            .first()
            .evaluate((v: HTMLVideoElement) => v.paused),
        )
        .toBe(!paused);
      // Put this same animated 3D character directly over a real native control, then compare
      // its actual pixels with artwork OFF. A click-through DOM hit alone would miss occlusion.
      const subscribe = youtube.locator('#subscribe-button button').filter({ visible: true }).first();
      const control = await subscribe.boundingBox();
      expect(control).toBeTruthy();
      const edit = await openEditor(popup, youtube);
      await edit.panel.locator('.layer').first().click();
      await edit.panel.locator('[data-image-prop="anchor"]').selectOption('viewport');
      await edit.panel
        .locator('[data-image-prop="x"]')
        .fill(((100 * (control!.x + control!.width / 2)) / result.viewport.width).toFixed(2));
      await edit.panel
        .locator('[data-image-prop="y"]')
        .fill(((100 * (control!.y + control!.height / 2)) / result.viewport.height).toFixed(2));
      await edit.panel.locator('[data-image-prop="y"]').press('Tab');
      await edit.panel.locator('.save').click();
      await expect(edit.panel.locator('.dirty')).toHaveText('保存済み');
      await closeEditorPages(youtube);
      await youtube
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) => v.pause());
      await youtube.mouse.move(10, 10);
      const show = popup.getByRole('switch', { name: '作品を表示する' });
      await show.uncheck();
      await youtube.bringToFront();
      await expect(media).toHaveCount(0);
      const reference = await subscribe.screenshot({ animations: 'disabled' });
      await show.check();
      await youtube.bringToFront();
      await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 100000 });
      await youtube.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      result.overControl = await media.boundingBox();
      expect(
        Math.abs(result.overControl.x + result.overControl.width / 2 - control!.x - control!.width / 2),
      ).toBeLessThan(2);
      expect(
        Math.abs(result.overControl.y + result.overControl.height / 2 - control!.y - control!.height / 2),
      ).toBeLessThan(2);
      const protectedPixels = await subscribe.screenshot({ animations: 'disabled' });
      result.controlPixelsEqual = reference.equals(protectedPixels);
      expect(result.controlPixelsEqual).toBe(true);
      result.overControlHit = await subscribe.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
      expect(result.overControlHit).toBe(true);
      result.browser = context.browser()?.version();
      // Read the assigned key, then use the real emergency button without an OS-wide keypress.
      result.shortcut = await popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'web-world-themes:safety-shortcut' }),
      );
      await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
      await youtube.bringToFront();
      result.emergencySaved = await popup.evaluate(
        async () =>
          (await chrome.storage.local.get('webWorldThemes.safety.emergencyOff'))['webWorldThemes.safety.emergencyOff'],
      );
      expect(result.emergencySaved).toBe(true);
      await expect(youtube.locator('.model-media')).toHaveCount(0);
      result.offRemoved = true;
    } finally {
      await writeFile(`.work/evidence/live-visual-${shot}.json`, JSON.stringify(result, null, 2));
      await context.close();
    }
  });
