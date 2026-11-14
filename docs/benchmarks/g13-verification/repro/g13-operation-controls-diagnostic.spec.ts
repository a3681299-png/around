import { test, expect } from './fixtures';
import path from 'node:path';
import { exposeEditorControls } from './helpers/editor-workspace';
import { openEditor } from './helpers/editor';
import type { DesignDocument } from '../src/design/types';
import { parseDesign } from '../src/design/schema';
import { defaultFollowMotion } from '../src/signals/motion';

// Record input delivery without changing the test's actions or assertions.
test.afterEach(async ({ context }, info) => {
  if (info.status === info.expectedStatus) return;
  const states = [];
  for (const page of context.pages()) {
    states.push(
      await page
        .evaluate(() => {
          const identify = (e: Element | null) =>
            e
              ? { tag: e.tagName, id: e.id, className: String(e.className), text: (e.textContent ?? '').slice(0, 100) }
              : null;
          const video = document.querySelector('video');
          return {
            url: location.href,
            active: identify(document.activeElement),
            events: (window as any).__g13Inputs ?? [],
            summary: [...document.querySelectorAll<HTMLDetailsElement>('details')].map((d) => ({
              open: d.open,
              text: d.querySelector('summary')?.textContent?.trim(),
            })),
            player: video
              ? {
                  paused: video.paused,
                  currentTime: video.currentTime,
                  readyState: video.readyState,
                  ended: video.ended,
                }
              : null,
          };
        })
        .catch((e) => ({ error: String(e) })),
    );
  }
  await info.attach('g13-input-diagnostics', {
    body: JSON.stringify(states, null, 2),
    contentType: 'application/json',
  });
});

test('native drag, text, keyboard and fullscreen controls remain usable with opaque artwork', async ({
  popup,
  youtube,
}, info) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
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
  // Compare against an actual decoded frame, rather than racing the fixture's
  // SVG poster -> canvas-stream frame transition beneath the transparent range.
  await youtube.getByRole('button', { name: 'Play', exact: true }).click();
  await youtube
    .locator('#movie_player video')
    .evaluate((v: HTMLVideoElement) => new Promise<void>((resolve) => v.requestVideoFrameCallback(() => resolve())));
  await youtube.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(youtube.locator('#movie_player video')).toHaveJSProperty('paused', true);
  const baseline = await run();
  const protectedBefore = await youtube.locator('#g1-seek').screenshot();
  await info.attach('native-seek-before', { body: protectedBefore, contentType: 'image/png' });
  const preserved = async (name: string) => {
    let picture = protectedBefore;
    try {
      await expect
        .poll(async () => {
          picture = await youtube.locator('#g1-seek').screenshot();
          return picture.equals(protectedBefore);
        })
        .toBe(true);
    } finally {
      await info.attach(name, { body: picture, contentType: 'image/png' });
    }
  };
  let { panel: editor } = await openEditor(popup, youtube);
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
  await editor.getByRole('button', { name: '編集を終了', exact: true }).first().click();
  await expect
    .poll(async () =>
      JSON.parse(
        (await youtube.locator('#around-decorations').getAttribute('data-around-safety')) ?? '{}',
      ).issues?.some((i: any) => i.severity === 'enforced'),
    )
    .toBe(true);
  await expect
    .poll(() => youtube.locator('#around-decorations').evaluate((host) => getComputedStyle(host).clipPath))
    .not.toBe('none');
  expect(await youtube.locator('#around-decorations').evaluate((host) => getComputedStyle(host).zIndex)).toBe('1');
  await preserved('native-seek-screen');
  expect(await run()).toEqual(baseline);
  // Repeat against the other production composition path: moving the original
  // opaque media into the player must never expose its reserved controls.
  ({ panel: editor } = await openEditor(popup, youtube));
  await exposeEditorControls(editor);
  await editor.locator('[data-layer-id] [data-action="select"]').click();
  await editor.getByLabel('配置の基準').selectOption('video-player');
  for (const name of ['画像のX位置', '画像のY位置']) {
    await editor.getByLabel(name, { exact: true }).fill('50');
    await editor.getByLabel(name, { exact: true }).press('Tab');
  }
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).first().click();
  const playerPaint = youtube.locator('#around-video-decorations');
  await expect(playerPaint.locator('[data-image-id]')).toBeVisible();
  await expect(playerPaint).toHaveCSS('clip-path', 'inset(64px 0px 112px)');
  await preserved('native-seek-player');
  expect(await run()).toEqual(baseline);
  // G1.2: the same opaque layer, now moving (it follows the pointer). Only the roots over a near
  // control are held; the controls stay usable while it moves everywhere else.
  const key = 'around.design.youtube';
  const saved = await popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key);
  const moving: DesignDocument = {
    ...saved,
    decorations: saved.decorations.map((layer) => ({ ...layer, motion: defaultFollowMotion() })),
  };
  parseDesign(moving);
  await popup.evaluate(async ({ k, design }) => chrome.storage.local.set({ [k]: design }), { k: key, design: moving });
  await expect
    .poll(
      async () =>
        JSON.parse((await youtube.locator('#around-decorations').getAttribute('data-around-safety')) ?? '{}').stopped,
    )
    .toBe('');
  await expect(playerPaint.locator('[data-image-id]')).toBeVisible();
  // It is held at the seek bar: the run below meets a moving layer that the approach holds.
  const seekBox = (await youtube.locator('#g1-seek').boundingBox())!;
  await youtube.mouse.move(seekBox.x + 20, seekBox.y + seekBox.height / 2, { steps: 4 });
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await youtube.locator('#around-decorations').getAttribute('data-around-safety')) ?? '{}',
        ).issues?.filter((i: any) => i.surfaceId === 'native.approach').length,
    )
    .toBe(1);
  // Off the seek bar again (its own hover colour is not part of the comparison), as before.
  const fullscreen = (await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).boundingBox())!;
  await youtube.mouse.move(fullscreen.x + fullscreen.width / 2, fullscreen.y + fullscreen.height / 2, { steps: 4 });
  await preserved('native-seek-moving');
  expect(await run()).toEqual(baseline);
  await youtube.screenshot({ path: info.outputPath('opaque-paint-native-controls.png') });
});

test('fullscreen keeps authored painting order across viewport and player anchors', async ({ popup, youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  const { panel: editor } = await openEditor(popup, youtube);
  const files = await youtube.evaluate(() =>
    ['red', 'blue'].map((color) => {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 16, 16);
      return { color, base64: c.toDataURL().split(',')[1]! };
    }),
  );
  await editor.getByLabel('画像素材を追加').setInputFiles(
    files.map((f) => ({
      name: f.color + '.png',
      mimeType: 'image/png',
      buffer: Buffer.from(f.base64, 'base64'),
    })),
  );
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).first().click();
  const design = await popup.evaluate(
    async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'] as DesignDocument,
  );
  design.decorations.forEach((layer, i) => {
    layer.placement = {
      anchor: i ? { kind: 'surface', target: 'video-player' } : { kind: 'viewport' },
      x: 0.5,
      y: 0.5,
      widthPx: 80,
      heightPx: 80,
      rotationDeg: 0,
    };
    layer.zIndex = i;
  });
  const store = () =>
    popup.evaluate(async (design) => chrome.storage.local.set({ 'around.design.youtube': design }), design);
  await store();
  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => youtube.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  const pixel = async () => {
    const { width, height } = youtube.viewportSize()!;
    const png = await youtube.screenshot({ clip: { x: width / 2 - 1, y: height / 2 - 1, width: 2, height: 2 } });
    return youtube.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]));
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }, png.toString('base64'));
  };
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  design.decorations.forEach((layer, i) => {
    layer.zIndex = 1 - i;
  });
  await store();
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
});

test('Studio exposes protection overlays, per-layer restrictions and emergency OFF', async ({
  popup,
  youtube,
  context,
  extensionId,
}, info) => {
  await context.addInitScript(() => {
    const identify = (e: Element | null) =>
      e
        ? { tag: e.tagName, id: e.id, className: String(e.className), text: (e.textContent ?? '').slice(0, 100) }
        : null;
    const records: unknown[] = ((window as any).__g13Inputs = []);
    for (const type of ['pointerdown', 'pointerup', 'click', 'focusin', 'keydown'])
      document.addEventListener(
        type,
        (event) => {
          const mouse = event instanceof MouseEvent ? event : null;
          records.push({
            type,
            at: performance.now(),
            target: identify(event.target as Element),
            active: identify(document.activeElement),
            hit: mouse ? identify(document.elementFromPoint(mouse.clientX, mouse.clientY)) : null,
            x: mouse?.clientX,
            y: mouse?.clientY,
          });
        },
        true,
      );
  });
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  const studio = await context.newPage();
  await studio.goto(`chrome-extension://${extensionId}/studio/index.html`);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.locator('#around-creator');
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.getByLabel('画像の幅', { exact: true }).fill('1600');
  await panel.getByLabel('画像の幅', { exact: true }).press('Tab');
  // UI0-d round 3: 操作チェック sits in the editor's header while a layer is restricted.
  await expect(studio.locator('.around-editor-safety li[data-issue-layer]')).toContainText(['制限中']);
  await expect(panel.locator('.safety-limited-badge')).toHaveText('制限中');
  await studio.locator('.around-editor-safety .safety-check > summary').click();
  await studio.getByLabel('操作面の保護範囲を表示').check();
  await expect(youtube.locator('#around-operation-check')).toHaveCount(1);
  await studio.screenshot({ path: info.outputPath('studio-operation-restriction.png') });
  await youtube.screenshot({ path: info.outputPath('operation-envelopes.png') });
  await studio.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator('#around-decorations')).toHaveCount(0);
  // UI0-d: one save chip, in the design system's words (was 未保存の変更 in the Studio).
  await expect(panel.locator('.dirty')).toHaveText('未保存');
});
