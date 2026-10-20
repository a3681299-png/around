import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { renderDiagnostics } from './helpers/render-diagnostics';

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1100, height: 760 }, { width: 430, height: 760 }]) {
  test(`timeline leaves layer controls reachable at ${viewport.width}x${viewport.height}`, async ({ context, popup, youtube }, info) => {
    await youtube.setViewportSize(viewport);
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await youtube.bringToFront();
    await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
    const panel = youtube.locator('#web-world-themes-creator');
    if (viewport.width < 640) await panel.getByRole('button', { name: 'プロパティとレイヤーを開閉', exact: true }).click();
    await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await panel.locator('.timeline-toggle').click();
    await panel.locator('.timeline-connect').click();
    await youtube.screenshot({ path: info.outputPath('timeline-layer-controls.png') });
    const diagnostics = info.outputPath('layout-and-fonts.json');
    await writeFile(diagnostics, JSON.stringify(await renderDiagnostics(context), null, 2));
    await info.attach('layout-and-fonts', { path: diagnostics, contentType: 'application/json' });
    // A sliver of a row can accept a click on one platform while another font
    // hides it entirely. Keep at least one complete row in the scroll viewport.
    await expect.poll(() => panel.locator('.layers').evaluate((node) => node.clientHeight)).toBeGreaterThanOrEqual(34);
    await panel.locator('.layer [data-action="lock"]').click();
    await expect(panel.locator('.timeline-key').first()).toBeDisabled();
    await panel.locator('.layer [data-action="lock"]').click();
    await panel.locator('.clear-selection').click();
    await panel.locator('.layer [data-action="select"]').click();
    await expect(panel.locator('.timeline-key').first()).toBeEnabled();
    await panel.locator('.duplicate-image').click();
    await expect(panel.locator('.layer')).toHaveCount(2);
  });
}
