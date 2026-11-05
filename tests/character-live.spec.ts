import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openSidePanelFromIcon } from './helpers/editor';
import { sidePanelDriver } from './helpers/side-panel';

/**
 * R3-1b on real YouTube with a private local character: a VRM, its own .vrma motions and an
 * any-model motion. Never in CI: the model and the Mixamo-derived motions are not redistributable.
 * WW_VRM_FILE = the VRM, WW_VRMA_DIR = the motion folder with manifest.json and trusie/.
 */
test('real YouTube: a VRM character plays its own .vrma motions; the body measure gates standard ones', async () => {
  const dir = process.env.WW_VRMA_DIR;
  test.skip(
    !process.env.WW_VRM_FILE || !dir || process.env.WW_LIVE_CHARACTER !== '1',
    'Explicit local character and real YouTube verification; no avatar or motion is bundled.',
  );
  const own = (name: string) => path.resolve(dir!, 'trusie', name),
    any = (name: string) => path.resolve(dir!, name);
  test.skip(!existsSync(own('sit.vrma')) || !existsSync(any('manifest.json')), 'motion folder layout differs');
  test.setTimeout(240000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-character-live-')), false, {
    headed: true,
    width: 1920,
  });
  context.setDefaultTimeout(15000);
  const report: Record<string, unknown> = {};
  await mkdir('.work/verification', { recursive: true });
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25000 });
    await showArtwork(popup);
    await page.bringToFront();
    await openSidePanelFromIcon(popup, page);
    const panel = await sidePanelDriver(context, page, id);
    await panel.files([path.resolve(process.env.WW_VRM_FILE!)], '.model-file');
    const media = page.locator(
      ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations) .model-media',
    );
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 100000 });
    await panel.fill('[data-image-prop="widthPx"]', '300');
    await panel.fill('[data-image-prop="heightPx"]', '400');

    // The character's own motions (stage 3), labelled by the folder's manifest.
    await panel.fill('.character-origin', 'character');
    await panel.files([own('idle.vrma'), own('sit.vrma'), any('manifest.json')], '.character-file');
    await expect.poll(() => panel.text('.character-motions'), { timeout: 60000 }).toContain('sit');
    // An any-model motion: Trusie's body (3 heads tall) rules it out by default.
    await panel.fill('.character-origin', 'standard');
    await panel.files([any('idle.vrma')], '.character-file');
    await expect.poll(() => panel.text('.character-motions'), { timeout: 60000 }).toContain('idle-2');
    report.body = await panel.text('.character-body');
    report.motions = await panel.text('.character-motions');
    expect(report.body).toContain('崩れやすい');
    expect(report.motions).toContain('（今は使わない）');

    const frame = () => media.evaluate((e: HTMLElement) => JSON.parse(e.dataset.modelFrame!));
    const pose = () => media.evaluate((e: HTMLElement) => e.dataset.vrmPose);
    // idle (character's own) plays: its clock advances and the pose changes.
    await panel.fill('[data-model="clip"]', '0');
    await expect.poll(async () => (await frame()).clip).toBe(0);
    const before = await pose();
    await page.waitForTimeout(1500);
    await expect.poll(pose).not.toBe(before);
    await page.screenshot({ path: '.work/verification/character-idle.png' });
    // sit (character's own) plays too.
    await panel.fill('[data-model="clip"]', '1');
    await expect.poll(async () => (await frame()).clip).toBe(1);
    await page.waitForTimeout(800);
    await page.screenshot({ path: '.work/verification/character-sit.png' });
    // The standard idle is held at rest while the body rules standard motions out...
    await panel.fill('[data-model="clip"]', '2');
    await expect.poll(async () => (await frame()).clip).toBeNull();
    // ...and plays once the user overrides the measure.
    await panel.fill('.character-standard', 'on');
    await expect.poll(async () => (await frame()).clip).toBe(2);
    await page.waitForTimeout(800);
    await page.screenshot({ path: '.work/verification/character-standard-on.png' });
    report.completed = true;
  } finally {
    await writeFile('.work/verification/character-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
