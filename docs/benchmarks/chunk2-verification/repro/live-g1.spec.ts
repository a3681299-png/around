import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from '../../tests/fixtures';
import { openEditor, closeEditorPages } from '../../tests/helpers/editor';
import { showArtwork } from '../../tests/helpers/artwork';
import { declinePromotion, waitForAdvertToEnd } from '../../tests/helpers/youtube-live';
import { storeDesign } from '../../tests/helpers/skin-verification';

const evidence = path.resolve('.work/verify-evidence');
const content = path.resolve('.work/playground/content');
const media = (page: Page) => page.locator('.model-media');

async function sampleClip(page: Page) {
  return media(page).evaluate((node) => {
    const canvas = node.querySelector('canvas')!;
    const plane = (node.getRootNode() as ShadowRoot).host as HTMLElement;
    const player = document.querySelector('#movie_player')!.getBoundingClientRect();
    const p = plane.getBoundingClientRect(),
      c = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const clip = getComputedStyle(plane).clipPath;
    const d = clip.match(/"([^"]+)"/)?.[1];
    const shape = d ? new Path2D(d) : undefined;
    const inset = /^inset\(([^)]+)\)$/.exec(clip)?.[1]?.split(/\s+/);
    const pixels = (part: string, extent: number) => parseFloat(part) * (part.endsWith('%') ? extent / 100 : 1);
    const bounds = inset && {
      top: pixels(inset[0]!, p.height),
      right: pixels(inset[1] ?? inset[0]!, p.width),
      bottom: pixels(inset[2] ?? inset[0]!, p.height),
      left: pixels(inset[3] ?? inset[1] ?? inset[0]!, p.width),
    };
    if (!shape && !bounds && clip !== 'none') throw Error(`Unrecognized clip: ${clip}`);
    const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0,
      topBand = 0,
      topBandAllowed = 0,
      canvasAllowed = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        if (alpha[(y * canvas.width + x) * 4 + 3]! < 100) continue;
        opaque++;
        const vx = c.x + ((x + 0.5) * c.width) / canvas.width,
          vy = c.y + ((y + 0.5) * c.height) / canvas.height;
        if (vx < 0 || vx >= innerWidth || vy < 0 || vy >= innerHeight) continue;
        const allowed = shape
          ? ctx.isPointInPath(shape, vx - p.x, vy - p.y)
          : bounds
            ? vx >= p.left + bounds.left &&
              vx < p.right - bounds.right &&
              vy >= p.top + bounds.top &&
              vy < p.bottom - bounds.bottom
            : true;
        if (allowed) canvasAllowed++;
        if (vx < player.left || vx >= player.right || vy < player.top || vy >= player.top + 64) continue;
        topBand++;
        if (allowed) topBandAllowed++;
      }
    return {
      opaque,
      topBand,
      topBandAllowed,
      canvasAllowed,
      plane: plane.id,
      clip: clip.startsWith('path(') ? 'path' : clip,
      pointerEvents: getComputedStyle(node).pointerEvents,
      player: player.toJSON(),
      canvas: c.toJSON(),
    };
  });
}

test('real YouTube mannequin clipping and native input, using the same design on both versions', async () => {
  test.setTimeout(240_000);
  const side = process.env.CHUNK2_LIVE_SIDE ?? 'head';
  const result: Record<string, unknown> = { side };
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-chunk2-live-')), false);
  context.setDefaultNavigationTimeout(35_000);
  try {
    const service = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20_000 }));
    const popup = await context.newPage();
    await popup.goto(new URL('/popup/index.html', service.url()).href);
    await showArtwork(popup);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    const player = page.locator('#movie_player'),
      video = page.locator('video.html5-main-video');
    await expect(player).toBeVisible({ timeout: 40_000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page, 45_000);
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    await page.bringToFront();
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          try {
            return (await chrome.tabs.sendMessage(tab.id!, { type: 'around:probe-editor-target' }))?.siteId;
          } catch {
            return null;
          }
        }),
      )
      .toBe('youtube');
    const { panel } = await openEditor(popup, page);
    const manifest = JSON.parse(await readFile(path.join(content, 'manifest.json'), 'utf8'));
    const file = (name: string) =>
      path.join(content, (Object.values(manifest.assets) as any[]).find((asset) => asset.name === name).file);
    await panel.locator('.model-file').setInputFiles(file('WW mannequin.vrm'));
    await expect(panel.locator('.layer')).toHaveCount(1);
    await panel.locator('.character-file').setInputFiles([file('sit.vrma'), file('stand.vrma')]);
    await expect(panel.locator('.character-motions li')).toHaveCount(2);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const design = JSON.parse(await readFile(path.join(content, 'design.json'), 'utf8'));
    const resident = design.decorations.find((layer: any) => layer.id === 'resident');
    const site = { ...design, siteId: 'youtube', rules: [], decorations: [resident] };
    await storeDesign(popup, site);
    await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 45_000 });
    await page.mouse.move(40, 500);
    await expect.poll(() => sampleClip(page).then((r) => r.opaque)).toBeGreaterThan(100);
    const edge = await sampleClip(page);
    result.edge = edge;
    await page.screenshot({ path: path.join(evidence, `youtube-${side}-edge.png`) });
    expect(edge.topBand).toBeGreaterThan(0);
    if (side === 'head') expect(edge.topBandAllowed).toBe(0);
    expect(edge.pointerEvents).toBe('none');

    const inside = { ...resident, placement: { ...resident.placement, y: 0.42 } };
    await storeDesign(popup, { ...site, decorations: [inside] });
    await expect.poll(() => sampleClip(page).then((r) => r.canvasAllowed)).toBeGreaterThan(100);
    const pose = () => media(page).evaluate((node: HTMLElement) => JSON.parse(node.dataset.modelFrame!).pose);
    if (side === 'head') {
      await expect.poll(() => pose().then((p) => p?.seat)).toBe(true);
      await expect.poll(() => pose().then((p) => p?.offset.y)).toBe(0);
      result.seat = await pose();
      expect((result.seat as any).yawDeg).toBeGreaterThan(20);
      expect((result.seat as any).yawDeg).toBeLessThan(30);
    }
    const toggle = async () => {
      const control = page.locator('button.ytp-play-button');
      const wasPaused = await video.evaluate((v: HTMLVideoElement) => v.paused);
      await player.hover({ position: { x: 45, y: 35 } });
      await expect(control).toBeVisible();
      await expect
        .poll(() =>
          control.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }),
        )
        .toBe(true);
      await control.click();
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(!wasPaused);
      return !wasPaused;
    };
    if (await video.evaluate((v: HTMLVideoElement) => v.paused)) await toggle();
    expect(await toggle()).toBe(true);
    expect(await toggle()).toBe(false);
    result.nativePlayAndPause = true;
    if (side === 'head') {
      // Take the pose samples after the move and native control hover have settled. Drive the
      // real video events separately from the native click check, as the Playground does.
      await page.mouse.move(400, 290);
      await page.waitForTimeout(900);
      await video.evaluate((node: HTMLVideoElement) => node.pause());
      await expect.poll(() => pose().then((p) => p?.bones.head?.[0] ?? 0), { intervals: [40] }).toBeGreaterThan(5);
      result.look = await pose();
    }
    await page.screenshot({ path: path.join(evidence, `youtube-${side}-inside.png`) });
    if (side === 'head') {
      await video.evaluate((node: HTMLVideoElement) => {
        void node.play().catch(() => undefined);
      });
      await expect.poll(() => pose().then((p) => p?.hips[1] ?? 0), { intervals: [20] }).toBeGreaterThan(0.05);
      result.hop = await pose();
      await page.screenshot({ path: path.join(evidence, 'youtube-head-hop.png') });
    }
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await expect(media(page)).toHaveCount(0);
    result.completed = true;
  } catch (error) {
    result.error = String(error);
    throw error;
  } finally {
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, `youtube-${side}-g1.json`), JSON.stringify(result, null, 2));
    await context.close();
  }
});
