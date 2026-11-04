// The sparse-read bound (docs/g13-fix-verification.md, 古い位置の上限) in real drawing: an opaque layer
// that follows the pointer a little is drawn only when the pointer moves, so the source is read
// only then. Codex's order with pointer moves: a caught-up read after a quiet spell, the first
// group's check (300ms), that group's control moved with no mutation, the remaining groups caught
// up (520ms), and a read 100ms later (620ms). The moved control must not be under the drawn layer.
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';
import { exposeEditorControls } from './helpers/editor-workspace';
import { parseDesign } from '../src/design/schema';
import { defaultSignalRule } from '../src/signals/keyframes';
import type { DesignDocument } from '../src/design/types';
import { writeFile } from 'node:fs/promises';

test('G1.3: a control moved after its group was checked is not drawn over on sparse reads', async ({
  popup,
  youtube,
  context,
}, info) => {
  // Rows are read in the adapter's selector order (seek bar first) and then document order, so the
  // page's only seek bar is the first row of the answer check's first group. Last in the app, the
  // box paints above the page's cards, so the screenshot shows it.
  await youtube.addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const box = document.createElement('div');
      box.id = 'g13-sparse-box';
      box.style.cssText = 'position:fixed;left:300px;top:250px;width:500px;height:80px;display:flex;z-index:0';
      box.innerHTML =
        '<div id="below" style="display:flex;flex:none"><button id="g13-first" style="width:70px;height:40px">First</button></div><div id="secondary" style="flex:none"><div id="g13-second" class="ytp-progress-bar" style="width:70px;height:40px;background:#c00">Second</div></div>';
      document.querySelector('ytd-app')!.append(box);
    }),
  );
  await youtube.reload();
  await expect(youtube.locator('#g13-second')).toBeVisible();
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  const { panel } = await openEditor(popup, youtube);
  await exposeEditorControls(panel);
  const image = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    c.getContext('2d')!.fillRect(0, 0, 64, 48);
    return c.toDataURL().split(',')[1]!;
  });
  await panel
    .getByLabel('画像素材を追加')
    .setInputFiles({ name: 'opaque.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(youtube.locator('[data-image-id]').first()).toBeAttached();
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  const viewport = await youtube.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const key = 'webWorldThemes.design.youtube';
  const base = await popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key);
  // x 275–725, y 190–350: over both buttons (cut out by the clip) and where Second moves to.
  const follow = defaultSignalRule('g13-sparse', 'position.x', {
    signal: 'pointer.x',
    axis: 'x',
    space: 'viewport',
    inputRange: [0, 1],
  });
  follow.keyframes[0]!.value = 0;
  // At most 40px, so the layer stays over where Second moves to; each 10px move below is drawn.
  follow.keyframes[1]!.value = 40;
  const design: DesignDocument = {
    ...base,
    decorations: [
      {
        ...base.decorations[0]!,
        id: 'g13-sparse',
        name: 'g13-sparse',
        zIndex: 0,
        placement: {
          ...base.decorations[0]!.placement,
          anchor: { kind: 'viewport' },
          x: 500 / viewport.width,
          y: 270 / viewport.height,
          widthPx: 450,
          heightPx: 160,
          rotationDeg: 0,
        },
      },
    ],
    signalRules: [follow],
  };
  parseDesign(design);
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  const layer = '#web-world-themes-decorations';
  await expect
    .poll(() =>
      youtube.evaluate(
        (l) =>
          getComputedStyle(document.querySelector(l)!.shadowRoot!.querySelector('[data-image-id="g13-sparse"]')!)
            .visibility,
        layer,
      ),
    )
    .toBe('visible');
  // A hidden page subscribes to no signal, so the pointer would draw nothing. The other pages
  // close instead of bringToFront, which would take the keyboard focus.
  for (const page of context.pages()) if (page !== youtube) await page.close();
  await expect.poll(() => youtube.evaluate(() => document.hidden)).toBe(false);
  // Inside the viewport and away from every control, so no approach rule holds the layer.
  const pointer = (step: number) =>
    youtube.mouse.move(Math.round(viewport.width * 0.75) + step * 10, Math.round(viewport.height * 0.85));
  await pointer(0);
  await youtube.waitForTimeout(1500);
  const cdp = await context.newCDPSession(youtube);
  const screenshot = async (name: string) => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(info.outputPath(name), Buffer.from(result.data, 'base64'));
  };
  // Every frame from the first move on: is Second's centre under the drawn, opaque layer?
  await youtube.evaluate((l) => {
    const button = document.querySelector<HTMLElement>('#g13-second')!;
    const host = document.querySelector<HTMLElement>(l)!;
    const node = host.shadowRoot!.querySelector<HTMLElement>('[data-image-id="g13-sparse"]')!;
    const origin = performance.now();
    const rows: any[] = [];
    (window as any).g13Sparse = { origin, rows, done: false };
    const sample = () => {
      const r = button.getBoundingClientRect(),
        x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      const regions = [
        ...host.style
          .getPropertyValue('--ww-decoration-clip')
          .matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g),
      ].map((m) => m.slice(1).map(Number));
      const shown = getComputedStyle(node);
      rows.push({
        t: performance.now() - origin,
        x,
        moved: (window as any).g13SparseMovedAt !== undefined,
        covered:
          regions.some(([left, top, w, h]) => x > left! && x < left! + w! && y > top! && y < top! + h!) &&
          shown.visibility === 'visible' &&
          shown.opacity === '1',
        left: node.getBoundingClientRect().left,
      });
      if (performance.now() - origin < 900) requestAnimationFrame(sample);
      else (window as any).g13Sparse.done = true;
    };
    requestAnimationFrame(sample);
  }, layer);
  const at = async (ms: number) => {
    const elapsed = await youtube.evaluate(() => performance.now() - (window as any).g13Sparse.origin);
    await youtube.waitForTimeout(Math.max(0, ms - elapsed));
  };
  await pointer(1);
  await at(300);
  await pointer(2);
  // Right after the first group's check: Second moves under the layer with no mutation.
  await youtube.evaluate(() => {
    const animation = document
      .querySelector('#g13-second')!
      .animate([{ transform: 'translateX(0)' }, { transform: 'translateX(150px)' }], { duration: 1, fill: 'forwards' });
    animation.pause();
    animation.currentTime = 1;
    (window as any).g13SparseMovedAt = performance.now() - (window as any).g13Sparse.origin;
  });
  await at(520);
  await pointer(3);
  await at(620);
  await pointer(4);
  await at(680);
  await screenshot('after-sparse-reads.png');
  await expect.poll(() => youtube.evaluate(() => (window as any).g13Sparse.done)).toBe(true);
  const rows = await youtube.evaluate(() => (window as any).g13Sparse.rows);
  const movedAt = await youtube.evaluate(() => (window as any).g13SparseMovedAt);
  await info.attach('sparse-visual.json', {
    body: JSON.stringify({ movedAt, rows }, null, 2),
    contentType: 'application/json',
  });
  const drawn = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const native = await youtube.evaluate(() => {
    const r = document.querySelector('#g13-second')!.getBoundingClientRect();
    document
      .querySelector<HTMLElement>('#web-world-themes-decorations')!
      .style.setProperty('visibility', 'hidden', 'important');
    return { x: Math.ceil(r.left), y: Math.ceil(r.top), width: Math.floor(r.width), height: Math.floor(r.height) };
  });
  const reference = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const pixels = await youtube.evaluate(
    async ({ drawn, reference, native }) => {
      const read = async (base64: string) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]));
        const canvas = document.createElement('canvas');
        canvas.width = native.width;
        canvas.height = native.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, native.x, native.y, native.width, native.height, 0, 0, native.width, native.height);
        bitmap.close();
        return [...ctx.getImageData(0, 0, native.width, native.height).data];
      };
      const a = await read(drawn),
        b = await read(reference);
      let different = 0;
      for (let i = 0; i < a.length; i += 4) if (a.slice(i, i + 4).some((v, k) => v !== b[i + k])) different++;
      return { ...native, pixels: a.length / 4, different };
    },
    { drawn: drawn.data, reference: reference.data, native },
  );
  await writeFile(info.outputPath('final-drawing.png'), Buffer.from(drawn.data, 'base64'));
  await writeFile(info.outputPath('native-reference.png'), Buffer.from(reference.data, 'base64'));
  await info.attach('native-pixel-comparison.json', {
    body: JSON.stringify(pixels, null, 2),
    contentType: 'application/json',
  });
  await cdp.detach();
  // The layer is drawn on each pointer move only (so the source is read sparsely), not idle.
  const drawnAt = rows
    .filter((r: any, i: number) => i && Math.abs(r.left - rows[i - 1].left) > 0.01)
    .map((r: any) => Math.round(r.t));
  const covered = rows.filter((r: any) => r.moved && r.covered).map((r: any) => Math.round(r.t));
  console.log('SPARSE_VISUAL', JSON.stringify({ movedAt, frames: rows.length, drawnAt, covered }));
  expect(
    rows.filter((r: any) => !r.moved && r.covered),
    'cut out before the move',
  ).toEqual([]);
  expect(drawnAt.length, 'the layer is drawn by the pointer moves').toBeGreaterThanOrEqual(3);
  // Codex's order: the remaining groups are caught up at 520ms and the next read is at 620ms.
  // The caught-up read compares the moved control's group again, so nothing after it is covered.
  expect(covered.filter((t: number) => t > 600)).toEqual([]);
  expect(
    pixels.different,
    'every pixel of the native control must match the reference with the authored layer hidden',
  ).toBe(0);
});
