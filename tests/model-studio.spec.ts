import { modelPoseError } from './helpers/model-assertions';
import { showArtwork } from './helpers/artwork';
import { test, expect } from './fixtures';
import { modelFixture } from './helpers/model-fixture';
import type { ModelEvaluation } from '../src/world/models';
import type { DesignDocument } from '../src/design/types';
import { createTakeSampler, type SignalTake } from '../src/world/takes';

test('standalone Studio configures model pursuit and clips, records/seeks poses, restores settings and shares Undo', async ({
  context,
  popup,
  youtube,
}) => {
  test.setTimeout(60000);
  await showArtwork(popup);
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  await youtube.bringToFront();
  const opened = context.waitForEvent('page');
  await popup.locator('#creator-editor-window').evaluate((b: HTMLButtonElement) => b.click());
  const studio = await opened;
  await studio.setViewportSize({ width: 1440, height: 1000 });
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.locator('#web-world-themes-creator');
  await panel
    .locator('.model-file')
    .setInputFiles({ name: 'Character.glb', mimeType: 'model/gltf-binary', buffer: modelFixture() });
  const media = youtube.locator('#web-world-themes-decorations .model-media'),
    image = youtube.locator('#web-world-themes-decorations .image');
  await expect(media).toHaveAttribute('data-renderer', 'three');
  for (const [label, value] of [
    ['待機クリップ', '0'],
    ['歩行クリップ', '1'],
    ['走行クリップ', '2'],
  ]) {
    await panel.getByLabel(label!, { exact: true }).selectOption(value!);
    await expect(panel).not.toHaveAttribute('aria-busy', 'true');
  }
  await panel.locator('[data-model="locomotion.enabled"]').check();
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');
  await panel.getByLabel('レイヤーのマウス追跡', { exact: true }).check();
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const stored = () =>
    popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
  const design = await stored(),
    base = design.decorations[0]!.placement;
  expect(design.decorations[0]).toMatchObject({ model: { locomotion: { enabled: true, idle: 0, walk: 1, run: 2 } } });
  await youtube.bringToFront();
  const target = { x: 850, y: 350 };
  await youtube.mouse.move(target.x, target.y);
  const pose = () => media.evaluate((m: HTMLElement) => JSON.parse(m.dataset.modelFrame!) as ModelEvaluation);
  await expect.poll(async () => (await pose()).phase).toBe('run');
  await expect.poll(async () => (await pose()).phase, { timeout: 9000 }).toBe('idle');
  expect((await pose()).clip).toBe(0);
  expect(await image.evaluate((e: HTMLElement) => e.style.transform)).toContain('rotate(0deg)');
  await panel.locator('.timeline-toggle').click();
  await panel.locator('.take-record').click();
  await expect(panel.locator('.signal-timeline')).toHaveAttribute('data-recording', '');
  for (const [x, y] of [
    [200, 500],
    [750, 200],
    [450, 550],
  ]) {
    await youtube.mouse.move(x!, y!, { steps: 8 });
    await youtube.waitForTimeout(150);
  }
  await panel.locator('.take-stop').click();
  await expect(panel.locator('.take-source')).toHaveText('PREVIEW');
  await panel.locator('.take-store').click();
  await expect(panel.locator('.take-saved')).toHaveText('テイク保存済み');
  const take = await studio.evaluate(async () => {
    const list = await chrome.runtime.sendMessage({
      type: 'web-world-themes:signal-takes',
      action: 'list',
      siteId: 'youtube',
    });
    return (
      await chrome.runtime.sendMessage({
        type: 'web-world-themes:signal-takes',
        action: 'get',
        siteId: 'youtube',
        id: list.value[0].id,
      })
    ).value as SignalTake;
  });
  const at = take.inputs[Math.floor(take.inputs.length / 2)]!.timeMs - take.inputs[0]!.timeMs,
    expected = createTakeSampler(design, take).at(at).frame.models![0]!;
  await panel.locator('.take-position').fill(String(at / 1000));
  await panel.locator('.take-position').dispatchEvent('change');
  await expect.poll(async () => modelPoseError(await pose(), expected)).toBeLessThan(1e-9);
  const held = await pose();
  await youtube.mouse.move(900, 650);
  await youtube.waitForTimeout(100);
  expect(await pose()).toEqual(held);
  expect((await stored()).decorations[0]!.placement).toEqual(base);
  await panel.locator('.take-live').click();
  await panel.getByLabel('3D回転X', { exact: true }).fill('30');
  await panel.getByLabel('3D回転X', { exact: true }).press('Tab');
  await panel.locator('.undo').click();
  await expect(panel.getByLabel('3D回転X', { exact: true })).toHaveValue('0');
  await panel.locator('.redo').click();
  await expect(panel.getByLabel('3D回転X', { exact: true })).toHaveValue('30');
  await panel.locator('.discard').click();
  await youtube.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await expect(media).toHaveAttribute('data-renderer', 'three');
});
