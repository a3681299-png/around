import path from 'node:path';
import { showArtwork } from './helpers/artwork';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';
import { renderDiagnostics } from './helpers/render-diagnostics';

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1100, height: 760 },
  { width: 430, height: 760 },
]) {
  test(`timeline leaves layer controls reachable at ${viewport.width}x${viewport.height}`, async ({
    context,
    popup,
    youtube,
  }, info) => {
    await youtube.setViewportSize(viewport);
    await showArtwork(popup);
    // The popup changes optimistically; authoring is enabled after the page receives the save.
    await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    // UI0-d round 3: the in-page Studio's workbench is the editor window's own, at the same sizes.
    const { panel, studio } = await openEditor(popup, youtube, viewport);
    // A narrow window gets the one-column arrangement: the レイヤー tab shows the list, as the
    // wide arrangement's 開閉 button did.
    const layersTab = panel.getByRole('tab', { name: 'レイヤー', exact: true });
    if (await layersTab.isVisible()) await layersTab.click();
    else if (viewport.width < 640)
      await panel.getByRole('button', { name: 'プロパティとレイヤーを開閉', exact: true }).click();
    await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await panel.locator('.timeline-toggle').click();
    await panel.locator('.timeline-connect').click();
    await studio.screenshot({ path: info.outputPath('timeline-layer-controls.png') });
    const diagnostics = info.outputPath('layout-and-fonts.json');
    await writeFile(diagnostics, JSON.stringify(await renderDiagnostics(context), null, 2));
    await info.attach('layout-and-fonts', { path: diagnostics, contentType: 'application/json' });
    // A sliver of a row can accept a click on one platform while another font
    // hides it entirely. Keep at least one complete row in the scroll viewport.
    const rowHeight = await panel
      .locator('.layer')
      .first()
      .evaluate((node) => Math.ceil(node.getBoundingClientRect().height));
    await expect
      .poll(() => panel.locator('.layers').evaluate((node) => node.clientHeight))
      .toBeGreaterThanOrEqual(rowHeight);
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
