import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const decorationIds = [
  'web-world-themes-window-chrome',
  'web-world-themes-player-titlebar',
  'web-world-themes-playlist-titlebar',
  'web-world-themes-statusbar',
  'web-world-themes-clock',
];

async function setStrength(popup: Page, strength: number) {
  await popup.evaluate(async (value) => {
    await chrome.storage.local.set({ 'webWorldThemes.strength': value });
  }, strength);
  await expect(popup.getByRole('slider', { name: 'エフェクトの強さ' })).toHaveValue(String(strength));
}

async function readColors(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      // Canvas parses both rgb() and modern color(srgb ...) computed CSS values.
      const context = document.createElement('canvas').getContext('2d')!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      };
      return {
        background: style.backgroundColor,
        color: style.color,
        backgroundLuminance: luminance(style.backgroundColor),
        inkLuminance: luminance(style.color),
      };
    });
}

test('all active strengths stay silver, square, and readable in native dark mode', async ({ popup, youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  const root = youtube.locator('html');
  const contentSelectors = [
    '#fixture-current-title',
    'yt-lockup-metadata-view-model h3 span',
    'ytd-playlist-panel-video-renderer:not([selected]) #video-title yt-formatted-string',
    '#content-text span',
    '#contenteditable-root',
  ];
  for (const strength of [1, 25, 60, 100]) {
    await setStrength(popup, strength);
    await expect(root).toHaveAttribute('style', new RegExp(`--ww-strength: ${strength / 100};`));
    await root.evaluate((element) => element.removeAttribute('dark'));
    await expect(root).toHaveAttribute('data-ww-mode', 'light');
    const lightPage = await readColors(youtube, 'body');
    const lightPanel = await readColors(youtube, 'ytd-playlist-panel-renderer #items');
    const lightInk = await Promise.all(contentSelectors.map((selector) => readColors(youtube, selector)));
    await root.evaluate((element) => element.setAttribute('dark', ''));
    await expect(root).toHaveAttribute('data-ww-mode', 'dark');
    expect(await readColors(youtube, 'body')).toEqual(lightPage);
    expect(await readColors(youtube, 'ytd-playlist-panel-renderer #items')).toEqual(lightPanel);
    expect(lightPage.backgroundLuminance).toBeGreaterThan(0.5);
    expect(lightPanel.backgroundLuminance).toBeGreaterThan(0.5);
    for (const [index, selector] of contentSelectors.entries()) {
      const node = youtube.locator(selector).first();
      await expect(node).toHaveCSS('font-weight', '400');
      const colors = await readColors(youtube, selector);
      expect(colors.color).toBe(lightInk[index]!.color);
      expect(colors.inkLuminance).toBeLessThan(0.2);
      expect((lightPage.backgroundLuminance + 0.05) / (colors.inkLuminance + 0.05)).toBeGreaterThanOrEqual(4.5);
      expect(await node.evaluate((element) => getComputedStyle(element).fontFamily)).not.toContain('Web World Pixel');
    }
    const playlistLabel = youtube.locator('ytd-playlist-panel-renderer .header #title yt-formatted-string');
    await expect(playlistLabel).toHaveCSS('font-weight', '400');
    expect(
      (await readColors(youtube, 'ytd-playlist-panel-renderer .header #title yt-formatted-string')).inkLuminance,
    ).toBeLessThan(0.2);
    const rounded = await youtube
      .locator('[data-ww-surface], .thumbnail-art, .avatar, .brand-mark')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            return [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomLeftRadius,
              style.borderBottomRightRadius,
            ].some((radius) => radius !== '0px');
          })
          .map((element) => ({
            tag: element.tagName,
            id: element.id,
            surfaces: element.getAttribute('data-ww-surface'),
          })),
      );
    expect(rounded).toEqual([]);
  }
  await setStrength(popup, 0);
  await expect(youtube.locator('#web-world-themes-style')).toHaveCount(0);
  await expect(youtube.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await expect(youtube.locator('#fixture-current-title')).toHaveCSS('font-weight', '700');
  await expect(youtube.locator('ytd-playlist-panel-renderer')).toHaveCSS('border-radius', '12px');
});

test('player and playlist windows track text-node changes, selected rows, and SPA video navigation', async ({
  popup,
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  const native = await youtube.evaluateHandle(() => ({
    player: document.querySelector('#movie_player')!,
    playerParent: document.querySelector('#movie_player')!.parentElement,
    playlist: document.querySelector('ytd-playlist-panel-renderer')!,
    playlistParent: document.querySelector('ytd-playlist-panel-renderer')!.parentElement,
    title: document.querySelector('#fixture-current-title')!,
    comment: document.querySelector('#contenteditable-root')!,
  }));
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  const playerTitle = youtube.locator('#web-world-themes-player-titlebar');
  const playlistTitle = youtube.locator('#web-world-themes-playlist-titlebar');
  const rows = youtube.locator('ytd-playlist-panel-video-renderer');
  await expect(playerTitle).toContainText('A quiet afternoon by the sea');
  await expect(playlistTitle).toContainText('Quiet corners / 作業用プレイリスト');
  await expect(youtube.locator('#movie_player')).toHaveAttribute('data-ww-surface', /\bplayer-window\b/);
  await expect(youtube.locator('ytd-playlist-panel-renderer')).toHaveAttribute(
    'data-ww-surface',
    /\bplaylist-window\b/,
  );
  await expect(rows.first()).toHaveAttribute('data-ww-surface', /\bselected\b/);
  await expect(rows.nth(1)).not.toHaveAttribute('data-ww-surface', /\bselected\b/);
  expect(
    await youtube.evaluate(
      ({ player, playerParent, playlist, playlistParent, title, comment }) =>
        player.isConnected &&
        player.parentElement === playerParent &&
        playlist.isConnected &&
        playlist.parentElement === playlistParent &&
        document.querySelector('#fixture-current-title') === title &&
        document.querySelector('#contenteditable-root') === comment,
      native,
    ),
  ).toBe(true);
  expect(await playerTitle.evaluate((element) => element.nextElementSibling?.id)).toBe('movie_player');

  // Text.data is a characterData mutation, unlike textContent's childList replacement.
  await youtube.locator('#fixture-current-title').evaluate((element) => {
    (element.firstChild as Text).data = '海辺の午後 / Updated without navigation';
  });
  await expect(playerTitle).toContainText('海辺の午後 / Updated without navigation');
  await youtube.locator('ytd-playlist-panel-renderer #title yt-formatted-string').evaluate((element) => {
    (element.firstChild as Text).data = 'Late-night software / 更新済み';
  });
  await expect(playlistTitle).toContainText('Late-night software / 更新済み');
  await youtube.locator('html').evaluate((element) => element.setAttribute('dark', ''));
  const selectedColors = await readColors(youtube, 'ytd-playlist-panel-video-renderer[selected]');
  const selectedText = await readColors(
    youtube,
    'ytd-playlist-panel-video-renderer[selected] #video-title yt-formatted-string',
  );
  expect(selectedColors.backgroundLuminance).toBeLessThan(0.2);
  expect(selectedText.inkLuminance).toBeGreaterThan(0.8);
  expect((selectedText.inkLuminance + 0.05) / (selectedColors.backgroundLuminance + 0.05)).toBeGreaterThanOrEqual(4.5);
  await rows.first().evaluate((element) => element.removeAttribute('selected'));
  await rows.nth(1).evaluate((element) => element.setAttribute('selected', ''));
  await expect(rows.first()).not.toHaveAttribute('data-ww-surface', /\bselected\b/);
  await expect(rows.nth(1)).toHaveAttribute('data-ww-surface', /\bselected\b/);
  expect(
    (await readColors(youtube, 'ytd-playlist-panel-video-renderer:nth-child(1) #video-title yt-formatted-string'))
      .inkLuminance,
  ).toBeLessThan(0.2);

  const duration = rows.nth(1).locator('ytd-thumbnail-overlay-time-status-renderer');
  await expect(duration).toHaveAttribute('data-ww-surface', /\bduration\b/);
  const lcd = await readColors(
    youtube,
    'ytd-playlist-panel-video-renderer:nth-child(2) ytd-thumbnail-overlay-time-status-renderer',
  );
  expect(lcd.backgroundLuminance).toBeLessThan(0.2);
  expect(lcd.inkLuminance).toBeGreaterThan(0.5);
  await expect(duration).toHaveCSS('border-radius', '0px');
  await rows.nth(1).locator('a').click();
  await expect(youtube).toHaveURL(/v=fixture-1&list=fixture/);
  await expect(playerTitle).toContainText('Building a tiny music studio');
  await expect(rows.nth(1)).toHaveAttribute('data-ww-surface', /\bselected\b/);
  for (const id of decorationIds) await expect(youtube.locator(`#${id}`)).toHaveCount(1);
  for (const id of [
    'web-world-themes-player-titlebar',
    'web-world-themes-playlist-titlebar',
    'web-world-themes-statusbar',
  ]) {
    await youtube.locator(`#${id}`).evaluate((element) => element.remove());
    await expect(youtube.locator(`#${id}`)).toHaveCount(1);
  }
  await youtube.goBack();
  await expect(playerTitle).toContainText('A quiet afternoon by the sea');
  for (const id of decorationIds) await expect(youtube.locator(`#${id}`)).toHaveCount(1);
  await native.dispose();
});

test('packaged pixel font loads for chrome and the LCD clock without external font requests', async ({
  context,
  extensionId,
  popup,
  youtube,
}) => {
  // Keep this typography/clock check in an unobstructed viewport. Collision
  // yielding at ordinary watch sizes is covered separately in chrome-safety.
  await youtube.setViewportSize({ width: 1100, height: 2000 });
  const fontRequests: string[] = [];
  context.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  await expect(youtube.locator('#web-world-themes-clock')).toBeVisible();
  await expect
    .poll(() =>
      youtube.evaluate(async () => {
        await document.fonts.load('12px "Web World Pixel"');
        return (
          document.fonts.check('12px "Web World Pixel"') &&
          [...document.fonts].some(
            (face) => face.family.replace(/["']/g, '') === 'Web World Pixel' && face.status === 'loaded',
          )
        );
      }),
    )
    .toBe(true);
  for (const selector of [
    '.ww-window-title',
    '#web-world-themes-player-titlebar',
    '#web-world-themes-playlist-titlebar',
    '#web-world-themes-clock',
  ]) {
    await expect(youtube.locator(selector).first()).toHaveCSS('font-family', /Web World Pixel/);
    await expect(youtube.locator(selector).first()).toHaveCSS('font-size', '12px');
  }
  const loadedFonts = await youtube.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\.(?:woff2?|ttf|otf)(?:$|\?)/i.test(name)),
  );
  const observedFonts = [...new Set([...fontRequests, ...loadedFonts])];
  expect(observedFonts.length).toBeGreaterThan(0);
  expect(observedFonts.every((url) => url.startsWith(`chrome-extension://${extensionId}/`))).toBe(true);
  expect(observedFonts.some((url) => url.endsWith('/assets/fonts/PixelMplus12-Regular.woff2'))).toBe(true);
  const status = youtube.locator('#web-world-themes-statusbar');
  const clock = youtube.locator('time#web-world-themes-clock');
  await expect(status).toHaveCSS('position', 'fixed');
  await expect(clock).toHaveText(/^\d{2}:\d{2}$/);
  expect(await clock.evaluate((element) => element.closest('[aria-live]')?.getAttribute('aria-live'))).toBe('off');
  const rect = await status.boundingBox();
  expect(rect!.height).toBeGreaterThan(0);
  expect(rect!.height).toBeLessThanOrEqual(26);
  expect(Math.abs(rect!.y + rect!.height - youtube.viewportSize()!.height)).toBeLessThanOrEqual(1);
  const colors = await readColors(youtube, '#web-world-themes-clock');
  expect(colors.backgroundLuminance).toBeLessThan(0.2);
  expect(colors.inkLuminance).toBeGreaterThan(0.5);
  await expect(youtube.locator('#fixture-current-title')).toHaveCSS('font-size', '16px');
  await expect(youtube.locator('#content-text span')).toHaveCSS('font-size', '13px');
});

test('optional chrome owns every decoration and OFF or zero releases its timers and observers', async ({
  context,
  extensionId,
  popup,
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await expect(youtube.locator('[data-ww-settings-button]')).toHaveCount(1);
  const session = await context.newCDPSession(youtube);
  const worlds: Array<{ id: number; origin: string; name: string }> = [];
  session.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await session.send('Runtime.enable');
  const extensionWorld = worlds.find(
    (world) => world.origin === `chrome-extension://${extensionId}` || world.name === extensionId,
  );
  expect(extensionWorld, 'The real MV3 content-script isolated world must exist').toBeDefined();
  const evaluate = async (expression: string) => {
    const result = await session.send('Runtime.evaluate', {
      contextId: extensionWorld!.id,
      expression,
      returnByValue: true,
    });
    expect(result.exceptionDetails).toBeUndefined();
    return result.result.value as { intervals: number; observers: number };
  };
  // Instrument the isolated extension realm only; the fixture's playback interval and
  // the independently mounted player-settings observer were created earlier and are excluded.
  await evaluate(`(() => {
    const intervals = new Set();
    const observers = new Set();
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const NativeObserver = window.MutationObserver;
    window.setInterval = (...args) => { const id = nativeSetInterval(...args); intervals.add(id); return id; };
    window.clearInterval = id => { intervals.delete(id); nativeClearInterval(id); };
    window.MutationObserver = class extends NativeObserver {
      observe(...args) { observers.add(this); return super.observe(...args); }
      disconnect() { observers.delete(this); return super.disconnect(); }
    };
    window.__wwTestLifetimes = () => ({ intervals: intervals.size, observers: observers.size });
  })()`);
  const counts = () => evaluate('window.__wwTestLifetimes()');
  const toggle = popup.getByRole('switch', { name: 'テーマを使う' });
  const feature = popup.getByRole('switch', { name: '窓の飾り', exact: true });
  const assertAbsent = async () => {
    for (const id of decorationIds) await expect(youtube.locator(`#${id}`)).toHaveCount(0);
  };
  for (let cycle = 0; cycle < 2; cycle++) {
    await toggle.check();
    await setStrength(popup, 100);
    await youtube.bringToFront();
    for (const id of decorationIds) await expect(youtube.locator(`#${id}`)).toHaveCount(1);
    await expect.poll(async () => (await counts()).intervals).toBe(1);
    if (cycle === 0) {
      const initialTime = await youtube.locator('#web-world-themes-clock').textContent();
      await evaluate(`(() => {
        const NativeDate = Date;
        window.__wwNativeDate = NativeDate;
        window.Date = class extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [NativeDate.now() + 60000])); }
          static now() { return NativeDate.now() + 60000; }
        };
      })()`);
      await expect(youtube.locator('#web-world-themes-clock')).not.toHaveText(initialTime!);
      await evaluate('window.Date = window.__wwNativeDate');
    }
    const activeObservers = (await counts()).observers;
    expect(activeObservers).toBeGreaterThan(0);
    await feature.uncheck();
    await assertAbsent();
    expect((await counts()).intervals).toBe(0);
    expect((await counts()).observers).toBeLessThan(activeObservers);
    await expect(youtube.locator('#web-world-themes-style')).toHaveCount(1);
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-window-chrome', '');
    await feature.check();
    await youtube.bringToFront();
    for (const id of decorationIds) await expect(youtube.locator(`#${id}`)).toHaveCount(1);
    await setStrength(popup, 0);
    await assertAbsent();
    await expect.poll(counts).toEqual({ intervals: 0, observers: 0 });
    await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
    await setStrength(popup, 60);
    await expect(youtube.locator('#web-world-themes-clock')).toHaveCount(1);
    await toggle.uncheck();
    await assertAbsent();
    await expect.poll(counts).toEqual({ intervals: 0, observers: 0 });
    await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
    const extensionAttributes = await youtube.locator('*').evaluateAll((elements) =>
      elements
        .filter((element) => element.id !== 'web-world-themes-panel')
        .flatMap((element) =>
          element
            .getAttributeNames()
            .filter((name) => name.startsWith('data-ww-') && !name.startsWith('data-ww-settings'))
            .map((name) => `${element.tagName}:${name}`),
        ),
    );
    expect(extensionAttributes).toEqual([]);
    await youtube.locator('#fixture-current-title').evaluate((element) => {
      (element.firstChild as Text).data = `Off-state update ${Date.now()}`;
    });
    await youtube.evaluate(() => document.dispatchEvent(new Event('yt-page-data-updated')));
    await assertAbsent();
    expect(await counts()).toEqual({ intervals: 0, observers: 0 });
  }
  await session.detach();
});

test('native absolute player wrappers keep video dimensions and ancestry through chrome toggles and fullscreen', async ({
  popup,
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await youtube.evaluate(() => {
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    const outer = document.createElement('div');
    outer.id = 'player-container-outer';
    outer.style.cssText = 'position:relative;width:100%;aspect-ratio:16 / 9;';
    const inner = document.createElement('div');
    inner.id = 'player-container-inner';
    inner.style.cssText = 'position:absolute;inset:0;';
    const nativePlayer = document.createElement('ytd-player');
    nativePlayer.style.cssText = 'display:block;width:100%;height:100%;';
    player.before(outer);
    outer.append(inner);
    inner.append(nativePlayer);
    nativePlayer.append(player);
    player.style.height = '100%';
  });
  await expect(youtube.locator('[data-ww-settings-button]')).toHaveCount(1);
  const native = await youtube.evaluateHandle(() => {
    const selectors = ['#player-container-outer', '#player-container-inner', 'ytd-player', '#movie_player', 'video'];
    return selectors.map((selector) => {
      const element = document.querySelector(selector)!;
      const { width, height } = element.getBoundingClientRect();
      return { element, parent: element.parentElement, width, height };
    });
  });
  const assertNativeGeometry = async () => {
    expect(
      await youtube.evaluate(
        (nodes) =>
          nodes.map(({ element, parent, width, height }) => {
            const rect = element.getBoundingClientRect();
            return {
              connected: element.isConnected,
              parentPreserved: element.parentElement === parent,
              widthPreserved: Math.abs(rect.width - width) < 0.1,
              heightPreserved: Math.abs(rect.height - height) < 0.1,
            };
          }),
        native,
      ),
    ).toEqual(
      Array.from({ length: 5 }, () => ({
        connected: true,
        parentPreserved: true,
        widthPreserved: true,
        heightPreserved: true,
      })),
    );
  };
  const toggle = popup.getByRole('switch', { name: 'テーマを使う' });
  const feature = popup.getByRole('switch', { name: '窓の飾り', exact: true });
  const titlebar = youtube.locator('#web-world-themes-player-titlebar');
  const video = youtube.locator('video');
  await youtube.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await toggle.check();
  for (const strength of [1, 60, 100]) {
    await setStrength(popup, strength);
    await expect(titlebar).toContainText('A quiet afternoon by the sea');
    expect(await titlebar.evaluate((element) => element.nextElementSibling?.id)).toBe('player-container-outer');
    await expect(youtube.locator('#player-container-outer #web-world-themes-player-titlebar')).toHaveCount(0);
    await assertNativeGeometry();
  }
  await feature.uncheck();
  await expect(titlebar).toHaveCount(0);
  await assertNativeGeometry();
  await feature.check();
  await expect(titlebar).toHaveCount(1);
  await assertNativeGeometry();

  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await expect(titlebar).not.toBeVisible();
  await expect(youtube.locator('#web-world-themes-statusbar')).not.toBeVisible();
  const fullscreenVideo = await video.boundingBox();
  expect(fullscreenVideo!.width).toBe(youtube.viewportSize()!.width);
  expect(fullscreenVideo!.height).toBe(youtube.viewportSize()!.height);
  expect(
    await youtube.evaluate(
      (nodes) => nodes.every(({ element, parent }) => element.isConnected && element.parentElement === parent),
      native,
    ),
  ).toBe(true);
  await youtube.evaluate(() => document.exitFullscreen());
  await expect(titlebar).toBeVisible();
  await assertNativeGeometry();
  await setStrength(popup, 0);
  await expect(titlebar).toHaveCount(0);
  await assertNativeGeometry();
  await setStrength(popup, 60);
  await expect(titlebar).toHaveCount(1);
  await toggle.uncheck();
  await expect(titlebar).toHaveCount(0);
  await assertNativeGeometry();
  const time = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(time);
  await youtube.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await native.dispose();
});
