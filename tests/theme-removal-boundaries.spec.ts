import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';

test('audit every surviving page element and extension listener after OFF and emergency OFF', async () => {
  test.skip(process.env.WW_VERIFY_BOUNDARIES !== '1', 'Compare current and 6ce22ce with the same image backup.');
  const old = process.env.WW_VERIFY_BOUNDARY_OLD === '1';
  await mkdir('.work/verification', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/removal-boundaries-')));
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const backup = await context.newPage();
    await backup.goto(`chrome-extension://${id}/backup/index.html`);
    await backup.locator('#backup-file').setInputFiles(path.resolve('tests/fixtures/backups/pre-removal.wwbackup'));
    await backup.locator('#backup-inspect').click();
    await expect(backup.locator('#backup-restore')).toBeEnabled();
    await backup.locator('#backup-restore').click();
    await expect(backup.locator('.backup-status')).toContainText('読み込みが完了');
    // Avoid opening Studio automatically: this audit is about page ownership only.
    await popup.getByRole('switch', { name: '制作モード' }).uncheck();
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await expect(page.locator('[data-image-id]')).toHaveCount(1);
    const cdp = await context.newCDPSession(page);
    const worlds: number[] = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => {
      if (context.auxData?.type === 'isolated') worlds.push(context.id);
    });
    await cdp.send('Runtime.enable');
    let world: number | undefined;
    for (const contextId of worlds) {
      const probe = await cdp.send('Runtime.evaluate', {
        contextId,
        expression: 'globalThis.chrome?.runtime?.id',
        returnByValue: true,
      });
      if (probe.result.value === id) world = contextId;
    }
    expect(world, 'Audit must inspect the extension isolated world, not the page world.').toBeDefined();
    if (world === undefined) throw new Error('Extension isolated world missing.');
    const contextId = world;
    const snapshot = async () => {
      const dom = await page.evaluate(() => ({
        elements: [...document.querySelectorAll('*')]
          .filter(
            (node) =>
              node.id.startsWith('web-world-themes') ||
              node.getAttributeNames().some((name) => name.startsWith('data-ww-')),
          )
          .map((node) => ({
            tag: node.tagName,
            id: node.id,
            attributes: Object.fromEntries(
              node
                .getAttributeNames()
                .filter((name) => name.startsWith('data-ww-'))
                .map((name) => [name, node.getAttribute(name)]),
            ),
            hidden: (node as HTMLElement).hidden,
          })),
        rootVariables: document.documentElement.style.cssText,
      }));
      const listeners = [];
      for (const target of ['document', 'window']) {
        const { result } = await cdp.send('Runtime.evaluate', { contextId, expression: target });
        const resultListeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
        listeners.push(
          ...resultListeners.listeners.map((entry) => ({
            target,
            type: entry.type,
            capture: entry.useCapture,
            handler: entry.handler?.description?.slice(0, 100),
          })),
        );
        await cdp.send('Runtime.releaseObject', { objectId: result.objectId! });
      }
      return { ...dom, listeners };
    };
    const toggle = popup.getByRole('switch', { name: old ? 'テーマを使う' : '作品を表示する' });
    await toggle.uncheck();
    await expect(page.locator('[data-image-id]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-site');
    const off = await snapshot();
    expect(off.listeners.some((entry) => entry.type === 'pagehide')).toBe(true);
    await toggle.check();
    await expect(page.locator('[data-image-id]')).toHaveCount(1);
    await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
    await expect(page.locator('[data-image-id]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-site');
    const emergency = await snapshot();
    expect(emergency).toEqual(off);
    await writeFile(
      `.work/verification/removal-boundaries-${old ? 'old' : 'current'}.json`,
      JSON.stringify({ off, emergency }, null, 2),
    );
    await cdp.detach();
  } finally {
    await context.close();
  }
});
