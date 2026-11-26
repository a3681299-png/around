import { test, expect, type Page } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { storeDesign } from './helpers/skin-verification';
import { writeContent } from '../scripts/playground/content';

/**
 * R3-2 on real YouTube: the Playground's own artwork (scripts/playground/content.ts), with only the
 * site ID changed, sits on the same anchor and moves the same way. The assets go in through the
 * editor's real import (validation, leases); the artwork is then the Playground's file itself.
 * Headless, so no window or keyboard focus is taken. Explicit: AROUND_LIVE_R32=1.
 */
const shots = path.resolve('.work/r32-live');
const media = (page: Page) =>
  page.locator(
    ':is(#around-decorations, #around-video-decorations, #around-page-decorations, #around-atmosphere-decorations) .model-media',
  );

test('real YouTube: the Playground artwork sits on the player edge and moves as in the Playground', async () => {
  test.skip(process.env.AROUND_LIVE_R32 !== '1', 'Explicit real YouTube verification (AROUND_LIVE_R32=1).');
  test.setTimeout(240000);
  await mkdir(shots, { recursive: true });
  const content = path.resolve('.work/r32-live/content');
  const { models } = writeContent(path.resolve('.'), content);
  const manifest = JSON.parse(await readFile(path.join(content, 'manifest.json'), 'utf8')) as {
    assets: Record<string, { file: string }>;
  };
  const file = (name: string) => path.join(content, name);
  const design = JSON.parse(await readFile(file('design.json'), 'utf8'));
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-r32-live-')), false);
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25000 });
    await declinePromotion(page);
    await showArtwork(popup);
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    // The real import: the VRM, its two poses and the room picture, each checked and leased.
    const { panel } = await openEditor(popup, page);
    const vrm = models.find((name) => name.endsWith('.vrm'))!;
    await panel.locator('.model-file').setInputFiles(file(vrm));
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
    await panel.locator('.character-file').setInputFiles(models.filter((name) => name.endsWith('.vrma')).map(file));
    await expect(panel.locator('.character-motions li')).toHaveCount(2, { timeout: 30000 });
    const room = Object.values(manifest.assets).find((asset) => asset.file.endsWith('.png'))!;
    await panel.locator('.file').first().setInputFiles(file(room.file));
    await expect(panel.locator('.layer')).toHaveCount(2, { timeout: 30000 });
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    // Every asset the Playground artwork names is now in the extension's store under the same ID.
    const saved = await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    );
    const ids = (value: unknown): string[] => JSON.stringify(value).match(/asset-[0-9a-f]{64}/g) ?? [];
    expect(new Set(ids(saved))).toEqual(new Set(ids(design)));
    await closeEditorPages(page);
    // The layers (character, room) are the same objects; the skin rules name a site's own parts,
    // so only the ones YouTube also has stay (an unknown part refuses the whole artwork).
    const shared = ['video-card'];
    await storeDesign(popup, {
      ...design,
      siteId: 'youtube',
      rules: design.rules.filter((rule: { target: string }) => shared.includes(rule.target)),
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25000 });
    await declinePromotion(page);
    await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    // The same place as in the Playground: across the player's top edge, near its right end.
    await page.waitForTimeout(1500);
    const player = (await page.locator('#movie_player').boundingBox())!,
      character = (await page.locator('[data-image-id="resident"]').first().boundingBox())!;
    expect(character.y).toBeLessThan(player.y);
    expect(character.y + character.height).toBeGreaterThan(player.y);
    expect(character.x + character.width / 2).toBeGreaterThan(player.x + player.width * 0.8);
    const frame = () =>
      media(page).evaluate((e: HTMLElement) => {
        const f = JSON.parse(e.dataset.modelFrame!);
        return { hips: f.pose?.hips, yaw: f.pose?.yawDeg, seat: f.pose?.seat, head: f.pose?.bones?.head };
      });
    expect((await frame()).seat).toBe(true);
    await page.screenshot({ path: path.join(shots, 'youtube-page.png') });

    const video = (action: 'pause' | 'play') =>
      page.evaluate((action) => {
        const element = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
        element.muted = true;
        return action === 'pause' ? element.pause() : element.play();
      }, action);
    const show = async (decorations: unknown[]) => {
      await storeDesign(popup, { ...design, siteId: 'youtube', rules: [], decorations });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25000 });
      await declinePromotion(page);
      await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
      await page.waitForTimeout(1200);
      return (await page.locator('[data-image-id="resident"]').first().boundingBox())!;
    };
    /** Pixels the character changes on screen: the same paused frame with and without the artwork
     * (the emergency OFF), compared in an extension page. The room is left out, so only the
     * character can make a difference. */
    const drawnPixels = async (box: { x: number; y: number; width: number; height: number }, name: string) => {
      const clip = { x: box.x, y: Math.max(0, box.y), width: box.width, height: box.height + Math.min(0, box.y) };
      await video('pause');
      await page.waitForTimeout(2600);
      const on = await page.screenshot({ clip, path: path.join(shots, `${name}-on.png`) });
      await popup.evaluate(() => chrome.storage.local.set({ 'around.safety.emergencyOff': true }));
      await expect(media(page)).toHaveCount(0);
      const off = await page.screenshot({ clip, path: path.join(shots, `${name}-off.png`) });
      await popup.evaluate(() => chrome.storage.local.set({ 'around.safety.emergencyOff': false }));
      await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 30000 });
      return popup.evaluate(
        async ([a, b]) => {
          const read = async (base64: string) => {
            const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + base64)).blob());
            const canvas = new OffscreenCanvas(image.width, image.height),
              context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, image.width, image.height).data;
          };
          const [p, q] = await Promise.all([read(a), read(b)]);
          let changed = 0;
          for (let i = 0; i < p.length; i += 4)
            if (Math.abs(p[i]! - q[i]!) + Math.abs(p[i + 1]! - q[i + 1]!) + Math.abs(p[i + 2]! - q[i + 2]!) > 30)
              changed++;
          return changed;
        },
        [on.toString('base64'), off.toString('base64')] as const,
      );
    };
    const resident = design.decorations.filter((layer: { id: string }) => layer.id === 'resident');

    // A. The Playground's place, the player's top edge: the masthead is 12 px above it and the
    // player's top control band (64 px, G1) is below, so YouTube shows none of the character
    // (docs/r3-plan.md R3-0). Kept as a check that the protection still clips it all.
    const edgeBox = await show(resident);
    const edgeDrawn = await drawnPixels(edgeBox, 'edge');
    expect(edgeDrawn).toBeLessThan(40);

    // B. The same artwork with the character over the picture (which may be painted over):
    // visible, and moving as in the Playground.
    const inside = resident.map((layer: { placement: object }) => ({
      ...layer,
      placement: { ...layer.placement, y: 0.42 },
    }));
    const box = await show(inside);
    const clip = {
      x: Math.max(0, box.x - 60),
      y: Math.max(0, box.y - 40),
      width: box.width + 120,
      height: box.height + 80,
    };
    const insideDrawn = await drawnPixels(box, 'inside');
    expect(insideDrawn).toBeGreaterThan(400);
    await video('play');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, 'youtube-inside-page.png') });
    await page.screenshot({ path: path.join(shots, 'youtube-sit-a.png'), clip });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(shots, 'youtube-sit-b.png'), clip });
    // The main video pausing and starting again: a look down, then a hop.
    await video('pause');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(shots, 'youtube-look-down.png'), clip });
    const pitch = (await frame()).head?.[0] ?? 0;
    await video('play');
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(40);
      peak = Math.max(peak, (await frame()).hips?.[1] ?? 0);
      if (i === 5) await page.screenshot({ path: path.join(shots, 'youtube-hop.png'), clip });
    }
    console.log('R32 live: ' + JSON.stringify({ edgeDrawn, insideDrawn, pitch, peak, player, character, box }));
    expect(pitch).toBeGreaterThan(5);
    expect(peak).toBeGreaterThan(0.05);
  } finally {
    await context.close();
  }
});
