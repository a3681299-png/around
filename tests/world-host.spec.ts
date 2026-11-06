import { test, expect } from './fixtures';
import type { WorldFrame } from '../src/world/types';
import type { WorldRecording } from '../src/world/recording';
import type { DesignDocument } from '../src/design/types';
import { image, isolate, media, open, overlay, reinject, save, watch } from './helpers/world-host';

test('explicit isolated developer recording replays live fixture evaluations and contains no page/form text', async ({
  popup,
  youtube,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  await panel.getByLabel('円形マスクを使う').check();
  await panel.getByLabel('動画の一時停止で隠す').check();
  await panel.getByLabel('マスクのフェード時間').fill('100');
  await save(panel);
  await watch(youtube);
  const runtime = await isolate(youtube, extensionId);
  expect(await runtime.evaluate('typeof globalThis.__wwWorldRuntime')).toBe('undefined');
  await reinject(runtime, 'compare', true);
  await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'hidden');
  await expect.poll(() => runtime.evaluate('Boolean(globalThis.__wwWorldRuntime?.frame())')).toBe(true);
  expect(
    await youtube.evaluate(
      () => typeof (globalThis as typeof globalThis & { __wwWorldRuntime?: unknown }).__wwWorldRuntime,
    ),
  ).toBe('undefined');
  expect(await runtime.evaluate<{ active: boolean }>('__wwWorldRuntime.status()')).toMatchObject({ active: false });
  await runtime.evaluate('__wwWorldRuntime.startRecording()');
  await youtube.mouse.move(240, 330);
  await youtube.mouse.move(320, 350);
  await youtube.locator('#movie_player [aria-label="Play"]').click();
  await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '1');
  await youtube.getByRole('textbox', { name: 'Search' }).fill('PRIVATE_FORM_VALUE_123');
  await youtube.locator('#movie_player [aria-label="Pause"]').click();
  await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '0');
  await youtube.setViewportSize({ width: 900, height: 700 });
  await youtube.mouse.move(400, 300);
  await expect.poll(() => runtime.evaluate<number>('__wwWorldRuntime.frame().layout.layers[0].frame.width')).toBe(900);
  const value = await runtime.evaluate<{
    recording: WorldRecording;
    expected: WorldFrame;
    replayed: WorldFrame;
  }>(`(() => {
    const expected = __wwWorldRuntime.frame(), recording = __wwWorldRuntime.stopRecording();
    return { recording, expected, replayed: __wwWorldRuntime.replay(JSON.stringify(recording)).frames.at(-1) };
  })()`);
  expect(value.replayed).toEqual(value.expected);
  expect(value.recording.inputs.length).toBeGreaterThan(3);
  expect(value.recording.inputs.flatMap((input) => input.events).map((event) => event.type)).toEqual(
    expect.arrayContaining(['video.play', 'video.pause', 'pointer.click']),
  );
  expect(JSON.stringify(value.recording)).not.toMatch(
    /PRIVATE_FORM_VALUE|https?:|cookie|authorization|innerHTML|keyCode/,
  );
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(await runtime.evaluate('typeof globalThis.__wwWorldRuntime')).toBe('undefined');
  await runtime.session.detach();
});

test('only a player the adapter reports reduced draws its layers reduced; the recording replays it', async ({
  popup,
  youtube,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  // The player anchor is chosen on the watch page, where the player is.
  await watch(youtube);
  await panel.getByLabel('配置の基準').selectOption('video-player');
  await panel.getByLabel('画像の幅', { exact: true }).fill('200');
  await panel.getByLabel('画像の高さ', { exact: true }).fill('120');
  await save(panel);
  const runtime = await isolate(youtube, extensionId);
  await reinject(runtime, 'runtime', true);
  await expect.poll(() => runtime.evaluate('Boolean(globalThis.__wwWorldRuntime?.frame())')).toBe(true);
  const drawn = () =>
    runtime.evaluate<{ height: number; player: number; box: number }>(`(() => {
      const layer = __wwWorldRuntime.frame().layout.layers[0];
      return {
        height: layer.layer.placement.heightPx,
        player: layer.frame?.height ?? 0,
        box: layer.bounds ? layer.bounds.bottom - layer.bounds.top : 0,
      };
    })()`);
  const box = async () => (await drawn()).box;
  await runtime.evaluate('__wwWorldRuntime.startRecording()');
  await expect.poll(async () => (await drawn()).height).toBe(120);
  // The layer is on the player, not the viewport.
  expect(await runtime.evaluate('__wwWorldRuntime.frame().layout.layers[0].layer.placement.anchor')).toEqual({
    kind: 'surface',
    target: 'video-player',
  });
  const regular = (await drawn()).player,
    viewport = youtube.viewportSize()!,
    drawnBox = await box();
  // The window shrunk at once: the regular player gets small, never reduced (no step at any height).
  await youtube.setViewportSize({ width: 520, height: 420 });
  await expect.poll(async () => (await drawn()).player).toBeLessThan(regular);
  expect((await drawn()).height).toBe(120);
  await expect.poll(box).toBeCloseTo(drawnBox, 0);
  await youtube.setViewportSize(viewport);
  await expect.poll(async () => (await drawn()).player).toBeCloseTo(regular, 3);
  // YouTube's miniplayer moves the player into its own element: reduced by its last regular height.
  const home = await youtube.locator('#movie_player').evaluate((player: HTMLElement) => {
    const mini = document.createElement('ytd-miniplayer');
    Object.assign(mini.style, { position: 'fixed', right: '12px', bottom: '12px', width: '400px', height: '225px' });
    document.body.append(mini);
    const style = player.getAttribute('style');
    (globalThis as typeof globalThis & { __home?: [Node, Node | null] }).__home = [
      player.parentNode!,
      player.nextSibling,
    ];
    mini.append(player);
    Object.assign(player.style, { width: '400px', height: '225px' });
    return style;
  });
  await expect(youtube.locator('#movie_player')).toHaveAttribute('data-ww-reduced', '');
  await expect.poll(async () => (await drawn()).player).toBeCloseTo(225, 3);
  await expect.poll(async () => (await drawn()).height).toBeCloseTo((120 * 225) / regular, 6);
  await expect.poll(box).toBeCloseTo((drawnBox * 225) / regular, 0);
  // Back on the page: as authored again.
  await youtube.locator('#movie_player').evaluate((player: HTMLElement, style) => {
    const [parent, next] = (globalThis as typeof globalThis & { __home?: [Node, Node | null] }).__home!;
    parent.insertBefore(player, next);
    if (style === null) player.removeAttribute('style');
    else player.setAttribute('style', style);
    document.querySelector('ytd-miniplayer')!.remove();
  }, home);
  await expect(youtube.locator('#movie_player')).not.toHaveAttribute('data-ww-reduced');
  await expect.poll(async () => (await drawn()).height).toBe(120);
  const value = await runtime.evaluate<{ recording: WorldRecording; expected: WorldFrame; replayed: WorldFrame[] }>(
    `(() => {
      const expected = __wwWorldRuntime.frame(), recording = __wwWorldRuntime.stopRecording();
      return { recording, expected, replayed: __wwWorldRuntime.replay(JSON.stringify(recording)).frames };
    })()`,
  );
  // Every frame was recorded (the reduced inputs did not stop it) and replays as evaluated.
  expect(value.recording.inputs.some((input) => input.reducedParts?.['video-player'] === regular)).toBe(true);
  expect(value.replayed.at(-1)).toEqual(value.expected);
  const reducedFrames = value.replayed.filter((frame) => frame.layout.layers[0]!.layer.placement.heightPx < 120);
  expect(reducedFrames.length).toBeGreaterThan(0);
  await runtime.session.detach();
});

test('recording-only listeners stop after artwork changes and idle/OFF leaves no recording loop', async ({
  popup,
  youtube,
  extensionId,
}) => {
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  await save(panel);
  await watch(youtube);
  const runtime = await isolate(youtube, extensionId);
  await reinject(runtime, 'runtime', true);
  await expect.poll(() => runtime.evaluate('Boolean(globalThis.__wwWorldRuntime?.frame())')).toBe(true);
  // The open editor reattaches to the reinjected page and binds its own page listeners (a click
  // among them) as it marks the page as editing; only listeners added after that are counted.
  await expect.poll(() => runtime.evaluate('document.documentElement.hasAttribute("data-ww-editing")')).toBe(true);
  await runtime.evaluate(`(() => {
    const listeners = new Map(), add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    globalThis.__worldRafs = 0;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this === document && ['pointermove', 'click'].includes(type)) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) { if (this === document) listeners.get(type)?.delete(listener); return remove.call(this, type, listener, options); };
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = callback => raf(time => { __worldRafs++; callback(time); });
    globalThis.__worldStats = () => ({ pointer: listeners.get('pointermove')?.size ?? 0, click: listeners.get('click')?.size ?? 0, rafs: __worldRafs });
  })()`);
  const stats = () => runtime.evaluate<{ pointer: number; click: number; rafs: number }>('__worldStats()');
  expect(await stats()).toMatchObject({ pointer: 0, click: 0 });
  await runtime.evaluate('__wwWorldRuntime.startRecording()');
  await expect.poll(stats).toMatchObject({ pointer: 1, click: 1 });
  await popup.evaluate(async () => {
    const key = 'webWorldThemes.design.youtube',
      value = (await chrome.storage.local.get(key))[key] as DesignDocument;
    value.decorations[0]!.name = 'Renamed world';
    await chrome.storage.local.set({ [key]: value });
  });
  await expect.poll(() => runtime.evaluate('__wwWorldRuntime.status().reason')).toBe('scene-changed');
  await expect.poll(stats).toMatchObject({ pointer: 0, click: 0 });
  await youtube.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  // A scene change may trigger G1's one-shot 360ms recovery frame. A fixed 300ms delay
  // sometimes starts counting before that frame; wait for the native protection state instead.
  await expect
    .poll(() => youtube.locator(overlay).evaluate((node: HTMLElement) => JSON.parse(node.dataset.wwSafety!).stopped))
    .toBe('');
  const before = (await stats()).rafs;
  await youtube.waitForTimeout(150);
  expect((await stats()).rafs).toBe(before);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(await runtime.evaluate('typeof globalThis.__wwWorldRuntime')).toBe('undefined');
  await runtime.session.detach();
});

test('legacy rollback build preserves mask editing and normal click-through', async ({
  popup,
  youtube,
  extensionId,
}) => {
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  await panel.getByLabel('円形マスクを使う').check();
  await save(panel);
  await watch(youtube);
  const runtime = await isolate(youtube, extensionId);
  await reinject(runtime, 'legacy', false);
  await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '1');
  await youtube.mouse.move(300, 320);
  await expect(youtube.locator(media)).toHaveCSS('mask-image', /radial-gradient/);
  await youtube.locator('#movie_player [aria-label="Mute"]').click();
  await expect(youtube.locator(`${overlay} .handle:visible`)).toHaveCount(0);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  await runtime.session.detach();
});
