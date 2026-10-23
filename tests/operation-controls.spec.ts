import { test, expect } from './fixtures';
import path from 'node:path';
import { exposeEditorControls } from './helpers/editor-workspace';

test('native drag, text, keyboard and fullscreen controls remain usable with opaque artwork', async ({
  popup,
  youtube,
}, info) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await youtube.evaluate(() => {
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    for (const [id, name, bottom, width] of [
      ['g1-seek', 'ytp-progress-bar', 60, 300],
      ['g1-volume', 'ytp-volume-slider', 24, 140],
    ] as const) {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = id;
      slider.className = name;
      slider.min = '0';
      slider.max = '100';
      slider.value = '50';
      slider.setAttribute('aria-label', id);
      slider.style.cssText = `position:absolute;top:auto;left:32px;bottom:${bottom}px;width:${width}px;height:20px;z-index:70`;
      player.append(slider);
    }
  });
  const run = async () => {
    const values: number[] = [];
    for (const id of ['g1-seek', 'g1-volume']) {
      const range = youtube.locator('#' + id),
        r = (await range.boundingBox())!;
      await range.press('Home');
      await expect(range).toHaveValue('0');
      await youtube.mouse.move(r.x + 12, r.y + r.height / 2);
      await youtube.mouse.down();
      await youtube.mouse.move(r.x + r.width * 0.7, r.y + r.height / 2, { steps: 6 });
      await youtube.mouse.up();
      const value = Number(await range.inputValue());
      expect(value).toBeGreaterThan(50);
      values.push(value);
      await range.press('ArrowLeft');
      expect(Number(await range.inputValue())).toBe(value - 1);
    }
    const search = youtube.locator('yt-searchbox input');
    await search.fill('G1 search');
    await expect(search).toHaveValue('G1 search');
    await search.fill('');
    const comment = youtube.locator('#contenteditable-root');
    await comment.fill('G1 comment');
    await expect(comment).toHaveText('G1 comment');
    await comment.fill('');
    await youtube.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => youtube.evaluate(() => scrollY)).toBe(0);
    const playerBox = await youtube.locator('#movie_player').boundingBox();
    await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => youtube.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => youtube.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await expect.poll(() => youtube.locator('#movie_player').boundingBox()).toEqual(playerBox);
    return values;
  };
  const baseline = await run();
  const protectedBefore = await youtube.locator('#g1-seek').screenshot();
  await popup.locator('#creator-editor-open').evaluate((b: HTMLButtonElement) => b.click());
  const editor = youtube.locator('#web-world-themes-creator');
  await exposeEditorControls(editor);
  const opaque = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 32, 32);
    return c.toDataURL();
  });
  await editor
    .getByLabel('画像素材を追加')
    .setInputFiles({ name: 'opaque.png', mimeType: 'image/png', buffer: Buffer.from(opaque.split(',')[1]!, 'base64') });
  for (const [name, value] of [
    ['画像の幅', '1600'],
    ['画像の高さ', '1200'],
  ] as const) {
    await editor.getByLabel(name, { exact: true }).fill(value);
    await editor.getByLabel(name, { exact: true }).press('Tab');
  }
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
  await expect
    .poll(async () =>
      JSON.parse(
        (await youtube.locator('#web-world-themes-decorations').getAttribute('data-ww-safety')) ?? '{}',
      ).issues?.some((i: any) => i.severity === 'enforced'),
    )
    .toBe(true);
  await expect
    .poll(() => youtube.locator('#web-world-themes-decorations').evaluate((host) => getComputedStyle(host).clipPath))
    .not.toBe('none');
  expect(await youtube.locator('#web-world-themes-decorations').evaluate((host) => getComputedStyle(host).zIndex)).toBe(
    '1',
  );
  await expect.poll(async () => (await youtube.locator('#g1-seek').screenshot()).equals(protectedBefore)).toBe(true);
  expect(await run()).toEqual(baseline);
  // Repeat against the other production composition path: moving the original
  // opaque media into the player must never expose its reserved controls.
  await popup.locator('#creator-editor-open').evaluate((b: HTMLButtonElement) => b.click());
  await exposeEditorControls(editor);
  await editor.locator('[data-layer-id] [data-action="select"]').click();
  await editor.getByLabel('配置の基準').selectOption('video-player');
  for (const name of ['画像のX位置', '画像のY位置']) {
    await editor.getByLabel(name, { exact: true }).fill('50');
    await editor.getByLabel(name, { exact: true }).press('Tab');
  }
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
  const playerPaint = youtube.locator('#web-world-themes-video-decorations');
  await expect(playerPaint.locator('[data-image-id]')).toBeVisible();
  await expect(playerPaint).toHaveCSS('clip-path', 'inset(64px 0px 112px)');
  await expect.poll(async () => (await youtube.locator('#g1-seek').screenshot()).equals(protectedBefore)).toBe(true);
  expect(await run()).toEqual(baseline);
  await youtube.screenshot({ path: info.outputPath('opaque-paint-native-controls.png') });
});

test('Studio exposes protection overlays, per-layer restrictions and emergency OFF', async ({
  popup,
  youtube,
  context,
  extensionId,
}, info) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  const studio = await context.newPage();
  await studio.goto(`chrome-extension://${extensionId}/studio/index.html`);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.locator('#web-world-themes-creator');
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.getByLabel('画像の幅', { exact: true }).fill('1600');
  await panel.getByLabel('画像の幅', { exact: true }).press('Tab');
  await expect(studio.locator('.ww-safety-controls li[data-layer-id]')).toContainText(['制限中']);
  await expect(panel.locator('.safety-limited-badge')).toHaveText('制限中');
  await studio.locator('.ww-safety-controls summary').click();
  await studio.getByLabel('操作面の保護範囲を表示').check();
  await expect(youtube.locator('#web-world-themes-operation-check')).toHaveCount(1);
  await studio.screenshot({ path: info.outputPath('studio-operation-restriction.png') });
  await youtube.screenshot({ path: info.outputPath('operation-envelopes.png') });
  await studio.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
  await expect(panel.locator('.dirty')).toHaveText('未保存の変更');
});
