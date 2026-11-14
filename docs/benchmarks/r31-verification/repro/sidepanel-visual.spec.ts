import { test, expect } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openSidePanelFromIcon } from '../../tests/helpers/editor';
import { sidePanelDriver } from '../../tests/helpers/side-panel';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
for (const label of ['before', 'after'])
  test(`R31 matched side panel default VRM picture: ${label}`, async () => {
    test.skip(process.env.AROUND_R31_LIVE !== '1');
    test.setTimeout(240000);
    await mkdir('.work/r31-private', { recursive: true });
    const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-r31-panel-')), false, {
      headed: true,
      width: 1920,
      extensionPath: path.resolve(label === 'before' ? '../r31-before/.work/r31-normal' : '.work/r31-normal'),
    });
    const result: any = { label };
    try {
      const manager = await context.newPage();
      await manager.goto('chrome://extensions/');
      const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
      await item.waitFor();
      const id = await item.evaluate((e: any) => e.data?.id ?? e.id);
      await manager.close();
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      const page = await context.newPage();
      await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 45000 });
      await popup.getByRole('switch', { name: '作品を表示する' }).check();
      await page.bringToFront();
      await openSidePanelFromIcon(popup, page);
      const panel = await sidePanelDriver(context, page, id);
      await panel.files(
        [process.env.AROUND_VRM_FILE ?? 'C:/Users/sm787/Desktop/ローポリモデル用/out/trusie.vrm'],
        '.model-file',
      );
      const media = page.locator('.model-media');
      await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 100000 });
      await panel.fill('[data-image-prop="widthPx"]', '300');
      await panel.fill('[data-image-prop="heightPx"]', '400');
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `.work/r31-private/sidepanel-${label}-default.png` });
      result.default = await media.evaluate((e) => ({
        rect: e.getBoundingClientRect().toJSON(),
        renderer: (e as HTMLElement).dataset.renderer,
        visibility: getComputedStyle(e).visibility,
        viewport: [innerWidth, innerHeight],
        scroll: [scrollX, scrollY],
      }));
      if (label === 'after') {
        await panel.files(
          [
            path.join(
              process.env.AROUND_VRMA_DIR ?? 'C:/Users/sm787/Desktop/ローポリモデル用/out/anim',
              'trusie',
              'idle.vrma',
            ),
          ],
          '.character-file',
        );
        await expect.poll(() => panel.text('.character-motions')).toContain('idle');
        await page.waitForTimeout(1600);
        await page.screenshot({ path: '.work/r31-private/sidepanel-after-idle.png' });
        result.idle = await media.evaluate((e) => ({
          rect: e.getBoundingClientRect().toJSON(),
          frame: JSON.parse((e as HTMLElement).dataset.modelFrame!),
        }));
      }
    } finally {
      await writeFile(`.work/evidence/sidepanel-visual-${label}.json`, JSON.stringify(result, null, 2));
      await context.close();
    }
  });
