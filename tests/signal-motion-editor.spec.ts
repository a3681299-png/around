import path from 'node:path';
import { showArtwork } from './helpers/artwork';
import { test, expect } from './fixtures';
import { closeEditorPages, openEditor } from './helpers/editor';
import type { DesignDocument } from '../src/design/types';
import { unpackCheckpoint } from '../src/studio/checkpoint-codec';

test('shared motion UI pursues, stops, rotates, keeps handles aligned and preserves authored placement through Undo/save/reload/OFF', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  let { panel } = await openEditor(popup, youtube);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const stored = () =>
    popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
  const before = (await stored()).decorations[0]!.placement;
  await panel.getByLabel('レイヤーのマウス追跡').check();
  await panel.getByLabel('追従の最高速度').fill('240');
  await panel.getByLabel('追従の最高速度').press('Tab');
  await panel.getByLabel('追従の遅延').fill('100');
  await panel.getByLabel('追従の遅延').press('Tab');
  await panel.getByLabel('マウスとの停止距離').fill('40');
  await panel.getByLabel('マウスとの停止距離').press('Tab');
  const image = youtube.locator('#web-world-themes-decorations .image');
  const point = () =>
    image.evaluate((node: HTMLElement) => ({
      x: Number.parseFloat(node.style.left),
      y: Number.parseFloat(node.style.top),
    }));
  const start = await point();
  // G1 flattens motion near native chip controls. Pursuit is tested in the
  // artwork area; approach/hysteresis has its own operation-safety assertions.
  await youtube.mouse.move(650, 380);
  await expect
    .poll(async () => Math.hypot((await point()).x - start.x, (await point()).y - start.y))
    .toBeGreaterThan(10);
  await expect
    .poll(
      async () => {
        const p = await point();
        return Math.abs(Math.hypot(650 - p.x, 380 - p.y) - 40);
      },
      { timeout: 8000 },
    )
    .toBeLessThan(0.1);
  await expect.poll(() => image.evaluate((node: HTMLElement) => node.style.transform)).not.toContain('rotate(0deg)');
  const alignment = await image.evaluate((node: HTMLElement) => {
    const frame = (node.getRootNode() as ShadowRoot).querySelector<HTMLElement>('.selection-frame[data-frame-id]')!,
      a = node.getBoundingClientRect(),
      b = frame.getBoundingClientRect();
    return {
      dx: Math.abs(a.x - b.x),
      dy: Math.abs(a.y - b.y),
      left: node.style.left === frame.style.left,
      top: node.style.top === frame.style.top,
    };
  });
  expect(alignment.left && alignment.top).toBe(true);
  expect(alignment.dx).toBeLessThan(0.05);
  expect(alignment.dy).toBeLessThan(0.05);
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const design = await stored();
  expect(design.decorations[0]!.placement).toEqual(before);
  expect(design.decorations[0]!.motion).toMatchObject({ maxSpeed: 240, lagMs: 100, stopRadius: 40 });
  await panel.getByLabel('追従の最高速度').fill('900');
  await panel.getByLabel('追従の最高速度').press('Tab');
  await panel.locator('.undo').click();
  await expect(panel.getByLabel('追従の最高速度')).toHaveValue('240');
  await panel.locator('.redo').click();
  await expect(panel.getByLabel('追従の最高速度')).toHaveValue('900');
  await panel.locator('.discard').click();
  await expect(panel.getByLabel('追従の最高速度')).toHaveValue('240');
  await panel.locator('.layer [data-action="lock"]').click();
  await expect(panel.getByLabel('レイヤーのマウス追跡')).toBeDisabled();
  await panel.locator('.undo').click();
  // Undo unlocks the layer. The editor page closes once its recovery copy has caught up: the page
  // writes it a moment later, and closing first would leave the locked draft to be restored
  // (docs/ui0d-3.md, deferred).
  await expect(panel.getByLabel('レイヤーのマウス追跡')).toBeEnabled();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const target = new URL(panel.page().url()).searchParams.get('target');
  await expect
    .poll(async () => {
      const value: unknown = await popup.evaluate(
        async (key) => (await chrome.storage.session.get(key))[key],
        'webWorldThemes.studio.session.' + target,
      );
      return unpackCheckpoint(value)?.draft.decorations[0]?.locked;
    })
    .toBe(false);
  // The editor closes with the reload, as before; then it is opened again on the saved work.
  await closeEditorPages(youtube);
  await youtube.reload();
  await expect(image).toBeVisible();
  ({ panel } = await openEditor(popup, youtube));
  await panel.locator('.layer [data-action="select"]').click();
  await expect(panel.getByLabel('レイヤーのマウス追跡')).toBeChecked();
  await panel.getByLabel('追従方式').selectOption('direct');
  await panel.getByLabel('マウスとの停止距離').fill('0');
  await panel.getByLabel('マウスとの停止距離').press('Tab');
  // Use a gap outside the conservative swept chip-control columns for a real
  // canvas drag; protected columns deliberately pass input to native controls.
  await youtube.mouse.move(710, 350);
  await expect.poll(async () => (await point()).x).toBeCloseTo(710, 3);
  const scale = youtube.viewportSize()!.width;
  // Style sampling can precede presentation. Wait for the actual hit target,
  // including the compositor clip and any temporary geometry suspension.
  await expect
    .poll(() =>
      image.evaluate((node) => {
        const root = node.getRootNode() as ShadowRoot;
        return (
          document.elementFromPoint(710, 350) === root.host &&
          node.contains(root.elementFromPoint(710, 350)) &&
          getComputedStyle(node).visibility === 'visible'
        );
      }),
    )
    .toBe(true);
  await youtube.mouse.down();
  await youtube.mouse.move(770, 350, { steps: 8 });
  await youtube.mouse.up();
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  expect((await stored()).decorations[0]!.placement.x).toBeCloseTo(before.x + 60 / scale, 3);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
  await showArtwork(popup);
  await expect(image).toBeVisible();
  await youtube.emulateMedia({ reducedMotion: 'reduce' });
  await youtube.waitForTimeout(50);
  const frozen = await point();
  await youtube.mouse.move(600, 450);
  await youtube.waitForTimeout(100);
  expect(await point()).toEqual(frozen);
});
