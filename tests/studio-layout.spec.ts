import { build } from 'esbuild';
import { test, expect } from './fixtures';

test('site layout reserves a live viewport, keeps DOM/media identities, suspends for fullscreen and restores all owned state', async ({ popup, youtube }) => {
  await youtube.setViewportSize({ width: 1366, height: 900 });
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await youtube.locator('#navigate').click();
  await expect(youtube.locator('#movie_player')).toBeVisible();
  const before = await youtube.locator('ytd-app').boundingBox(), player = await youtube.locator('#movie_player').elementHandle();
  const parent = await player!.evaluate((node) => node.parentElement?.id);
  const bundle = await build({ entryPoints: ['src/sites/youtube-studio.ts'], bundle: true, write: false, format: 'iife', globalName: 'StudioLayoutTest', loader: { '.css': 'text' } });
  await youtube.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await youtube.evaluate(() => {
    document.documentElement.style.setProperty('--ww-studio-left', '7px', 'important');
    (globalThis as any).__layoutChanges = 0;
    (globalThis as any).__layout = (globalThis as any).StudioLayoutTest.mountYouTubeStudio(document, (state: unknown) => { (globalThis as any).__layoutState = state; (globalThis as any).__layoutChanges++; });
    (globalThis as any).__layout.update({ left: 160, right: 300, top: 56, bottom: 24 });
  });
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-studio-layout', 'reserved');
  await expect.poll(async () => (await youtube.locator('ytd-app').boundingBox())!.width).toBeCloseTo(906, 0);
  expect((await youtube.locator('ytd-app').boundingBox())!.x).toBe(160);
  expect(await player!.evaluate((node) => node === document.querySelector('#movie_player') && node.parentElement?.id)).toBe(parent);
  const rect = (await youtube.locator('#movie_player').boundingBox())!; expect(rect.width / rect.height).toBeCloseTo(16 / 9, 2);
  await youtube.locator('#movie_player [aria-label="Fullscreen"]').click();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-studio-fullscreen', '');
  expect(await youtube.evaluate(() => (globalThis as any).__layout.state())).toMatchObject({ mode: 'fullscreen', canvas: { left: 0, top: 0, width: 1366, height: 900 } });
  await youtube.evaluate(() => document.exitFullscreen()); await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-studio-fullscreen', '');
  await youtube.evaluate(() => { (globalThis as any).__layout.destroy(); (globalThis as any).__layout.destroy(); });
  await expect(youtube.locator('#web-world-themes-studio-layout')).toHaveCount(0); await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-inpage-studio', '');
  await expect.poll(async () => (await youtube.locator('ytd-app').boundingBox())!.width).toBeCloseTo(before!.width, 0);
  expect(await youtube.evaluate(() => ({ value: document.documentElement.style.getPropertyValue('--ww-studio-left'), priority: document.documentElement.style.getPropertyPriority('--ww-studio-left') }))).toEqual({ value: '7px', priority: 'important' });
  const changes = await youtube.evaluate(() => (globalThis as any).__layoutChanges);
  await youtube.evaluate(() => { dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await youtube.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await youtube.evaluate(() => (globalThis as any).__layoutChanges)).toBe(changes);
});
