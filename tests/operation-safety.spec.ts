import { build } from 'esbuild';
import type { Page } from '@playwright/test';
import { test, expect, launchExtension } from './fixtures';
import { noIdleRecheckBuild } from './helpers/no-idle-recheck-build';
import { layeringBuild } from './helpers/layering-build';
import { openEditor } from './helpers/editor';
import path from 'node:path';
import { exposeEditorControls, withCanvas } from './helpers/editor-workspace';
import type { DesignDocument } from '../src/design/types';
import { parseDesign } from '../src/design/schema';
import { defaultScrollOpacityRule, defaultSignalRule, type SignalRule } from '../src/signals/keyframes';

async function probeCode(trace = true) {
  const result = await build({
    stdin: {
      contents: `export {youtubeOperations} from './src/sites/youtube-operations'; export {createCompositionReader,createDrawReads,nativeAbove,scrollsWithPage,fixedContainingBlock} from './src/host/operation-composition'; export {createOperationSource} from './src/host/operation-source'; export {createOperationGuardHost} from './src/host/operation-guard'; export {safePaintRegions} from './src/world/operations'; export {evaluatePreparedWorld,initialWorldState} from './src/world/evaluate'; export {evaluateLayout} from './src/world/layout'; export {worldScenario} from './tests/helpers/world-scenario';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'G1Probe',
    ...(trace ? {} : { dropLabels: ['AROUND_GUARD_TRACE'] }),
  });
  return result.outputFiles[0]!.text;
}

/** check() reads the state before it waits; the popup shows a disabled, unchecked placeholder
 * until settings load (then ON), so a check() started early would turn it OFF. */
async function showArtwork(popup: Page) {
  const toggle = popup.getByRole('switch', { name: '作品を表示する' });
  await expect(toggle).toBeEnabled();
  await toggle.check();
}

test('default artwork retains its decoder while the compositor clips protected regions', async ({ popup, youtube }) => {
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e84f83';
    ctx.fillRect(16, 0, 48, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'transparent.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await expect(editor.locator('.dirty')).toHaveText('未保存');
  try {
    await expect(youtube.locator('#around-decorations img')).toBeVisible();
  } catch (error) {
    console.log('Safety state:', await youtube.locator('#around-decorations').getAttribute('data-around-safety'));
    throw error;
  }
});

async function opaqueArtwork(popup: Page, youtube: Page) {
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    c.getContext('2d')!.fillRect(0, 0, 64, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'opaque.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await expect(youtube.locator('[data-image-id]').first()).toBeAttached();
  return editor;
}
// Editor changes briefly pause drawing until the native geometry is stable again.
const settled = (youtube: Page) =>
  expect
    .poll(
      async () =>
        JSON.parse((await youtube.locator('#around-decorations').getAttribute('data-around-safety')) ?? '{}').stopped,
    )
    .toBe('');
const planeOf = (youtube: Page) =>
  youtube.evaluate(() => {
    const node = [
      '#around-decorations',
      '#around-page-decorations',
      '#around-atmosphere-decorations',
      '#around-video-decorations',
    ].find((id) => document.querySelector(id)?.shadowRoot?.querySelector('[data-image-id]'));
    return node ?? null;
  });

test('atmosphere artwork crosses protected controls under one capped plane and never takes input', async ({
  popup,
  youtube,
}) => {
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByLabel('画像の幅').fill('1800');
  await editor.getByLabel('画像の高さ').fill('1000');
  await editor.getByLabel('描画モード').selectOption('atmosphere');
  await expect.poll(() => planeOf(youtube)).toBe('#around-atmosphere-decorations');
  await settled(youtube);
  const result = await youtube.evaluate(() => {
    const plane = document.querySelector<HTMLElement>('#around-atmosphere-decorations')!,
      screen = document.querySelector<HTMLElement>('#around-decorations')!;
    const node = plane.shadowRoot!.querySelector<HTMLElement>('[data-image-id]')!;
    const safety = JSON.parse(screen.dataset.aroundSafety ?? '{}');
    return {
      opacity: Number(getComputedStyle(plane).opacity),
      clip: getComputedStyle(plane).clipPath,
      filter: getComputedStyle(node).filter,
      nodePointer: getComputedStyle(node).pointerEvents,
      visibility: node.style.visibility,
      belowScreen: Boolean(plane.compareDocumentPosition(screen) & Node.DOCUMENT_POSITION_FOLLOWING),
      issues: safety.issues ?? [],
    };
  });
  expect(result.opacity).toBeCloseTo(0.33, 5);
  expect(result.clip).toBe('none');
  expect(result.filter).toBe('none');
  expect(result.nodePointer).toBe('none');
  expect(result.visibility).toBe('');
  expect(result.belowScreen).toBe(true);
  expect(result.issues.filter((i: any) => i.severity === 'enforced' && i.action !== 'flatten')).toEqual([]);
  // The native control under the translucent plane is still the real hit target.
  const button = youtube.getByRole('button', { name: 'All', exact: true });
  expect(
    await button.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === element;
    }),
  ).toBe(true);
  await button.click();
});

test('editing owns the center of a real-style player whose media sits on its own z-index, but never its bands', async ({
  popup,
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  // YouTube puts the media in a positioned container with z-index 10 (the fixture's player does).
  expect(
    await youtube.evaluate(() => {
      const container = document.querySelector<HTMLElement>('#movie_player video')!.parentElement!;
      return container.classList.contains('html5-video-container') && getComputedStyle(container).zIndex;
    }),
  ).toBe('10');
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByLabel('配置の基準').selectOption('video-player');
  await editor.getByLabel('画像の幅').fill('120');
  await editor.getByLabel('画像の高さ').fill('80');
  // In the middle of the video, well inside the bands.
  await editor.getByLabel('画像のX位置').fill('50');
  await editor.getByLabel('画像のY位置').fill('50');
  await expect.poll(() => planeOf(youtube)).toBe('#around-video-decorations');
  await settled(youtube);
  const node = youtube.locator('#around-video-decorations [data-image-id]');
  const hit = (point: { x: number; y: number }) =>
    node.evaluate((element, p) => {
      let target = element.ownerDocument.elementFromPoint(p.x, p.y);
      while (target?.shadowRoot) {
        const next = target.shadowRoot.elementFromPoint(p.x, p.y);
        if (!next || next === target) break;
        target = next;
      }
      return { own: Boolean(target && (target === element || element.contains(target))), tag: target?.tagName };
    }, point);
  // The editor panel can cover the player in this viewport; collapse it like other canvas checks.
  await withCanvas(youtube, async () => {
    const box = (await node.boundingBox())!;
    const player = (await youtube.locator('#movie_player').boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await hit(center)).toMatchObject({ own: true });
    // The bottom control band stays native while editing.
    expect(await hit({ x: player.x + 60, y: player.y + player.height - 40 })).toMatchObject({ own: false });
    await youtube.mouse.move(center.x, center.y);
    await youtube.mouse.down();
    await youtube.mouse.move(center.x - 30, center.y + 10, { steps: 6 });
    await youtube.mouse.up();
    await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(box.x - 30, 0);
  });
});

/** Viewport artwork centred on the player's video, with the editor panel collapsed. */
async function viewportArtworkOverVideo(popup: Page, youtube: Page) {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByLabel('画像の幅').fill('120');
  await editor.getByLabel('画像の高さ').fill('80');
  const at = await youtube.locator('#movie_player').evaluate((player) => {
    const r = player.getBoundingClientRect();
    // The middle of the coverable centre, between the 64px and 112px control bands.
    const y = r.top + 64 + (r.height - 176) / 2;
    return { x: ((r.left + r.width / 2) / innerWidth) * 100, y: (y / innerHeight) * 100 };
  });
  await editor.getByLabel('画像のX位置').fill(at.x.toFixed(2));
  await editor.getByLabel('画像のY位置').fill(at.y.toFixed(2));
  await expect.poll(() => planeOf(youtube)).toBe('#around-decorations');
  await settled(youtube);
  const node = youtube.locator('#around-decorations [data-image-id]');
  const hit = (point: { x: number; y: number }) =>
    node.evaluate((element, p) => {
      let target = element.ownerDocument.elementFromPoint(p.x, p.y);
      while (target?.shadowRoot) {
        const next = target.shadowRoot.elementFromPoint(p.x, p.y);
        if (!next || next === target) break;
        target = next;
      }
      return { own: Boolean(target && (target === element || element.contains(target))), tag: target?.tagName };
    }, point);
  return { node, hit };
}

test('editing lets viewport artwork own the verified video centre, never the bands', async ({ popup, youtube }) => {
  const { node, hit } = await viewportArtworkOverVideo(popup, youtube);
  await withCanvas(youtube, async () => {
    await settled(youtube);
    const box = (await node.boundingBox())!;
    const player = (await youtube.locator('#movie_player').boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await hit(center)).toMatchObject({ own: true });
    // Both control bands stay native while editing.
    expect(await hit({ x: center.x, y: player.y + player.height - 40 })).toMatchObject({ own: false });
    expect(await hit({ x: center.x, y: player.y + 20 })).toMatchObject({ own: false });
    await youtube.mouse.move(center.x, center.y);
    await youtube.mouse.down();
    await youtube.mouse.move(center.x - 30, center.y + 10, { steps: 6 });
    await youtube.mouse.up();
    await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(box.x - 30, 0);
  });
});

/** The build without the idle recheck (G1.4): its timer could update the clip before the press
 * below, on CI between the move and the stale-handle check (run 41772161277), so the input-time
 * defence would not be what is tested. The input must still be refused and reach the player. */
const withoutIdleRecheck = test.extend({
  context: async ({ profile, layering }, use) => {
    // The same way as the project (docs/layering-plan.md): the build under test, or the other one.
    const extensionPath =
      layering === undefined
        ? await noIdleRecheckBuild()
        : await layeringBuild(layering, { AROUND_NO_IDLE_RECHECK: '1' });
    const context = await launchExtension(profile, true, { extensionPath });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

withoutIdleRecheck(
  'a stale screen-plane handle over a moved control band never takes the input meant for it',
  async ({ popup, youtube }) => {
    const { node, hit } = await viewportArtworkOverVideo(popup, youtube);
    await withCanvas(youtube, async () => {
      await settled(youtube);
      const box = (await node.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      expect(await hit(center)).toMatchObject({ own: true });
      // Move the player like an asynchronous scroll would, with no DOM mutation, resize or scroll
      // event: its bottom control band now lies under the handle while the clip is still stale.
      const native = await youtube.locator('#movie_player').evaluate((player, y) => {
        const r = player.getBoundingClientRect();
        const shift = r.bottom - 56 - y;
        player.animate([{ transform: `translateY(${-shift}px)` }, { transform: `translateY(${-shift}px)` }], {
          duration: 600000,
          fill: 'forwards',
        });
        const w = window as unknown as { nativeClicks: number };
        w.nativeClicks = 0;
        player.addEventListener('click', (event) => {
          if (!event.composedPath().some((n) => n instanceof Element && n.id.startsWith('around'))) w.nativeClicks++;
        });
        return { shift };
      }, center.y);
      expect(native.shift).toBeGreaterThan(50);
      await youtube.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      // The scenario is real: the stale handle is still the hit target over the band.
      expect(await hit(center)).toMatchObject({ own: true });
      await youtube.mouse.move(center.x, center.y);
      await youtube.mouse.down();
      await youtube.mouse.move(center.x - 30, center.y - 10, { steps: 6 });
      await youtube.mouse.up();
      // No gesture started: the artwork did not move.
      expect((await node.boundingBox())!.x).toBeCloseTo(box.x, 0);
      // The handle no longer covers the band; the next press reaches the native player.
      await expect.poll(async () => (await hit(center)).own).toBe(false);
      await youtube.mouse.click(center.x, center.y);
      expect(await youtube.evaluate(() => (window as unknown as { nativeClicks: number }).nativeClicks)).toBe(1);
    });
  },
);

/** A visible native button in the middle of the player, like YouTube's large play button on a
 * video that has not started. Its clicks are counted. */
async function centralPlayButton(youtube: Page) {
  await youtube.locator('#movie_player').evaluate((player) => {
    const button = document.createElement('button');
    button.className = 'ytp-large-play-button ytp-button';
    button.setAttribute('aria-label', 'Play');
    button.style.cssText =
      'position:absolute;left:50%;top:50%;width:68px;height:48px;transform:translate(-50%,-50%);z-index:20';
    const w = window as unknown as { centralClicks: number };
    w.centralClicks = 0;
    button.addEventListener('click', () => w.centralClicks++);
    player.append(button);
  });
  // Read when needed: collapsing the editor panel resizes the player.
  return async () =>
    youtube.locator('.ytp-large-play-button').evaluate((button) => {
      const r = button.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
}
/** Places the selected artwork (percent of its frame) so its centre is `dx` left of the player centre. */
async function besideCentre(youtube: Page, editor: import('@playwright/test').Locator, frame: 'viewport' | 'player') {
  const at = await youtube.locator('#movie_player').evaluate((player, frame) => {
    const r = player.getBoundingClientRect();
    const x = r.left + r.width / 2 - 150,
      y = r.top + r.height / 2;
    return frame === 'viewport'
      ? { x: (x / innerWidth) * 100, y: (y / innerHeight) * 100 }
      : { x: ((x - r.left) / r.width) * 100, y: ((y - r.top) / r.height) * 100 };
  }, frame);
  await editor.getByLabel('画像のX位置').fill(at.x.toFixed(2));
  await editor.getByLabel('画像のY位置').fill(at.y.toFixed(2));
}
const hitOwn = (node: import('@playwright/test').Locator, point: { x: number; y: number }) =>
  node.evaluate((element, p) => {
    let target = element.ownerDocument.elementFromPoint(p.x, p.y);
    while (target?.shadowRoot) {
      const next = target.shadowRoot.elementFromPoint(p.x, p.y);
      if (!next || next === target) break;
      target = next;
    }
    return Boolean(target && (target === element || element.contains(target)));
  }, point);

test('editing keeps the video centre while a central native button is visible, and the button stays native', async ({
  popup,
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const button = await centralPlayButton(youtube);
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByLabel('画像の幅').fill('120');
  await editor.getByLabel('画像の高さ').fill('80');
  await besideCentre(youtube, editor, 'viewport');
  await expect.poll(() => planeOf(youtube)).toBe('#around-decorations');
  const node = youtube.locator('#around-decorations [data-image-id]');
  await withCanvas(youtube, async () => {
    await settled(youtube);
    const box = (await node.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await hitOwn(node, center)).toBe(true);
    await youtube.mouse.move(center.x, center.y);
    await youtube.mouse.down();
    await youtube.mouse.move(center.x - 30, center.y + 10, { steps: 6 });
    await youtube.mouse.up();
    await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(box.x - 30, 0);
    // The real button keeps its clicks while editing.
    const at = await button();
    await youtube.mouse.click(at.x, at.y);
    expect(await youtube.evaluate(() => (window as unknown as { centralClicks: number }).centralClicks)).toBe(1);
  });
});

test('player artwork moved to the page plane by a central button can still be edited over the video centre', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const button = await centralPlayButton(youtube);
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByLabel('配置の基準').selectOption('video-player');
  await editor.getByLabel('画像の幅').fill('120');
  await editor.getByLabel('画像の高さ').fill('80');
  await besideCentre(youtube, editor, 'player');
  // Cut out: a central native control keeps the player-local plane unavailable, the artwork follows
  // the page. Layering (chunk 4): it stays under the controls while editing, the button (z 20) over
  // it by stacking order.
  const plane = layeringOn ? '#around-video-decorations' : '#around-page-decorations';
  await expect.poll(() => planeOf(youtube)).toBe(plane);
  const node = youtube.locator(`${plane} [data-image-id]`);
  await withCanvas(youtube, async () => {
    await settled(youtube);
    const box = (await node.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await hitOwn(node, center)).toBe(true);
    await youtube.mouse.move(center.x, center.y);
    await youtube.mouse.down();
    await youtube.mouse.move(center.x - 30, center.y + 10, { steps: 6 });
    await youtube.mouse.up();
    await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(box.x - 30, 0);
    // The real button keeps its clicks while editing, either way.
    const at = await button();
    await youtube.mouse.click(at.x, at.y);
    expect(await youtube.evaluate(() => (window as unknown as { centralClicks: number }).centralClicks)).toBe(1);
  });
});

test('player artwork follows the page when the player-local plane is unavailable and avoids only current rectangles', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  // Layering needs no band in the player (it is under the controls, not cut out of them): a short
  // player keeps it in the player. The cut-out way's page plane is checked in g1-other-way.
  test.skip(layeringOn, 'Cut-out way only: layering keeps a short player local.');
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByLabel('配置の基準').selectOption('video-player');
  await editor.getByLabel('画像の幅').fill('600');
  await editor.getByLabel('画像の高さ').fill('300');
  // A player this short has no verified local band, which used to leave only the screen plane.
  await youtube.locator('#movie_player').evaluate((player: HTMLElement) => {
    player.style.height = '150px';
  });
  await expect.poll(() => planeOf(youtube)).toBe('#around-page-decorations');
  await settled(youtube);
  const result = await youtube.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const plane = document.querySelector<HTMLElement>('#around-page-decorations')!,
      screen = document.querySelector<HTMLElement>('#around-decorations')!;
    const node = plane.shadowRoot!.querySelector<HTMLElement>('[data-image-id]')!;
    await frame();
    const before = node.getBoundingClientRect().top;
    const origin = plane.getBoundingClientRect();
    window.scrollBy(0, 120);
    await frame();
    await frame();
    return {
      moved: before - node.getBoundingClientRect().top,
      origin: { left: origin.left + scrollX, top: origin.top + scrollY - 120 },
      clip: plane.style.getPropertyValue('--around-decoration-clip'),
      order: Boolean(plane.compareDocumentPosition(screen) & Node.DOCUMENT_POSITION_FOLLOWING),
      sameParent: plane.parentElement === screen.parentElement,
    };
  });
  expect(result.moved).toBeCloseTo(120, 0);
  expect(Math.abs(result.origin.left)).toBeLessThan(1);
  expect(Math.abs(result.origin.top)).toBeLessThan(1);
  expect(result.clip).toContain('path(');
  expect(result.order).toBe(true);
  expect(result.sameParent).toBe(true);
});

test('redraws over unchanged protection geometry leave the clip and safety record untouched', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    c.getContext('2d')!.fillRect(0, 0, 64, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'opaque.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await expect(youtube.locator('#around-decorations img')).toBeVisible();
  const result = await youtube.evaluate(async () => {
    const host = document.querySelector('#around-decorations')!;
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // The new layer's reads arrive in a burst and are held until their coalescing window ends; wait
    // for that hold to clear (any stop, whatever its wording), then let one more window pass so the
    // first resize, like the others, is read on its own rather than inside the last read's window.
    for (let i = 0; i < 60 && !host.getAttribute('data-around-safety')?.includes('"stopped":""'); i++) await frame();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await frame();
    // An exhausted wait must fail even when an already-stopped renderer makes no further writes.
    const ready = JSON.parse(host.getAttribute('data-around-safety') ?? '{}').stopped;
    const clip = (host as HTMLElement).style.getPropertyValue('--around-decoration-clip');
    const writes: string[] = [];
    const observer = new MutationObserver((records) => records.forEach((r) => writes.push(r.attributeName!)));
    observer.observe(host, { attributes: true, attributeFilter: ['style', 'data-around-safety'] });
    // Each resize marks the source and forces a redraw; the geometry itself is unchanged.
    // They are spaced past the coalescing window, so each one is read on its own.
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event('resize'));
      await frame();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    observer.disconnect();
    return { clip, writes, ready };
  });
  expect(result.ready).toBe('');
  expect(result.clip).toContain('path(');
  expect(result.writes).toEqual([]);
});

test('shared ancestry preserves stacking proofs and a new read sees changed native styles', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    const root = document.querySelector<HTMLElement>('ytd-app')!;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;z-index:20';
    container.innerHTML = '<div><div>' + '<button>native</button>'.repeat(300) + '</div></div>';
    root.append(container);
    const controls = [...container.querySelectorAll('button')];
    const original = window.getComputedStyle.bind(window);
    let calls = 0;
    window.getComputedStyle = (...args) => {
      calls++;
      return original(...args);
    };
    const reader = api.createCompositionReader(document);
    const actual = controls.map((el) => [reader.scrolls(el), reader.above(el, root, 1)]);
    const sharedCalls = calls;
    window.getComputedStyle = original;
    const expected = controls.map((el) => [api.scrollsWithPage(el), api.nativeAbove(el, root, 1)]);
    container.style.zIndex = '0';
    const next = api.createCompositionReader(document);
    const updated = next.above(controls[0], root, 1);
    container.style.position = 'absolute';
    const followsPage = api.createCompositionReader(document).scrolls(controls[0]);
    // An inner high z-index must not escape its outer stacking context.
    const nested = container.firstElementChild as HTMLElement;
    nested.style.cssText = 'position:relative;z-index:999';
    const nestedAbove = api.createCompositionReader(document).above(controls[0], root, 1);
    container.style.zIndex = '2';
    nested.style.zIndex = '-999';
    const outerAbove = api.createCompositionReader(document).above(controls[0], root, 1);
    container.remove();
    return {
      same: JSON.stringify(actual) === JSON.stringify(expected),
      sharedCalls,
      updated,
      followsPage,
      nestedAbove,
      outerAbove,
      first: actual[0],
    };
  });
  expect(result.same).toBe(true);
  expect(result.sharedCalls).toBeLessThan(320);
  expect(result.first).toEqual([false, true]);
  expect(result.updated).toBe(false);
  expect(result.followsPage).toBe(true);
  expect(result.nestedAbove).toBe(false);
  expect(result.outerAbove).toBe(true);
});

test('native mutations hide artwork immediately and defer geometry until the next sample', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const source = api.youtubeOperations(document),
      capture = source.capture.bind(source);
    let reads = 0,
      holds = 0;
    source.capture = () => {
      reads++;
      return capture();
    };
    const host = api.createOperationGuardHost(document, source, (stop: boolean) => {
      if (stop) holds++;
    });
    reads = 0;
    const button = document.createElement('button');
    button.style.cssText = 'position:absolute;left:200px;top:300px;width:44px;height:44px';
    document.querySelector('ytd-app')!.append(button);
    await Promise.resolve();
    const before = { reads, holds };
    host.sample(performance.now());
    const after = {
      reads,
      stopped: host.snapshot().stopped,
      found: host
        .snapshot()
        .surfaces.surfaces.some((s: any) => s.shape.left === 200 && s.shape.top === 300 && s.shape.width === 44),
    };
    host.destroy();
    button.remove();
    return { before, after };
  });
  expect(result.before).toEqual({ reads: 0, holds: 1 });
  expect(result.after.reads).toBe(1);
  expect(result.after.found).toBe(true);
  expect(result.after.stopped).toBeTruthy();
});

test('YouTube operation snapshots contain numeric geometry and detect replacement before input', async ({
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe,
      source = api.youtubeOperations(document),
      first = source.capture();
    const input = document.querySelector('yt-searchbox input')!;
    const next = input.cloneNode(true);
    input.replaceWith(next);
    const valid = source.validate(first, new KeyboardEvent('keydown'));
    const latest = source.capture();
    const forged = source.validate({ ...latest });
    const frozen = Object.isFrozen(latest.surfaces[0].policy);
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    player.style.position = 'fixed';
    const fixedSlot = source.videoSlot();
    player.style.removeProperty('position');
    await player.requestFullscreen();
    source.validate(latest, new KeyboardEvent('keydown')); // Force a fresh numeric snapshot.
    const fullscreen = source.capture();
    const outsideVisible = fullscreen.surfaces.some((s: any) => s.id.startsWith('comment.') && s.availability.visible);
    const fullscreenHit = source.validate(fullscreen, new PointerEvent('pointerdown', { clientX: 550, clientY: 380 }));
    await document.exitFullscreen();
    source.destroy();
    return { first, latest, valid, forged, frozen, hasFixedSlot: Boolean(fixedSlot), outsideVisible, fullscreenHit };
  });
  expect(result.valid).toBe(false);
  expect(result.forged).toBe(false);
  expect(result.frozen).toBe(true);
  expect(result.hasFixedSlot).toBe(false);
  expect(result.outsideVisible).toBe(false);
  expect(result.fullscreenHit).toBe(true);
  expect(result.latest.generation.geometry).toBeGreaterThan(result.first.generation.geometry);
  expect(result.first.surfaces.some((s: any) => s.id === 'player.controls.bottom' && s.kind === 'drag')).toBe(true);
  expect(result.first.surfaces.some((s: any) => s.id.startsWith('comment.') && s.kind === 'text-input')).toBe(true);
  expect(JSON.stringify(result.first)).not.toContain('element');
});

test('Host pauses before mismatched input, recovers only when stable, and excludes hidden time from idle', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe,
      source = api.youtubeOperations(document);
    let immediate = 0;
    const host = api.createOperationGuardHost(document, source, (stop: boolean) => {
      if (stop) immediate++;
    });
    const now = performance.now();
    host.sample(now);
    host.pause('test geometry mismatch', true);
    const paused = host.snapshot().stopped;
    host.sample(now + 100);
    const early = host.snapshot().stopped;
    host.sample(now + 500);
    const recovered = host.snapshot().stopped;
    const idle = host.sample(now + 2000).idleSeconds;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hidden = host.sample(now + 10000).idleSeconds;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    const visible = host.sample(performance.now()).idleSeconds;
    host.pause('repeat 2', true);
    host.pause('repeat 3', true);
    host.sample(now + 20000);
    const latched = host.snapshot().stopped;
    host.destroy();
    const scoped = api.createOperationGuardHost(document, api.youtubeOperations(document), () => undefined);
    scoped.sample(performance.now());
    const paints = ['image', 'model'].map((id) => ({
      id,
      bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      opacity: 0,
      pointerEvents: false,
      outset: 0,
      composition: 'overlay',
    }));
    for (let i = 0; i < 3; i++) scoped.pause('model context lost', true, ['model']);
    scoped.sample(performance.now() + 1000);
    const scopedStops = [...scoped.commit(paints)];
    scoped.destroy();
    return { immediate, paused, early, recovered, idle, hidden, visible, latched, scopedStops };
  });
  expect(result.immediate).toBe(3);
  expect(result.paused).toBeTruthy();
  expect(result.early).toBeTruthy();
  expect(result.recovered).toBe('');
  expect(result.idle).toBeGreaterThan(1);
  expect(result.hidden).toBe(0);
  expect(result.visible).toBeLessThan(0.1);
  expect(result.latched).toBe('repeat 3');
  expect(result.scopedStops).toEqual(['model']);
});

test('the player unmute button is protected as a button, not as a menu covering the window', async ({ youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    // YouTube shows this after a muted autoplay; it carries the ytp-popup class of its menus.
    const unmute = document.createElement('button');
    unmute.className = 'ytp-unmute ytp-popup ytp-button';
    unmute.textContent = 'Tap to unmute';
    unmute.style.cssText = 'position:absolute;left:12px;top:70px;width:140px;height:40px;z-index:60';
    document.querySelector('#movie_player')!.append(unmute);
    const source = api.youtubeOperations(document);
    const snapshot = source.capture();
    const r = unmute.getBoundingClientRect();
    const row = snapshot.surfaces.find(
      (s: any) => s.shape.left === r.left && s.shape.top === r.top && s.shape.width === r.width,
    );
    const regions = api.safePaintRegions(snapshot, false);
    const inside = (x: number, y: number) =>
      regions.some((q: any) => x >= q.left && x < q.left + q.width && y >= q.top && y < q.top + q.height);
    source.destroy();
    return {
      kind: row?.kind,
      envelope: row && [row.protectedEnvelope.width, row.protectedEnvelope.height],
      viewport: [innerWidth, innerHeight],
      onButton: inside(r.left + 10, r.top + 10),
      elsewhere: inside(innerWidth - 20, innerHeight - 20),
    };
  });
  expect(result.kind).toBe('click');
  expect(result.envelope).toEqual([148, 48]);
  expect(result.onButton).toBe(false);
  // The rest of the page can still be painted.
  expect(result.elsewhere).toBe(true);
});

test('leaving a native control restores motion after hysteresis without another pointer event', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    let pending = false;
    const host = api.createOperationGuardHost(document, api.youtubeOperations(document), () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame((time) => {
          pending = false;
          host.sample(time);
        });
      }
    });
    host.sample(performance.now());
    host.commit([
      {
        id: 'motion',
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        opacity: 0,
        pointerEvents: false,
        outset: 0,
        composition: 'overlay',
        dynamic: true,
      },
    ]);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 180 }));
    (window as any).g1Approach = () => host.snapshot().approaching;
    (window as any).g1FinishApproach = () => host.destroy();
  });
  await expect.poll(() => youtube.evaluate(() => (window as any).g1Approach())).toBe(true);
  await youtube.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { clientX: 850, clientY: 500 })));
  await expect.poll(() => youtube.evaluate(() => (window as any).g1Approach())).toBe(false);
  await youtube.evaluate(() => (window as any).g1FinishApproach());
});

type Rect = { left: number; top: number; width: number; height: number };
interface SeededLayer {
  id: string;
  /** Viewport centre and size, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Saves `layers` (copies of one opaque image) as screen-plane artwork with `rules`, then ends
 * editing so only the page's own guard, renderer and pointer remain. */
async function seedLayers(
  popup: Page,
  youtube: Page,
  layers: readonly SeededLayer[],
  rules: (viewport: { width: number; height: number }) => SignalRule[],
) {
  const editor = await opaqueArtwork(popup, youtube);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('.status')).toHaveText('保存しました。');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
  const viewport = await youtube.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const key = 'around.design.youtube';
  const base = await popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key);
  const design: DesignDocument = {
    ...base,
    decorations: layers.map((layer, zIndex) => ({
      ...base.decorations[0]!,
      id: layer.id,
      name: layer.id,
      zIndex,
      placement: {
        ...base.decorations[0]!.placement,
        anchor: { kind: 'viewport' },
        x: layer.x / viewport.width,
        y: layer.y / viewport.height,
        widthPx: layer.width,
        heightPx: layer.height,
        rotationDeg: 0,
      },
    })),
    signalRules: rules(viewport),
  };
  // The content script accepts only a valid document; fail here with the reason instead.
  parseDesign(design);
  await popup.evaluate(async ({ k, design }) => chrome.storage.local.set({ [k]: design }), { k: key, design });
  await expect
    .poll(() =>
      youtube.evaluate(() =>
        [
          ...(document
            .querySelector('#around-decorations')
            ?.shadowRoot?.querySelectorAll<HTMLElement>('[data-image-id]') ?? []),
        ]
          .map((node) => node.dataset.imageId)
          .sort(),
      ),
    )
    .toEqual(layers.map((layer) => layer.id).sort());
  await settled(youtube);
}
/** Layers flattened by an approach (G1.2): only the held roots. */
const heldLayers = (youtube: Page) =>
  youtube.locator('#around-decorations').evaluate((host: HTMLElement) =>
    (JSON.parse(host.dataset.aroundSafety ?? '{"issues":[]}').issues as { layerId: string; surfaceId: string }[])
      .filter((issue) => issue.surfaceId === 'native.approach')
      .map((issue) => issue.layerId)
      .sort(),
  );
/** What a layer shows: its opacity times every element's down to the picture. */
const alphaOf = (youtube: Page, id: string) =>
  youtube.evaluate((id) => {
    const node = document
      .querySelector('#around-decorations')!
      .shadowRoot!.querySelector<HTMLElement>(`[data-image-id="${id}"]`)!;
    let alpha = 1;
    for (
      let element: Element | null = node.querySelector('img, canvas, video');
      element;
      element = element.parentElement
    ) {
      alpha *= Number(getComputedStyle(element).opacity);
      if (element === node) break;
    }
    return alpha;
  }, id);
/** Room to scroll, below everything the page draws (no control is added). */
const scrollRoom = (youtube: Page) =>
  youtube.evaluate(() => {
    const room = document.createElement('div');
    room.id = 'g12-scroll-room';
    room.style.height = '3000px';
    document.querySelector('ytd-page-manager')!.append(room);
  });
const scrollToProgress = (youtube: Page, progress: number) =>
  youtube.evaluate(async (progress) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo(0, Math.round(max * progress));
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  }, progress);
const centreOf = (r: Rect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

test('G1.2 ①②④: near a control, only the layer over it is held; a layer elsewhere keeps following the scroll', async ({
  popup,
  youtube,
}) => {
  await scrollRoom(youtube);
  // The masthead is fixed: its Account button stays under a resting pointer while the page scrolls.
  const account = await youtube.getByRole('button', { name: 'Account' }).evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const viewport = youtube.viewportSize()!;
  const away = { x: Math.round(viewport.width * 0.6), y: Math.round(viewport.height * 0.75) };
  await seedLayers(
    popup,
    youtube,
    [
      { id: 'over-account', ...centreOf(account), width: 80, height: 60 },
      { id: 'elsewhere', ...away, width: 80, height: 60 },
    ],
    () => [defaultScrollOpacityRule('over-account'), defaultScrollOpacityRule('elsewhere')],
  );
  // Nothing is near yet: both layers follow the scroll.
  await scrollToProgress(youtube, 0.25);
  await expect.poll(() => alphaOf(youtube, 'elsewhere')).toBeCloseTo(0.5, 1);
  await expect.poll(() => alphaOf(youtube, 'over-account')).toBeCloseTo(0.5, 1);
  const clipBefore = await youtube.locator('#around-decorations').evaluate((host) => getComputedStyle(host).clipPath);
  // ② The pointer rests on the Account button: only the layer painted over it is held.
  await youtube.mouse.move(centreOf(account).x, centreOf(account).y, { steps: 4 });
  await expect.poll(() => heldLayers(youtube)).toEqual(['over-account']);
  await expect.poll(() => alphaOf(youtube, 'over-account')).toBe(1);
  // ① The layer elsewhere keeps following the scroll under the resting pointer.
  const followed: number[] = [];
  for (const progress of [0.3, 0.4, 0.45]) {
    await scrollToProgress(youtube, progress);
    await expect.poll(() => alphaOf(youtube, 'elsewhere')).toBeCloseTo(progress * 2, 1);
    followed.push(await alphaOf(youtube, 'elsewhere'));
    expect(await heldLayers(youtube)).toEqual(['over-account']);
    expect(await alphaOf(youtube, 'over-account')).toBe(1);
  }
  expect(new Set(followed).size).toBe(3);
  // ④ The clip is the same whether or not a layer is held, and the button stays the hit target.
  expect(await youtube.locator('#around-decorations').evaluate((host) => getComputedStyle(host).clipPath)).toBe(
    clipBefore,
  );
  expect(
    await youtube
      .getByRole('button', { name: 'Account' })
      .evaluate((element, p) => document.elementFromPoint(p.x, p.y) === element, centreOf(account)),
  ).toBe(true);
  // ② Leaving releases the held layer after the 350ms hysteresis, without another pointer event.
  // The first of the four steps is already past the 72 px exit margin, so the hysteresis starts
  // there: time from before the move, not from when the whole move resolves (it can take ~280ms).
  const left = Date.now();
  await youtube.mouse.move(away.x, away.y, { steps: 4 });
  await expect.poll(() => heldLayers(youtube), { intervals: [50] }).toEqual([]);
  expect(Date.now() - left).toBeGreaterThanOrEqual(300);
  await expect.poll(() => alphaOf(youtube, 'over-account')).toBeCloseTo(0.9, 1);
});

test('G1.2 ③: a layer that moves onto a near control is held within two frames and not released until the control clears', async ({
  popup,
  youtube,
}) => {
  await scrollRoom(youtube);
  const account = await youtube.getByRole('button', { name: 'Account' }).evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const start = { x: 320, y: centreOf(account).y };
  // The scroll slides the layer along the masthead, from the guide's edge onto the Account button.
  const distance = centreOf(account).x - start.x;
  await seedLayers(popup, youtube, [{ id: 'mover', ...start, width: 40, height: 40 }], () => [
    {
      ...defaultSignalRule('mover', 'position.x', defaultScrollOpacityRule('mover').source),
      keyframes: [
        { id: 'key-start', input: 0, value: 0, easing: 'linear' },
        { id: 'key-end', input: 1, value: distance, easing: 'linear' },
      ],
    },
  ]);
  await scrollToProgress(youtube, 0);
  await youtube.mouse.move(centreOf(account).x, centreOf(account).y, { steps: 4 });
  // The near controls: every masthead button within the 40px entering margin of the pointer
  // (the Create button sits beside Account).
  const near = await youtube.evaluate((p) => {
    const rects = [...document.querySelectorAll('ytd-masthead button')]
      .map((element) => element.getBoundingClientRect())
      .filter((r) => Math.max(r.left - p.x, p.x - r.right, r.top - p.y, p.y - r.bottom) <= 40);
    const left = Math.min(...rects.map((r) => r.left)),
      right = Math.max(...rects.map((r) => r.right)),
      top = Math.min(...rects.map((r) => r.top)),
      bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, width: right - left, height: bottom - top };
  }, centreOf(account));
  // The way in passed the search box, which the mover overlaps: that hold clears after 350ms.
  await expect.poll(() => heldLayers(youtube)).toEqual([]);
  // Every frame: where the mover is painted, and whether the guard holds it.
  await youtube.evaluate((account) => {
    const host = document.querySelector<HTMLElement>('#around-decorations')!;
    const node = host.shadowRoot!.querySelector<HTMLElement>('[data-image-id="mover"]')!;
    const held = () =>
      (
        JSON.parse(host.dataset.aroundSafety ?? '{"issues":[]}').issues as { layerId: string; surfaceId: string }[]
      ).some((issue) => issue.layerId === 'mover' && issue.surfaceId === 'native.approach');
    const log = ((window as any).g12Frames = [] as { over: boolean; held: boolean }[]);
    const changes = ((window as any).g12Changes = [] as boolean[]);
    let last = held();
    new MutationObserver(() => {
      if (held() !== last) changes.push((last = held()));
    }).observe(host, { attributes: true, attributeFilter: ['data-around-safety'] });
    const tick = () => {
      const r = node.getBoundingClientRect();
      log.push({
        over:
          r.right > account.left &&
          r.left < account.left + account.width &&
          r.bottom > account.top &&
          r.top < account.top + account.height,
        held: held(),
      });
      if ((window as any).g12Frames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, near);
  for (let step = 1; step <= 40; step++) await scrollToProgress(youtube, step / 40);
  const during = await youtube.evaluate(() => ({
    frames: (window as any).g12Frames as { over: boolean; held: boolean }[],
    changes: [...((window as any).g12Changes as boolean[])],
  }));
  // It reached the control, was held, went back to its authored place, and stayed held there.
  expect(during.frames.some((frame) => frame.over)).toBe(true);
  expect(during.frames.filter((frame) => frame.over && !frame.held).length).toBeLessThanOrEqual(2);
  expect(during.changes).toEqual([true]);
  expect(during.frames.at(-1)).toEqual({ over: false, held: true });
  // Leaving the control releases it once.
  await youtube.mouse.move(start.x, 400, { steps: 4 });
  await expect.poll(() => heldLayers(youtube)).toEqual([]);
  expect(await youtube.evaluate(() => (window as any).g12Changes)).toEqual([true, false]);
  await youtube.evaluate(() => ((window as any).g12Frames = undefined));
});

test('manual emergency OFF releases drawing and preserves an unsaved editor and Undo until explicit resume', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(editor.locator('.dirty')).toHaveText('未保存');
  await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator('#around-decorations')).toHaveCount(0);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
  await expect(editor.locator('.dirty')).toHaveText('未保存');
  await expect(editor.getByRole('button', { name: '元に戻す', exact: true })).toBeEnabled();
  await popup.getByRole('switch', { name: '制作モード' }).check();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
  await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  await expect(youtube.locator('#around-decorations')).toHaveCount(1);
  await expect(editor.locator('.dirty')).toHaveText('未保存');
});

test('candidate discovery assigns each element to its first matching selector in document order', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    const app = document.querySelector('ytd-app')!;
    // Elements that match several selectors, hidden ones that still consume an index,
    // and a descendant selector whose ancestor sits outside the inserted subtree.
    const host = document.createElement('div');
    host.innerHTML = `
      <ytd-masthead><a href="/x" role="button" style="display:block;width:31px;height:11px">both</a></ytd-masthead>
      <div role="menu" style="width:32px;height:12px"><button style="width:33px;height:13px">in menu</button></div>
      <div role="dialog" style="width:34px;height:14px"><input type="range" style="width:35px;height:15px"></div>
      <button hidden style="width:36px;height:16px">hidden</button>
      <button style="visibility:hidden;width:37px;height:17px">invisible</button>
      <ytd-comments><div contenteditable="true" style="width:38px;height:18px">c</div></ytd-comments>
      <div contenteditable="true" style="width:39px;height:19px">plain</div>
      <div role="slider" style="width:40px;height:20px"></div>
      <select style="width:41px;height:21px"><option>a</option></select>`;
    app.append(host);
    // Independent copy of the original one-query-per-selector algorithm.
    const selectors: [string, string, string][] = [
      ['player.seek', 'drag', '.ytp-progress-bar-container, .ytp-progress-bar'],
      ['player.volume', 'drag', '.ytp-volume-panel, .ytp-volume-slider'],
      ['search', 'text-input', 'ytd-searchbox, yt-searchbox'],
      ['comment', 'text-input', 'ytd-comment-simplebox-renderer, ytd-comments [contenteditable="true"]'],
      [
        'navigation',
        'click',
        'ytd-guide-entry-renderer a[href], ytd-mini-guide-entry-renderer a[href], ytd-masthead a[href]',
      ],
      [
        'menu',
        'native-menu',
        '.ytp-popup, .ytp-settings-menu, ytd-menu-popup-renderer, tp-yt-paper-dialog, [role="menu"], [role="dialog"], [role="listbox"], select',
      ],
      [
        'control',
        'click',
        'button, a[role="button"], [role="button"], input, textarea, [contenteditable="true"], [role="slider"]',
      ],
    ];
    const seen = new Set<Element>();
    const expected: string[] = [];
    for (const [id, kind, selector] of selectors) {
      let index = 0;
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (seen.has(element) || element.closest('[id^="around"]')) continue;
        seen.add(element);
        const r = element.getBoundingClientRect();
        const finalKind = element.matches('input[type="range"],[role="slider"]') ? 'drag' : kind;
        expected.push(`${id}.${index++}|${finalKind}|${r.left},${r.top},${r.width},${r.height}`);
      }
    }
    const source = api.youtubeOperations(document);
    const actual = source
      .capture()
      .surfaces.filter(
        (s: any) => !s.id.startsWith('player.controls') && s.id !== 'player.video' && s.id !== 'native.focus',
      )
      .map((s: any) => `${s.id}|${s.kind}|${s.shape.left},${s.shape.top},${s.shape.width},${s.shape.height}`);
    source.destroy();
    host.remove();
    return { expected, actual };
  });
  expect(result.expected.length).toBeGreaterThan(9);
  expect(result.actual).toEqual(result.expected);
});

test('incremental discovery matches a fresh full scan after inserts, removals, moves and matching attribute changes', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const app = document.querySelector('ytd-app')!;
    const describe = (source: any) =>
      source
        .capture()
        .surfaces.map(
          (s: any) =>
            `${s.id}|${s.kind}|${s.shape.left},${s.shape.top},${s.shape.width},${s.shape.height}|${s.availability.visible}`,
        );
    const live = api.youtubeOperations(document);
    live.capture();
    const host = document.createElement('div');
    app.append(host);
    const box = (width: number) => `style="display:block;width:${width}px;height:10px"`;
    const steps: Record<string, { live: string[]; fresh: string[]; width: number }> = {};
    const step = async (name: string, width: number, change: () => void) => {
      change();
      await new Promise((resolve) => setTimeout(resolve, 0)); // MutationObserver delivery
      const fresh = api.youtubeOperations(document);
      steps[name] = { live: describe(live), fresh: describe(fresh), width };
      fresh.destroy();
    };
    await step('insert subtree', 61, () => {
      host.innerHTML = `<ytd-masthead><a href="/x" ${box(61)}>nav</a></ytd-masthead>
        <div role="menu" ${box(62)}><button ${box(63)}>in menu</button></div><ytd-comments id="c"></ytd-comments>`;
    });
    await step('remove candidate', 0, () => host.querySelector('button')!.remove());
    await step('role added', 64, () => {
      const plain = document.createElement('div');
      plain.id = 'plain';
      plain.setAttribute('style', `display:block;width:64px;height:10px`);
      host.prepend(plain);
      plain.setAttribute('role', 'button');
    });
    await step('role removed', 0, () => host.querySelector('#plain')!.removeAttribute('role'));
    await step('class added', 65, () => {
      const popup = document.createElement('div');
      popup.id = 'popup';
      popup.setAttribute('style', `display:block;width:65px;height:10px`);
      host.append(popup);
      popup.className = 'ytp-popup';
    });
    await step('class removed', 0, () => host.querySelector('#popup')!.removeAttribute('class'));
    await step('href added', 66, () => {
      const link = document.createElement('a');
      link.id = 'link';
      link.setAttribute('style', `display:block;width:66px;height:10px`);
      host.querySelector('ytd-masthead')!.append(link);
      link.setAttribute('href', '/y');
    });
    await step('contenteditable under existing ancestor', 67, () => {
      const field = document.createElement('div');
      field.setAttribute('style', `display:block;width:67px;height:10px`);
      field.setAttribute('contenteditable', 'true');
      host.querySelector('#c')!.append(field);
    });
    await step('move reorders ids', 0, () => host.prepend(host.querySelector('#link')!.parentElement!));
    live.destroy();
    host.remove();
    return steps;
  });
  for (const [name, step] of Object.entries(result)) {
    expect(step.live, name).toEqual(step.fresh);
    if (step.width)
      expect(
        step.live.some((row) => row.includes(`,${step.width},`)),
        name,
      ).toBe(true);
  }
});

test('the composition slot shares the capture read, then reads again on change or in a later task', async ({
  youtube,
}) => {
  // Trace markers write the document and deliberately invalidate the reader.
  await youtube.addScriptTag({ content: await probeCode(false) });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const original = window.getComputedStyle;
    let reads = 0;
    window.getComputedStyle = function (...args: Parameters<typeof original>) {
      reads++;
      return original.apply(window, args);
    } as typeof original;
    const count = (f: () => unknown) => {
      reads = 0;
      const value = f();
      return { reads, value };
    };
    const source = api.youtubeOperations(document);
    source.capture();
    const first = count(() => Boolean(source.overlaySlot()));
    const repeated = count(() => Boolean(source.overlaySlot()));
    const app = document.querySelector<HTMLElement>('ytd-app')!;
    app.style.transform = 'translateX(0)';
    const changedCapture = source.capture({ fresh: true }).supported;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const changed = count(() => Boolean(source.overlaySlot()));
    app.style.removeProperty('transform');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restored = count(() => Boolean(source.overlaySlot()));
    await Promise.resolve();
    const nextMicrotask = count(() => Boolean(source.overlaySlot()));
    window.getComputedStyle = original;
    source.destroy();
    return { first, repeated, changedCapture, changed, restored, nextMicrotask };
  });
  expect(result.first).toEqual({ reads: 0, value: true });
  expect(result.repeated).toEqual({ reads: 0, value: true });
  expect(result.changedCapture).toBe(false);
  expect(result.changed.value).toBe(false); // A transformed ancestor removes the verified slot.
  expect(result.restored.value).toBe(true);
  expect(result.nextMicrotask.reads).toBeGreaterThan(0);
});

test("one draw's shared composition reads never reach the next task or frame, nor past a change in the same task", async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const reads = api.createDrawReads(document);
    const app = document.querySelector<HTMLElement>('ytd-app')!;
    const first = reads.reader();
    const sameTask = reads.reader() === first;
    const opaque = first.style(app).opacity;
    // A change in the same task (the page's own script, or the extension's write): a new reader.
    app.style.opacity = '0.5';
    const afterWrite = reads.reader();
    const droppedOnWrite = afterWrite !== first;
    const seenAfterWrite = afterWrite.style(app).opacity;
    // No record at all (a stylesheet-only change, as a fade): the next task and frame read again.
    await Promise.resolve();
    const nextTask = reads.reader() !== afterWrite;
    const before = reads.reader();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const nextFrame = reads.reader() !== before;
    app.style.removeProperty('opacity');
    return { sameTask, opaque, droppedOnWrite, seenAfterWrite, nextTask, nextFrame };
  });
  expect(result).toEqual({
    sameTask: true,
    opaque: '1',
    droppedOnWrite: true,
    seenAfterWrite: '0.5',
    nextTask: true,
    nextFrame: true,
  });
});

test('a stylesheet-only change to an overlay ancestor is seen by the next frame without any DOM mutation', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // A quiet document isolates the slot read from unrelated snapshot reissues.
    const iframe = document.createElement('iframe');
    iframe.id = 'around-test-quiet';
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = '<div id="app"></div>';
    const app = doc.getElementById('app')!;
    const source = api.createOperationSource(
      doc,
      () => [],
      () => undefined,
      () => {
        for (let node: HTMLElement | null = app; node; node = node.parentElement)
          if (api.fixedContainingBlock(doc.defaultView!.getComputedStyle(node))) return undefined;
        return { parent: app, zIndex: 1 };
      },
    );
    // Let the initial ResizeObserver delivery reissue its snapshot first.
    source.capture();
    for (let i = 0; i < 3; i++) await frame();
    const before = Boolean(source.overlaySlot());
    const snapshot = source.capture();
    // Constructed sheets change computed style without a MutationRecord.
    const sheet = new (doc.defaultView as any).CSSStyleSheet();
    sheet.replaceSync('#app{transform:translateX(0)}');
    doc.adoptedStyleSheets = [sheet];
    await frame();
    const nextFrame = Boolean(source.overlaySlot());
    const sameSnapshot = source.capture() === snapshot;
    doc.adoptedStyleSheets = [];
    await frame();
    const restored = Boolean(source.overlaySlot());
    source.destroy();
    iframe.remove();
    return { before, nextFrame, restored, sameSnapshot };
  });
  // The snapshot is not reissued, so only a per-frame slot read can notice the change.
  expect(result).toEqual({ before: true, nextFrame: false, restored: true, sameSnapshot: true });
});

test('a burst of native changes is read at most once per window while drawing stays held', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const host = api.createOperationGuardHost(document, source, () => undefined);
    const app = document.querySelector('ytd-app')!;
    for (let i = 0; i < 3; i++) host.sample(await frame());
    const reads = new Set<object>([source.capture()]);
    const held: boolean[] = [];
    const start = performance.now();
    // About 0.6 s of continuous native changes, one per frame.
    while (performance.now() - start < 600) {
      const node = document.createElement('div');
      node.textContent = 'x';
      app.append(node);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      host.sample(await frame());
      reads.add(source.capture());
      held.push(Boolean(host.snapshot().stopped));
    }
    const burstReads = reads.size - 1;
    const burstFrames = held.length;
    const heldFrames = held.filter(Boolean).length;
    // Input never waits for the window: it reads the page synchronously.
    const beforeInput = source.capture();
    app.append(document.createElement('div'));
    source.validate(beforeInput, new KeyboardEvent('keydown'));
    const inputRead = source.capture() !== beforeInput;
    // Once changes stop, the next window reads and drawing resumes without the stability wait.
    await new Promise((resolve) => setTimeout(resolve, 260));
    host.sample(await frame());
    host.sample(await frame());
    const resumed = !host.snapshot().stopped;
    host.destroy();
    return { burstReads, burstFrames, heldFrames, inputRead, resumed };
  });
  expect(result.burstFrames).toBeGreaterThan(20);
  // 0.6 s at one read per 200 ms window, plus the leading read.
  expect(result.burstReads).toBeLessThanOrEqual(5);
  expect(result.heldFrames).toBeGreaterThan(result.burstFrames / 2);
  expect(result.inputRead).toBe(true);
  expect(result.resumed).toBe(true);
});

test('input during a burst of real geometry changes pauses but never counts as a repeated failure', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const host = api.createOperationGuardHost(document, source, () => undefined);
    const app = document.querySelector('ytd-app')!;
    for (let i = 0; i < 3; i++) host.sample(await frame());
    // Three inputs, each after a new native control appeared inside a held window.
    for (let round = 0; round < 3; round++) {
      app.append(document.createElement('div'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      host.sample(await frame());
      const button = document.createElement('button');
      button.setAttribute('style', `position:absolute;left:${100 + round * 60}px;top:200px;width:40px;height:40px`);
      app.append(button);
      await new Promise((resolve) => setTimeout(resolve, 0));
      host.sample(await frame());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    }
    const paused = Boolean(host.snapshot().stopped);
    // The first read after the burst observes the last change; stability is counted from it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    host.sample(await frame());
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) host.sample(await frame());
    const recovered = !host.snapshot().stopped;
    host.destroy();
    return { paused, recovered };
  });
  // A geometry change at input time is legitimate: the guard recovers once things settle.
  expect(result).toEqual({ paused: true, recovered: true });
});

/** G1.1.1: a hidden control (YouTube keeps hover-only buttons in the layout) is not under the
 * pointer, while a visible one that a page element covers still is. */
async function clickFixture(youtube: Page) {
  await youtube.addScriptTag({ content: await probeCode() });
  await youtube.evaluate(() => {
    const app = document.querySelector('ytd-app')!;
    const place = (node: HTMLElement, left: number, z = 1) =>
      node.setAttribute(
        'style',
        `position:fixed;left:${left}px;top:420px;width:60px;height:40px;z-index:${z};margin:0;padding:0;border:0`,
      );
    // A hover-only button, hidden, over the picture it would sit on: the picture takes the click.
    const hidden = document.createElement('button'),
      picture = document.createElement('div');
    hidden.textContent = 'あとで見る';
    place(picture, 300, 2);
    place(hidden, 300, 3);
    hidden.style.visibility = 'hidden';
    // A visible button that a page element takes the click from.
    const shown = document.createElement('button'),
      cover = document.createElement('div');
    shown.textContent = '再生';
    cover.id = 'g111-cover';
    place(shown, 500, 1);
    place(cover, 500, 5);
    app.append(picture, hidden, shown, cover);
    // G1.2 (D8): a button that takes no pointer input (pointer-events: none from its wrapper)
    // over a picture; at 900 the same, with a pressable button the picture covers.
    for (const [left, pressable] of [
      [700, false],
      [900, true],
    ] as const) {
      const backdrop = document.createElement('div'),
        wrapper = document.createElement('div'),
        inert = document.createElement('button');
      inert.textContent = '飾りのボタン';
      inert.style.cssText = 'width:100%;height:100%;margin:0;padding:0;border:0';
      place(backdrop, left, 2);
      place(wrapper, left, 3);
      wrapper.style.pointerEvents = 'none';
      wrapper.append(inert);
      if (pressable) {
        const under = document.createElement('button');
        under.textContent = '押せるボタン';
        place(under, left, 1);
        app.append(under);
      }
      app.append(backdrop, wrapper);
    }
  });
}
const click = (x: number) => {
  for (const type of ['pointerdown', 'pointerup'])
    document.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 440, bubbles: true }));
};

test('a click over a hidden native control is not a failure; a visible control a page element covers still stops drawing', async ({
  youtube,
}) => {
  // The probe keeps the AROUND_GUARD_TRACE label, as the development build does.
  const traces: string[] = [];
  youtube.on('console', (message) => {
    if (message.text().startsWith('[Around G1] クリック先')) traces.push(message.text());
  });
  await clickFixture(youtube);
  const result = await youtube.evaluate(async (clickSource) => {
    const click = new Function('x', clickSource) as (x: number) => void;
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 3; i++) host.sample(await frame());
    };
    const source = api.youtubeOperations(document);
    const host = api.createOperationGuardHost(document, source, () => undefined);
    await settle();
    const snapshot = source.capture();
    const hiddenValid = source.validate(snapshot, new PointerEvent('pointerdown', { clientX: 330, clientY: 440 }));
    const coveredValid = source.validate(snapshot, new PointerEvent('pointerdown', { clientX: 530, clientY: 440 }));
    for (let i = 0; i < 3; i++) {
      click(330);
      await settle();
    }
    const hidden = { stopped: host.snapshot().stopped, latched: host.snapshot().latched };
    for (let i = 0; i < 3; i++) {
      click(530);
      await settle();
    }
    const covered = { stopped: host.snapshot().stopped, latched: host.snapshot().latched };
    host.resume();
    await settle();
    const fresh = source.capture();
    const inertValid = source.validate(fresh, new PointerEvent('pointerdown', { clientX: 730, clientY: 440 }));
    const inertCoveredValid = source.validate(fresh, new PointerEvent('pointerdown', { clientX: 930, clientY: 440 }));
    for (let i = 0; i < 3; i++) {
      click(730);
      await settle();
    }
    const inert = { stopped: host.snapshot().stopped, latched: host.snapshot().latched };
    host.destroy();
    return { hiddenValid, coveredValid, hidden, covered, inertValid, inertCoveredValid, inert };
  }, `(${click.toString()})(x)`);
  expect(result.hiddenValid).toBe(true);
  expect(result.coveredValid).toBe(false);
  expect(result.hidden).toEqual({ stopped: '', latched: false });
  expect(result.covered.stopped).toBeTruthy();
  expect(result.covered.latched).toBe(true);
  // D8: a control that takes no pointer input is not covered; a pressable one at the same kind
  // of point, under the same picture, still is.
  expect(result.inertValid).toBe(true);
  expect(result.inertCoveredValid).toBe(false);
  expect(result.inert).toEqual({ stopped: '', latched: false });
  // Only the covered control is traced: the expected target and the element that took the click.
  expect(traces.length).toBeGreaterThanOrEqual(4);
  const trace = JSON.parse(traces[0]!.slice(traces[0]!.indexOf('{')));
  expect(trace).toMatchObject({
    event: 'pointerdown',
    point: { x: 530, y: 440 },
    actual: { element: 'div#g111-cover' },
  });
  expect(trace.expected).toEqual([expect.objectContaining({ element: 'button', label: '再生' })]);
  expect(traces.join('\n')).not.toContain('あとで見る');
});

test('描画を再開 releases a latched stop, and the same covered click stops drawing again', async ({ youtube }) => {
  await clickFixture(youtube);
  const result = await youtube.evaluate(async (clickSource) => {
    const click = new Function('x', clickSource) as (x: number) => void;
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    let stops = 0;
    const host = api.createOperationGuardHost(document, source, (stop: unknown) => {
      if (stop) stops++;
    });
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 3; i++) host.sample(await frame());
    };
    await settle();
    for (let i = 0; i < 3; i++) {
      click(530);
      await settle();
    }
    const latched = host.snapshot().latched;
    host.resume();
    const resumed = { stopped: host.snapshot().stopped, latched: host.snapshot().latched };
    await settle();
    const before = stops;
    click(530);
    const again = { stopped: Boolean(host.snapshot().stopped), hid: stops > before };
    await settle();
    // One covered click after resuming pauses again and recovers; three latch again.
    const recovered = !host.snapshot().stopped;
    for (let i = 0; i < 2; i++) {
      click(530);
      await settle();
    }
    const relatched = host.snapshot().latched;
    host.destroy();
    return { latched, resumed, again, recovered, relatched };
  }, `(${click.toString()})(x)`);
  expect(result).toEqual({
    latched: true,
    resumed: { stopped: '', latched: false },
    again: { stopped: true, hid: true },
    recovered: true,
    relatched: true,
  });
});

test('the stop says what it protected and how to fix it, one sentence each, naming the layer to move', async ({
  youtube,
}) => {
  await clickFixture(youtube);
  const result = await youtube.evaluate(async (clickSource) => {
    const click = new Function('x', clickSource) as (x: number) => void;
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const host = api.createOperationGuardHost(document, source, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) host.sample(await frame());
    const paint = (id: string, name: string, left: number) => ({
      id,
      name,
      bounds: { left, top: 400, right: left + 100, bottom: 480 },
      opacity: 1,
      pointerEvents: false,
      outset: 0,
      composition: 'overlay',
    });
    host.commit([paint('a', 'さくら', 480), paint('b', '遠くの雲', 20)]);
    click(530);
    const once = { stopped: host.snapshot().stopped, remedy: host.snapshot().remedy };
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      host.sample(await frame());
      click(530);
    }
    const latched = { stopped: host.snapshot().stopped, remedy: host.snapshot().remedy };
    host.destroy();
    return { once, latched };
  }, `(${click.toString()})(x)`);
  for (const message of [result.once, result.latched]) {
    for (const sentence of [message.stopped, message.remedy]) {
      expect(sentence).toMatch(/^[^。]+。$/);
      expect(sentence).not.toMatch(/世代|幾何|照合|ハンドル|配置基準|操作面/);
    }
    expect(message.remedy).toContain('「さくら」');
    expect(message.remedy).not.toContain('遠くの雲');
  }
  expect(result.latched.remedy).toContain('描画を再開');
  expect(result.once.remedy).not.toContain('描画を再開');
});

test('focus inside the extension own player-local host never counts as focus on a native surface', async ({
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    // The player-local paint host lives inside the player; the editor focuses layers in it.
    const own = document.createElement('div');
    own.id = 'around-video-decorations';
    own.tabIndex = -1;
    player.append(own);
    const native = document.createElement('button');
    native.textContent = 'native';
    player.append(native);
    const source = api.youtubeOperations(document);
    const focused = () =>
      source
        .capture()
        .surfaces.filter((s: any) => s.availability.focused)
        .map((s: any) => s.id);
    own.focus();
    const whileOwn = { active: document.activeElement === own, focused: focused() };
    native.focus();
    const whileNative = focused();
    source.destroy();
    own.remove();
    native.remove();
    return { whileOwn, whileNative };
  });
  expect(result.whileOwn.active).toBe(true);
  expect(result.whileOwn.focused).toEqual([]);
  // A real native control in the player still marks the player surfaces as focused.
  expect(result.whileNative).toEqual(expect.arrayContaining(['player.video']));
});

test('focus on the player container is not focus on its control bands; a control inside a band is', async ({
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    player.tabIndex = -1;
    const source = api.youtubeOperations(document);
    const focused = () =>
      source
        .capture()
        .surfaces.filter((s: any) => s.availability.focused && s.id.startsWith('player.controls'))
        .map((s: any) => s.id);
    // YouTube focuses the player itself for keyboard shortcuts.
    player.focus();
    const container = { active: document.activeElement === player, focused: focused() };
    player.querySelector<HTMLElement>('.ytp-chrome-bottom button')!.focus();
    const bottom = focused();
    source.destroy();
    return { container, bottom };
  });
  expect(result.container).toEqual({ active: true, focused: [] });
  expect(result.bottom).toEqual(['player.controls.bottom']);
});

test('focus that silently leaves with a removed element is not kept by the cached snapshot', async ({ youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    const control = document.createElement('button');
    control.textContent = 'transient';
    player.append(control);
    const source = api.youtubeOperations(document);
    control.focus();
    const focusedBefore = source.capture().surfaces.some((s: any) => s.availability.focused);
    // Removing the focused element moves focus to body without any focusout event; a
    // mutation inside the extension's own host is the kind of change the observer skips.
    const own = document.createElement('div');
    own.id = 'around-test-focus';
    own.tabIndex = -1;
    player.append(own);
    own.focus();
    own.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const focusedAfter = source.capture().surfaces.some((s: any) => s.availability.focused);
    control.remove();
    source.destroy();
    return { focusedBefore, focusedAfter, active: document.activeElement?.tagName };
  });
  expect(result).toEqual({ focusedBefore: true, focusedAfter: false, active: 'BODY' });
});

test('focus moving inside the extension own UI does not notify the guard', async ({ youtube }) => {
  const code = await probeCode();
  const result = await youtube.evaluate(async (code) => {
    // A quiet document isolates focus notifications from unrelated page mutations. The probe
    // is loaded inside it so element checks run in the document's own realm, as in production.
    const iframe = document.createElement('iframe');
    iframe.id = 'around-test-focus-frame';
    document.body.append(iframe);
    const win = iframe.contentWindow as any;
    const doc = iframe.contentDocument!;
    const script = doc.createElement('script');
    script.textContent = code;
    doc.head.append(script);
    const api = win.G1Probe;
    doc.body.insertAdjacentHTML('beforeend', '<button id="native">native</button>');
    // Two of the extension's own hosts, like the editor panel and the player-local layers.
    const own = doc.createElement('div');
    own.id = 'around-test-own';
    own.attachShadow({ mode: 'open' }).innerHTML = '<div tabindex="-1">layer</div>';
    const panel = doc.createElement('div');
    panel.id = 'around-test-panel';
    panel.attachShadow({ mode: 'open' }).innerHTML = '<div tabindex="-1">panel</div>';
    doc.body.append(own, panel);
    const source = api.createOperationSource(
      doc,
      () => [],
      () => undefined,
    );
    let notified = 0;
    source.subscribe(() => notified++);
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      source.capture();
      notified = 0;
    };
    const layer = own.shadowRoot!.querySelector<HTMLElement>('[tabindex]')!,
      handle = panel.shadowRoot!.querySelector<HTMLElement>('[tabindex]')!;
    win.focus();
    // The first focus also focuses the frame's window, which is a native change of its own.
    handle.focus();
    await settle();
    // A pointerdown on a layer moves focus from the panel to the layer, then away to nothing.
    layer.focus();
    handle.focus();
    handle.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ownNotified = notified;
    await settle();
    doc.getElementById('native')!.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const nativeNotified = notified;
    source.destroy();
    iframe.remove();
    return { ownNotified, nativeNotified };
  }, code);
  // Notification makes the guard hide every layer and handle at once, which ends a drag.
  expect(result.ownNotified).toBe(0);
  expect(result.nativeNotified).toBeGreaterThan(0);
});

test('a native removal is seen by the next synchronous read and the guard is told after the task', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const button = document.createElement('button');
    button.setAttribute('style', 'position:absolute;left:300px;top:300px;width:47px;height:47px');
    document.querySelector('ytd-app')!.append(button);
    const source = api.youtubeOperations(document);
    let notified = 0;
    source.subscribe(() => notified++);
    const has = (snapshot: any) => snapshot.surfaces.some((s: any) => s.shape.width === 47);
    const before = has(source.capture());
    button.remove();
    const sameTask = has(source.capture());
    const notifiedInTask = notified;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const later = { present: has(source.capture()), notified };
    source.destroy();
    return { before, sameTask, notifiedInTask, later };
  });
  expect(result.before).toBe(true);
  expect(result.sameTask).toBe(false);
  expect(result.notifiedInTask).toBe(0);
  expect(result.later.present).toBe(false);
  expect(result.later.notified).toBeGreaterThan(0);
});

test('small native changes skip the whole-document query while input checks and the periodic sweep still scan it', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const original = document.querySelectorAll;
    let documentQueries = 0;
    document.querySelectorAll = function (this: Document, ...args: [string]) {
      documentQueries++;
      return original.apply(this, args);
    } as typeof original;
    const live = api.youtubeOperations(document);
    const found = (width: number) =>
      live.capture().surfaces.some((s: any) => s.shape.width === width && s.availability.visible);
    const first = (live.capture(), documentQueries);
    documentQueries = 0;
    const button = document.createElement('button');
    button.setAttribute('style', 'position:absolute;left:200px;top:300px;width:44px;height:44px');
    document.querySelector('ytd-app')!.append(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const incrementalFound = found(44);
    const incrementalQueries = documentQueries;
    documentQueries = 0;
    live.validate(live.capture(), new KeyboardEvent('keydown'));
    const inputQueries = documentQueries;
    documentQueries = 0;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    window.dispatchEvent(new Event('resize'));
    live.capture();
    const sweepQueries = documentQueries;
    document.querySelectorAll = original;
    button.remove();
    live.destroy();
    return { first, incrementalFound, incrementalQueries, inputQueries, sweepQueries };
  });
  expect(result.first).toBeGreaterThan(0);
  expect(result.incrementalFound).toBe(true);
  expect(result.incrementalQueries).toBe(0);
  expect(result.inputQueries).toBeGreaterThan(0);
  expect(result.sweepQueries).toBeGreaterThan(0);
});

test('opaque click-through paint is compositor-clipped away from native controls', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  // Exercise exactly the production numerical partition, independent of assets.
  const code = await build({
    stdin: {
      contents: `export {safePaintRegions, guardPaint} from './src/world/operations';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'G1Guard',
  });
  await youtube.addScriptTag({ content: code.outputFiles[0]!.text });
  const button = youtube.getByRole('button', { name: 'All', exact: true });
  const before = await button.screenshot();
  const result = await youtube.evaluate(() => {
    const source = (window as any).G1Probe.youtubeOperations(document),
      snapshot = source.capture(),
      api = (window as any).G1Guard;
    const regions = api.safePaintRegions(snapshot, false);
    const composition = source.overlaySlot();
    if (!composition) throw new Error('No verified composition slot');
    const overlay = document.createElement('div');
    overlay.id = 'around-test-opaque';
    overlay.style.cssText = `position:fixed;inset:0;background:red;pointer-events:none;z-index:${composition.zIndex};clip-path:path('${regions.map((r: any) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join('')}')`;
    composition.parent.append(overlay);
    const issues = api.guardPaint(snapshot, [
      {
        id: 'opaque',
        bounds: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
        opacity: 1,
        pointerEvents: false,
        outset: 30,
        composition: 'overlay',
      },
    ]);
    source.destroy();
    return issues;
  });
  expect(result.some((i: any) => i.severity === 'enforced' && i.action === 'clip')).toBe(true);
  expect((await button.screenshot()).equals(before)).toBe(true);
  await button.click();
  await youtube.locator('#navigate').click();
  await expect(youtube).toHaveURL(/watch/);
});

test('operation guard frame overhead alternates baseline and guarded frames (informational)', async ({
  youtube,
}, info) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe,
      source = api.youtubeOperations(document),
      host = api.createOperationGuardHost(document, source, () => undefined);
    const { scene, inputs } = api.worldScenario(32),
      input = inputs[0],
      layout = api.evaluateLayout(scene, input);
    const paints = layout.layers
      .filter((l: any) => l.bounds)
      .map((l: any) => ({
        id: l.layer.id,
        bounds: l.bounds,
        opacity: 1,
        pointerEvents: false,
        outset: 0,
        composition: 'overlay',
      }));
    const element = document.createElement('div');
    element.id = 'around-benchmark';
    const shadow = element.attachShadow({ mode: 'open' }),
      style = document.createElement('style');
    style.textContent = ':host{clip-path:var(--around-decoration-clip,none)}';
    shadow.append(style);
    document.body.append(element);
    const workloads = [];
    let checksum = 0;
    function run(guarded: boolean, fresh: boolean, iterations: number) {
      let state = api.initialWorldState();
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const value = api.evaluatePreparedWorld(layout, state, { ...input, timeMs: i * 16, deltaMs: i ? 16 : 0 });
        state = value.state;
        checksum += value.frame.effects.length;
        if (guarded) {
          if (fresh) source.validate(source.capture(), new KeyboardEvent('keydown'));
          host.sample(performance.now());
          host.commit(paints);
          const regions = api.safePaintRegions(source.capture(), false);
          element.style.setProperty(
            '--around-decoration-clip',
            `path('${regions.map((r: any) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join('')}')`,
          );
        }
      }
      return (performance.now() - start) / iterations;
    }
    for (const fresh of [false, true]) {
      run(false, fresh, 300);
      run(true, fresh, 300);
      const pairs = [];
      for (let round = 0; round < 12; round++) {
        let before: number, after: number;
        if (round % 2) {
          after = run(true, fresh, 200);
          before = run(false, fresh, 200);
        } else {
          before = run(false, fresh, 200);
          after = run(true, fresh, 200);
        }
        pairs.push({ before, after, added: after - before });
      }
      const median = (values: number[]) => {
        values.sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return values.length % 2 ? values[middle] : (values[middle - 1]! + values[middle]!) / 2;
      };
      workloads.push({
        geometry: fresh ? 'fresh native geometry each frame' : 'cached stable geometry',
        pairs,
        beforeMedianMs: median(pairs.map((p) => p.before)),
        afterMedianMs: median(pairs.map((p) => p.after)),
        addedMedianMs: median(pairs.map((p) => p.added)),
      });
    }
    const surfaces = source.capture().surfaces.length;
    host.destroy();
    element.remove();
    return { layers: 32, surfaces, iterationsPerBatch: 200, pairs: 12, checksum, workloads };
  });
  expect(result.checksum).toBeGreaterThan(0);
  console.log('OPERATION_GUARD_BENCHMARK ' + JSON.stringify(result));
  await info.attach('operation-guard-benchmark.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

/** Adds `G1Paint(id, rect)` to the page: a paint footprint for guard probes, an opaque overlay
 * rectangle that moves every frame. */
const addProbePaint = (youtube: Page) =>
  youtube.evaluate(() => {
    (window as any).G1Paint = (id: string, r: { left: number; top: number; width: number; height: number }) => ({
      id,
      root: id,
      bounds: { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height },
      opacity: 1,
      pointerEvents: false,
      outset: 0,
      composition: 'overlay',
      dynamic: true,
    });
  });

test('G1.3: a uniform page scroll keeps the layout generation; reads in the window are shifted, not held', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await scrollRoom(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    // The first read starts observing every control; their first size reports settle first.
    source.capture({ fresh: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await frame();
    const first = source.capture({ fresh: true });
    await frame();
    scrollBy(0, 90);
    await frame();
    await frame();
    const shifted = source.capture({ coalesce: true });
    const deferred = source.deferredFor();
    await new Promise((resolve) => setTimeout(resolve, 260));
    await frame();
    const reread = source.capture({ coalesce: true });
    const byId = (snapshot: any) => new Map(snapshot.surfaces.map((s: any) => [s.id, s]));
    const visible = first.surfaces.filter((s: any) => s.availability.visible);
    // Surfaces in a sticky column (an unbounded box) stay put: they may be stuck.
    const moving = visible.filter((s: any) => s.scrolls && !(s.scrollBox && s.scrollBox.height >= 1e6)),
      fixed = visible.filter((s: any) => !s.scrolls);
    const at = byId(shifted);
    return {
      layout: typeof first.generation.layout,
      scrolled: shifted.scroll.y - first.scroll.y,
      moving: moving.length,
      movingShifted: moving.every((s: any) => Math.abs((at.get(s.id) as any).shape.top - (s.shape.top - 90)) < 0.5),
      fixedKept: fixed.every((s: any) => (at.get(s.id) as any).shape.top === s.shape.top),
      shiftedLayout: shifted.generation.layout === first.generation.layout,
      deferred,
      // After the window, the answer check goes group by group (D14②): the read in use is where
      // the page is now, with the same layout.
      rereadCurrent: reread.scroll.y === scrollY,
      rereadLayout: reread.generation.layout === first.generation.layout,
    };
  });
  expect(result.layout).toBe('number');
  expect(result.scrolled).toBe(90);
  expect(result.moving).toBeGreaterThan(3);
  expect(result).toMatchObject({
    movingShifted: true,
    fixedKept: true,
    shiftedLayout: true,
    deferred: 0,
    rereadCurrent: true,
    rereadLayout: true,
  });
});

test('G1.3: continuous page scrolling neither stops drawing nor hides a layer', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await addProbePaint(youtube);
  await scrollRoom(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const paint = (window as any).G1Paint;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const stops: unknown[] = [];
    const host = api.createOperationGuardHost(document, source, (stop: unknown) => {
      if (stop) stops.push(stop);
    });
    const paints = [paint('layer', { left: innerWidth / 2 - 60, top: innerHeight / 2 - 40, width: 120, height: 80 })];
    // The first read starts observing every control; their first size reports settle first.
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) {
      host.sample(await frame());
      host.commit(paints);
    }
    stops.length = 0;
    const frames: { stopped: string; blocked: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < 700) {
      scrollBy(0, 30);
      host.sample(await frame());
      frames.push({ stopped: host.snapshot().stopped, blocked: host.commit(paints).size });
    }
    host.destroy();
    return {
      frames: frames.length,
      stopped: frames.filter((f) => f.stopped).length,
      blocked: frames.filter((f) => f.blocked).length,
      stops: stops.length,
      scrollY,
    };
  });
  expect(result.frames).toBeGreaterThan(20);
  expect(result.scrollY).toBeGreaterThan(600);
  expect(result).toMatchObject({ stopped: 0, blocked: 0, stops: 0 });
});

test('G1.3: an inner scroll, a new control or a control moved by its own style hides everything until a full read', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const settle = async (host: any) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 3; i++) host.sample(await frame());
    };
    // A scrolling panel with a button inside it, in the page.
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;left:300px;top:200px;width:200px;height:120px;overflow:auto';
    panel.innerHTML = '<div style="height:400px"><button style="margin-top:40px">Inner</button></div>';
    document.querySelector('ytd-app')!.append(panel);
    const cases: Record<string, { stops: unknown[]; stopped: string; reread: boolean }> = {};
    const run = async (name: string, change: () => void) => {
      const source = api.youtubeOperations(document);
      const stops: unknown[] = [];
      const host = api.createOperationGuardHost(document, source, (stop: unknown) => {
        if (stop) stops.push(stop);
      });
      await settle(host);
      const layout = host.snapshot().surfaces.generation.layout;
      stops.length = 0;
      change();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      host.sample(await frame());
      cases[name] = {
        stops: [...stops],
        stopped: host.snapshot().stopped,
        // The next frame either holds drawing or draws from a full read that saw the change; never
        // from the earlier read shifted by the scroll.
        reread: host.snapshot().surfaces.generation.layout !== layout,
      };
      host.destroy();
    };
    await run('inner scroll', () => {
      panel.scrollTop = 60;
      panel.dispatchEvent(new Event('scroll'));
    });
    await run('added control', () => document.querySelector('ytd-app')!.append(document.createElement('button')));
    const like = document.querySelector<HTMLElement>('button[aria-label="Like video"], button[aria-label="Account"]')!;
    await run('moved by its own style', () => {
      like.style.position = 'relative';
      like.style.top = '40px';
    });
    like.style.position = like.style.top = '';
    panel.remove();
    return cases;
  });
  for (const [name, value] of Object.entries(result)) {
    // Hidden before the next paint.
    expect(value.stops, name).toContain(true);
    expect(Boolean(value.stopped) || value.reread, JSON.stringify({ name, ...value })).toBe(true);
  }
});

test('G1.3: a look change inside a control hides only the layer over it, until the next frame', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await addProbePaint(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const paint = (window as any).G1Paint;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const stops: unknown[] = [];
    const host = api.createOperationGuardHost(document, source, (stop: unknown) => {
      if (stop) stops.push(stop);
    });
    // A guide link: cut from the clip (not drawn above the artwork), so its look can be checked.
    const link = document.querySelectorAll<HTMLElement>('ytd-guide-entry-renderer a#endpoint')[1]!;
    const r = link.getBoundingClientRect();
    const paints = [
      paint('over', { left: r.left - 10, top: r.top - 10, width: r.width + 20, height: r.height + 20 }),
      paint('away', { left: innerWidth - 200, top: innerHeight - 140, width: 100, height: 100 }),
    ];
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) {
      host.sample(await frame());
      host.commit(paints);
    }
    const change = async (element: HTMLElement) => {
      stops.length = 0;
      // A hover look: a class on the control, its box unchanged.
      element.classList.add('g13-hover');
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const atMutation = [...stops];
      host.sample(await frame());
      const next = { stopped: host.snapshot().stopped, blocked: [...host.commit(paints)] };
      element.classList.remove('g13-hover');
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 3; i++) {
        host.sample(await frame());
        host.commit(paints);
      }
      return { atMutation, next };
    };
    const look = await change(link);
    // The masthead's Account button is drawn above the artwork: a change of its look may change
    // that order, which a box cannot show, so everything is hidden as before.
    const above = await change(document.querySelector<HTMLElement>('button[aria-label="Account"]')!);
    host.destroy();
    return { look, above: above.atMutation };
  });
  // Hidden before the next paint: only the layer over the control.
  expect(result.look.atMutation).toEqual([['over']]);
  // The next frame confirms the control did not move: nothing stays hidden.
  expect(result.look.next).toEqual({ stopped: '', blocked: [] });
  expect(result.above).toContain(true);
});

test('G1.3 (D11): elements added without controls are checked in their subtree once, next frame; controls added, removed or moved still hold', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await addProbePaint(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const paint = (window as any).G1Paint;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    // Boxes of a fixed size, so the document's own height never changes (that is a layout change
    // of its own, seen by the ResizeObserver on the root element).
    const boxes = [0, 1, 2].map((i) => {
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${300 + i * 220}px;top:220px;width:200px;height:160px;overflow:hidden`;
      box.innerHTML = '<p>text</p><button>Inside</button>';
      document.querySelector('ytd-app')!.append(box);
      return box;
    });
    const source = api.youtubeOperations(document);
    const stops: unknown[] = [];
    const host = api.createOperationGuardHost(document, source, (stop: unknown) => {
      if (stop) stops.push(stop);
    });
    const paints = [paint('layer', { left: 40, top: innerHeight - 140, width: 100, height: 100 })];
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 3; i++) {
        host.sample(await frame());
        host.commit(paints);
      }
      document.documentElement.removeAttribute('data-around-guard-geometry');
    };
    // The trace keeps earlier entries: only those after `since` belong to this change.
    const checks = (since: number) =>
      (JSON.parse(document.documentElement.getAttribute('data-around-guard-geometry') ?? '[]') as any[]).filter(
        (entry) => entry.change === 'subtree-check' && entry.at >= since,
      );
    const run = async (change: () => void) => {
      await settle();
      // A whole read just before: the change comes while that read is trusted (a read older than
      // the answer check bound is never shifted, so the next frame would read the page whole).
      source.capture({ fresh: true });
      const layout = host.snapshot().surfaces.generation.layout,
        since = Math.floor(performance.now());
      stops.length = 0;
      change();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const atMutation = [...stops];
      host.sample(await frame());
      const next = { stopped: host.snapshot().stopped, blocked: host.commit(paints).size };
      // A full read that saw the change, not the earlier read shifted.
      const reread = host.snapshot().surfaces.generation.layout !== layout;
      return { atMutation, next, reread, checks: checks(since) };
    };
    const element = (html: string) => {
      const span = document.createElement('span');
      span.innerHTML = html;
      return span;
    };
    // Three subtrees changed in one task: hidden at once, checked together once, shown again.
    const plain = await run(() => boxes.forEach((box) => box.firstElementChild!.append(element('<b>more</b>'))));
    const control = await run(() => boxes[0]!.append(element('<button>New</button>')));
    const removed = await run(() => boxes[1]!.querySelector('button')!.remove());
    // An element pushed in above the button moves it inside the same subtree.
    const pushed = await run(() =>
      boxes[2]!.insertBefore(element('<div style="height:40px">tall</div>'), boxes[2]!.lastElementChild),
    );
    host.destroy();
    boxes.forEach((box) => box.remove());
    return { plain, control, removed, pushed };
  });
  expect(result.plain.atMutation, JSON.stringify(result)).toContain(true);
  expect(result.plain.next).toEqual({ stopped: '', blocked: 0 });
  expect(result.plain.checks).toEqual([expect.objectContaining({ roots: 3, result: 'unchanged' })]);
  // Hidden before the next paint; the next frame holds drawing or draws from a full read that saw
  // the new, removed or moved control.
  for (const name of ['control', 'removed', 'pushed'] as const) {
    expect(result[name].atMutation, name).toContain(true);
    expect(Boolean(result[name].next.stopped) || result[name].reread, JSON.stringify({ name, ...result[name] })).toBe(
      true,
    );
  }
  expect(result.pushed.checks).toEqual([expect.objectContaining({ result: 'changed' })]);
});

test('G1.3: a press right after a page scroll reaches the control; a covered control still stops drawing', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await scrollRoom(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const host = api.createOperationGuardHost(document, source, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) host.sample(await frame());
    // A press at the centre of `element`, delivered as the browser would: to whatever is on top there.
    const press = (element: Element) => {
      const r = element.getBoundingClientRect(),
        x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      const target = document.elementFromPoint(x, y)!;
      for (const type of ['pointerdown', 'pointerup'])
        target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, composed: true }));
    };
    // The page scrolls and the press follows at once, before any frame reads the page again.
    // A chip in the page content, which the guard reads as a control; still below the masthead.
    const link = document.querySelectorAll<HTMLElement>('yt-chip-cloud-chip-renderer button')[1]!;
    const top = link.getBoundingClientRect().top;
    scrollBy(0, 40);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (link.getBoundingClientRect().top !== top - 40) throw new Error('The page did not scroll under the chip');
    press(link);
    const afterScroll = host.snapshot().stopped;
    // A page element over the control takes the press: still a covered control.
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) host.sample(await frame());
    const r = link.getBoundingClientRect();
    const cover = document.createElement('div');
    cover.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:9`;
    document.body.append(cover);
    press(link);
    const covered = host.snapshot().stopped;
    cover.remove();
    host.destroy();
    return { afterScroll, covered };
  });
  expect(result.afterScroll).toBe('');
  expect(result.covered).toBe('クリックがページの操作部品に届くよう、絵の表示を止めました。');
});

test('G1.3: a screen-plane layer stays shown while the wheel scrolls, and its clip keeps excluding the controls under it', async ({
  popup,
  youtube,
}) => {
  await scrollRoom(youtube);
  // A column of native buttons in the page that the wheel scrolls under the layer.
  await youtube.evaluate(() => {
    const column = document.createElement('div');
    column.style.cssText = 'display:flex;flex-direction:column;gap:40px;align-items:center;padding-top:200px';
    for (let i = 0; i < 16; i++) {
      const button = document.createElement('button');
      button.textContent = `Native ${i}`;
      column.append(button);
    }
    document.querySelector('ytd-page-manager')!.prepend(column);
  });
  const viewport = youtube.viewportSize()!;
  const centre = { x: Math.round(viewport.width / 2), y: Math.round(viewport.height * 0.55) };
  await seedLayers(popup, youtube, [{ id: 'over-grid', ...centre, width: 360, height: 220 }], () => []);
  // The pointer rests in the page, away from the layer, as a person's does while scrolling.
  await youtube.mouse.move(viewport.width - 30, viewport.height - 30);
  await settled(youtube);
  // An independent read of the page in the main world, every frame: the controls the clip must
  // exclude (visible, never to be covered, cut by the clip rather than drawn above the artwork).
  await youtube.addScriptTag({ content: await probeCode() });
  await youtube.evaluate(() => {
    const reader = (window as any).G1Probe.youtubeOperations(document);
    const host = document.querySelector<HTMLElement>('#around-decorations')!;
    const frame = host.shadowRoot!.querySelector<HTMLElement>('[data-image-id="over-grid"]')!;
    const rows: Record<string, unknown>[] = ((window as any).g13Rows = []);
    (window as any).g13Recording = true;
    const sample = () => {
      const clip = host.style.getPropertyValue('--around-decoration-clip');
      const regions = [...clip.matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g)].map((m) =>
        m.slice(1).map(Number),
      );
      const box = frame.getBoundingClientRect();
      const under = (reader.capture({ fresh: true }).surfaces as any[]).filter(
        (s) =>
          s.availability.visible &&
          s.policy.occlusion === 'forbid' &&
          s.compositionCapability === 'exclusion' &&
          s.shape.left + s.shape.width > box.left &&
          s.shape.left < box.right &&
          s.shape.top + s.shape.height > box.top &&
          s.shape.top < box.bottom,
      );
      // Each such control's centre lies outside every drawable region of the clip.
      const inClip = under.filter((s) => {
        const x = s.shape.left + s.shape.width / 2,
          y = s.shape.top + s.shape.height / 2;
        return regions.some(([l, t, w, h]) => x > l! && x < l! + w! && y > t! && y < t! + h!);
      });
      rows.push({
        shown:
          frame.style.visibility !== 'hidden' && !/"stopped":"[^"]/.test(host.getAttribute('data-around-safety') ?? ''),
        stopped: JSON.parse(host.getAttribute('data-around-safety') ?? '{}').stopped ?? '',
        under: under.length,
        inClip: inClip.map((s) => [s.id, [s.shape.left, s.shape.top, s.shape.width, s.shape.height].map(Math.round)]),
      });
      if ((window as any).g13Recording) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (let i = 0; i < 16; i++) {
    await youtube.mouse.wheel(0, i < 8 ? 90 : -90);
    await youtube.waitForTimeout(70);
  }
  const rows = await youtube.evaluate(() => {
    (window as any).g13Recording = false;
    return (window as any).g13Rows as { shown: boolean; stopped: string; under: number; inClip: unknown[] }[];
  });
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.filter((r) => r.under).length, 'controls passed under the layer').toBeGreaterThan(10);
  expect(
    rows.filter((r) => !r.shown),
    JSON.stringify(rows.filter((r) => !r.shown).slice(0, 3)),
  ).toEqual([]);
  expect(rows.filter((r) => r.inClip.length)).toEqual([]);
});

test('G1.3: a look change that resizes a control hides everything and draws next from a whole read', async ({
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  await addProbePaint(youtube);
  const result = await youtube.evaluate(async () => {
    // Styles first: a stylesheet added later is itself a layout change.
    const style = document.createElement('style');
    style.textContent = '.g13-grow{transform:scale(1.5)}.g13-wide{width:160px!important}';
    document.head.append(style);
    const api = (window as any).G1Probe;
    const paint = (window as any).G1Paint;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const play = document.querySelector<HTMLElement>('.html5-video-player button[aria-label="Play"]')!;
    const source = api.youtubeOperations(document);
    const stops: unknown[] = [];
    const host = api.createOperationGuardHost(document, source, (stop: unknown) => {
      if (stop) stops.push(stop);
    });
    const r = play.getBoundingClientRect();
    const paints = [
      paint('over', { left: r.left - 30, top: r.top - 30, width: r.width + 60, height: r.height + 60 }),
      paint('away', { left: innerWidth - 160, top: 100, width: 100, height: 100 }),
    ];
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 3; i++) {
        host.sample(await frame());
        host.commit(paints);
      }
    };
    const reads = (since: number) =>
      (JSON.parse(document.documentElement.getAttribute('data-around-guard-geometry') ?? '[]') as any[]).filter(
        (entry) => entry.change === 'read' && entry.at >= since,
      ).length;
    const playSurface = () =>
      (host.snapshot().surfaces.surfaces as any[]).find(
        (s) => Math.abs(s.shape.left + s.shape.width / 2 - (r.left + r.width / 2)) < 2 && s.shape.width < r.width * 2,
      );
    const change = async (name: string) => {
      await settle();
      const since = Math.floor(performance.now());
      stops.length = 0;
      play.classList.add(name);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const atMutation = [...stops];
      host.sample(await frame());
      const next = {
        stopped: host.snapshot().stopped,
        blocked: [...host.commit(paints)],
        height: playSurface()?.shape.height,
        expected: play.getBoundingClientRect().height,
        reads: reads(since),
      };
      play.classList.remove(name);
      return { atMutation, next };
    };
    const grow = await change('g13-grow');
    const wide = await change('g13-wide');
    host.destroy();
    style.remove();
    return { grow, wide, height: r.height };
  });
  // A resize can push controls anywhere on the page (G1.3 verification: one outside its group was
  // exposed while its box alone was replaced). Everything is hidden before the next paint, and the
  // next frame draws from a whole read that has the new box, or holds drawing.
  for (const name of ['grow', 'wide'] as const) {
    expect(result[name].atMutation, name).toContain(true);
    expect(Boolean(result[name].next.stopped) || result[name].next.reads > 0, JSON.stringify(result[name])).toBe(true);
  }
});

test('G1.3 (D14②): while the page scrolls, the answer check reads one group of controls per frame and finds a control moved without any mutation', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await scrollRoom(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    const host = api.createOperationGuardHost(document, source, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (let i = 0; i < 3; i++) host.sample(await frame());
    const log = (since: number) =>
      (JSON.parse(document.documentElement.getAttribute('data-around-guard-geometry') ?? '[]') as any[]).filter(
        (entry) => entry.at >= since,
      );
    // The phases last as long as 40 and 60 frames at 60Hz, whatever the display's rate: the answer
    // check waits and goes round by time (src/host/answer-check.ts), so 40 frames on a 165Hz screen
    // (about 240ms) ended before one round followed the 200ms window and failed every time (chunk 4
    // fix verification on the desktop). The assertions below are unchanged.
    const QUIET_MS = (40 * 1000) / 60,
      MOVED_MS = (60 * 1000) / 60;
    // 1. Quiet scrolling: the checks go round group by group, one per frame, with no whole read.
    let since = Math.floor(performance.now());
    for (const start = performance.now(); performance.now() - start < QUIET_MS;) {
      scrollBy(0, 4);
      host.sample(await frame());
    }
    const quiet = log(since);
    // 2. A guide link moved by an animation (no DOM mutation) while the page keeps scrolling.
    const link = document.querySelectorAll<HTMLElement>('ytd-guide-entry-renderer a#endpoint')[2]!;
    const before = link.getBoundingClientRect().left;
    link.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(300px)' }], {
      duration: 1,
      fill: 'forwards',
    });
    since = Math.floor(performance.now());
    const moved = performance.now();
    let found = -1,
      last = moved,
      longest = 0;
    while (found < 0 && performance.now() - moved < MOVED_MS) {
      scrollBy(0, 4);
      const time = await frame();
      longest = Math.max(longest, time - last);
      last = time;
      host.sample(time);
      const surface = (host.snapshot().surfaces.surfaces as any[]).find(
        (s) =>
          Math.abs(s.shape.left - (before + 300)) < 2 &&
          Math.abs(s.shape.width - link.getBoundingClientRect().width) < 2,
      );
      if (surface) found = time - moved;
    }
    host.destroy();
    return {
      quietReads: quiet.filter((e) => e.change === 'read').length,
      quietChecks: quiet.filter((e) => e.change === 'sweep').map((e) => [e.group, e.groups]),
      found,
      longest,
      movedLog: log(since).map((e) => e.change),
    };
  });
  // No whole read while only scrolling: the first scroll after the quiet settle checks every group
  // before the shifted read is used (the last check is older than the answer check bound).
  expect(result.quietReads, JSON.stringify(result)).toBe(0);
  const groups = result.quietChecks[0]?.[1] as number;
  expect(groups).toBeGreaterThan(1);
  // One group per frame, in order, round and round.
  expect(result.quietChecks.slice(0, groups).map(([group]) => group)).toEqual([...Array(groups).keys()]);
  // The moved link is found at the latest when the window that may be open ends (200ms) and one
  // round of groups has followed (one frame each, plus the frame that reads the whole page).
  expect(result.found, JSON.stringify(result.movedLog)).toBeGreaterThanOrEqual(0);
  expect(result.found, JSON.stringify(result)).toBeLessThanOrEqual(200 + (groups + 2) * result.longest);
});

test('G1.3: a read older than the answer check bound is never shifted; the first scroll after a quiet spell reads the page', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await scrollRoom(youtube);
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const source = api.youtubeOperations(document);
    source.capture({ fresh: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await frame();
    source.capture({ fresh: true });
    // Quiet: a guide link moves without any mutation (an animation), and nothing reads the page.
    const link = document.querySelectorAll<HTMLElement>('ytd-guide-entry-renderer a#endpoint')[2]!;
    const before = link.getBoundingClientRect().left;
    link.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(300px)' }], {
      duration: 1,
      fill: 'forwards',
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Then the page scrolls: the 600ms-old read must not be shifted and trusted.
    scrollBy(0, 30);
    await frame();
    const snapshot = source.capture({ coalesce: true });
    const moved = (snapshot.surfaces as any[]).some(
      (s) => Math.abs(s.shape.left - (before + 300)) < 2 && s.availability.visible,
    );
    const stale = (snapshot.surfaces as any[]).some(
      (s) => Math.abs(s.shape.left - before) < 0.5 && Math.abs(s.shape.top - link.getBoundingClientRect().top) < 2,
    );
    // Still quiet, read every frame (an animated layer draws): a second link moved without any
    // mutation is found within the bound, by the groups checked while nothing is pending.
    const other = document.querySelectorAll<HTMLElement>('ytd-guide-entry-renderer a#endpoint')[3]!;
    // Nothing pending: a whole read, then a quiet spell longer than the window.
    source.capture({ fresh: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await frame();
    const quietPending = source.pending();
    // The first link sits at the same left, so the second is told apart by its top.
    const otherBefore = other.getBoundingClientRect().left;
    const otherTop = other.getBoundingClientRect().top;
    other.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(300px)' }], {
      duration: 1,
      fill: 'forwards',
    });
    const start = performance.now();
    let found = -1;
    while (performance.now() - start < 1500 && found < 0) {
      await frame();
      const read = source.capture({ coalesce: true });
      if (
        (read.surfaces as any[]).some(
          (s) => Math.abs(s.shape.left - (otherBefore + 300)) < 2 && Math.abs(s.shape.top - otherTop) < 2,
        )
      )
        found = performance.now() - start;
    }
    source.destroy();
    return { moved, stale, scroll: snapshot.scroll.y === scrollY, found, quietPending };
  });
  expect(result).toMatchObject({ moved: true, stale: false, scroll: true, quietPending: 'none' });
  // TRUST_MS: 200ms + six groups at two frames each (34ms), plus the frame that reads it.
  expect(result.found).toBeGreaterThanOrEqual(0);
  expect(result.found).toBeLessThanOrEqual(200 + 6 * 34 + 34);
});
