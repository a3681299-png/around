import { test } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from '../../tests/fixtures';
test('headless viewport after Studio changes the shared physical window', async () => {
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g14-vp-')));
  try {
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/');
    const cdp = await context.newCDPSession(page),
      rows: any[] = [];
    const sample = async (label: string) => {
      await page.waitForTimeout(100);
      rows.push({
        label,
        pw: page.viewportSize(),
        window: await cdp.send('Browser.getWindowForTarget'),
        page: await page.evaluate(() => ({
          innerWidth,
          innerHeight,
          outerWidth,
          outerHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          visual: visualViewport
            ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale }
            : null,
        })),
      });
    };
    await page.setViewportSize({ width: 1920, height: 1080 });
    await sample('original');
    const studio = await context.newPage();
    await studio.setViewportSize({ width: 1440, height: 900 });
    await sample('studio-open');
    await studio.close();
    await sample('studio-closed');
    await page.setViewportSize({ width: 1921, height: 1081 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await sample('force-viewport');
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1938, height: 1176 } });
    await sample('physical-restored');
    await writeFile('.work/g14-extra/viewport.json', JSON.stringify(rows, null, 2));
  } finally {
    await context.close();
  }
});
