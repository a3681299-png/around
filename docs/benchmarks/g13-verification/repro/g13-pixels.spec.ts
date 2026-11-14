// Copy to tests/ before running. This is a verification test, not a product change.
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';
import { exposeEditorControls } from './helpers/editor-workspace';
import { parseDesign } from '../src/design/schema';
import type { DesignDocument } from '../src/design/types';
import { writeFile } from 'node:fs/promises';

test('G1.3: a resized group must not expose a control outside the group', async ({ popup, youtube, context }, info) => {
  await youtube.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.g13-independent-wide{width:180px!important}';
    document.head.append(style);
    const box = document.createElement('div');
    box.id = 'g13-independent-box';
    box.style.cssText =
      'position:fixed;left:300px;top:250px;width:500px;height:80px;display:flex;align-items:flex-start;z-index:0';
    box.innerHTML =
      '<div id="below" style="display:flex;flex:none"><button id="g13-first" style="width:70px;height:40px">First</button></div><div id="secondary" style="flex:none"><button id="g13-second" style="width:70px;height:40px">Second</button></div>';
    document.querySelector('ytd-app')!.append(box);
  });
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
  const key = 'around.design.youtube';
  const base = await popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key);
  const design: DesignDocument = {
    ...base,
    decorations: [
      {
        ...base.decorations[0]!,
        id: 'g13-witness',
        name: 'g13-witness',
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
    signalRules: [],
  };
  parseDesign(design);
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  await expect
    .poll(() =>
      youtube.evaluate(() =>
        Boolean(
          document.querySelector('#around-decorations')?.shadowRoot?.querySelector('[data-image-id="g13-witness"]'),
        ),
      ),
    )
    .toBe(true);
  await youtube.mouse.move(1050, 700);
  await expect
    .poll(() =>
      youtube.evaluate(
        () =>
          JSON.parse(document.querySelector('#around-decorations')?.getAttribute('data-around-safety') ?? '{}').stopped,
      ),
    )
    .toBe('');
  await youtube.waitForTimeout(800);
  await expect
    .poll(() =>
      youtube.evaluate(
        () =>
          getComputedStyle(
            document
              .querySelector('#around-decorations')!
              .shadowRoot!.querySelector<HTMLElement>('[data-image-id="g13-witness"]')!,
          ).visibility,
      ),
    )
    .toBe('visible');
  const cdp = await context.newCDPSession(youtube);
  const screenshot = async (name: string) => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(info.outputPath(name), Buffer.from(result.data, 'base64'));
  };
  await screenshot('before.png');
  await youtube.evaluate((mode) => {
    const button = document.querySelector<HTMLElement>('#g13-second')!;
    const host = document.querySelector<HTMLElement>('#around-decorations')!;
    const node = host.shadowRoot!.querySelector<HTMLElement>('[data-image-id="g13-witness"]')!;
    const sample = () => {
      const r = button.getBoundingClientRect(),
        x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      const regions = [
        ...host.style
          .getPropertyValue('--around-decoration-clip')
          .matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g),
      ].map((m) => m.slice(1).map(Number));
      return {
        t: performance.now(),
        x,
        y,
        hit: document.elementFromPoint(x, y)?.id,
        inDrawableClip: regions.some(([l, t, w, h]) => x > l! && x < l! + w! && y > t! && y < t! + h!),
        visible: getComputedStyle(node).visibility === 'visible',
        opacity: getComputedStyle(node).opacity,
        safety: JSON.parse(host.dataset.aroundSafety ?? '{}'),
      };
    };
    const samples = [{ phase: 'before', ...sample() }];
    (window as any).g13PixelWitness = { samples, done: false };
    if (mode === 'subtree') {
      const added = document.createElement('span');
      added.style.cssText = 'display:block;flex:none;width:110px;height:40px';
      document.querySelector('#g13-independent-box #below')!.append(added);
    } else document.querySelector<HTMLElement>('#g13-first')!.classList.add('g13-independent-wide');
    const record = () => {
      samples.push({ phase: 'after', ...sample() });
      if (samples.length <= 30) requestAnimationFrame(record);
      else (window as any).g13PixelWitness.done = true;
    };
    requestAnimationFrame(record);
  }, process.env.G13_WITNESS ?? 'look');
  await screenshot('during.png');
  await expect.poll(() => youtube.evaluate(() => (window as any).g13PixelWitness.done)).toBe(true);
  const rows = await youtube.evaluate(() => (window as any).g13PixelWitness.samples);
  await info.attach('pixels.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  await cdp.detach();
  expect(
    rows.filter((r: any) => r.phase === 'after' && r.inDrawableClip && r.visible && r.opacity === '1'),
    'a visible opaque layer must not paint over the moved native control',
  ).toEqual([]);
});
