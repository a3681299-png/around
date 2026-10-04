import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { contrastAt, installNativeYouTube, luminance, pixels, setNativeTheme } from './helpers/native-youtube';

const textSelectors = [
  '#fixture-current-title',
  'ytd-watch-metadata #owner #channel-name b',
  'ytd-watch-metadata #owner #channel-name small',
  'ytd-comments-header-renderer h2',
  'ytd-comments-header-renderer > span',
  'ytd-comments #author-text',
  'ytd-comments #content-text span',
  'ytd-playlist-panel-renderer .header #title yt-formatted-string',
  'ytd-playlist-panel-video-renderer:not([selected]) #video-title yt-formatted-string',
  'ytd-playlist-panel-video-renderer:not([selected]) #byline',
  'ytd-playlist-panel-video-renderer[selected] #video-title yt-formatted-string',
  'ytd-playlist-panel-video-renderer[selected] #byline',
];
const geometrySelectors = [
  '#player-container-outer', '#player-container-inner', '#player-container',
  'ytd-player', '#movie_player', '.html5-main-video',
];

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function assertContrast(page: Page, selector: string, minimum = 4.5, svg = false) {
  const result = await contrastAt(page, selector, svg);
  expect(result.unobscured, `${selector} probe was occluded by ${result.hit}`).toBe(true);
  expect(result.ratio, `${selector}: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(minimum);
  return result;
}

async function brandPaint(page: Page) {
  return page.locator('#fixture-play-red, #fixture-play-white').evaluateAll(elements => elements.map(element => ({
    fill: getComputedStyle(element).fill, filter: getComputedStyle(element).filter,
  })));
}

async function videoPixels(page: Page) {
  await page.locator('video').evaluate(element => element.scrollIntoView({ block: 'center' }));
  const rect = await page.locator('video').boundingBox();
  expect(rect).not.toBeNull();
  // Stay well inside media pixels, away from frames, native buttons, and overlays.
  const points = [0.2, 0.4, 0.6].flatMap(y => [0.2, 0.4, 0.6].map(x => ({
    x: Math.floor(rect!.x + rect!.width * x), y: Math.floor(rect!.y + rect!.height * y),
  })));
  return pixels(page, await page.screenshot({ scale: 'css', animations: 'disabled' }), points);
}

async function assertPlaylistFit(page: Page, collapsed: boolean) {
  const panel = page.locator('ytd-playlist-panel-renderer');
  await panel.evaluate((element, collapsed) => element.toggleAttribute('collapsed', collapsed), collapsed);
  await panel.scrollIntoViewIfNeeded();
  const measurements = await panel.evaluate(element => {
    const bar = element.querySelector<HTMLElement>('#web-world-themes-playlist-titlebar')!;
    const container = element.querySelector<HTMLElement>(':scope > #container')!;
    const header = element.querySelector<HTMLElement>('.header')!;
    const items = element.querySelector<HTMLElement>('#items')!;
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
    };
    const title = bar.querySelector('.ww-pane-title')!;
    const titleRange = document.createRange(); titleRange.selectNodeContents(title);
    const titleBox = titleRange.getBoundingClientRect();
    return {
      panel: rect(element), bar: rect(bar), container: rect(container), header: rect(header), items: rect(items),
      expectedBarHeight: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ww-pane-titlebar-height')),
      title: { top: titleBox.top, bottom: titleBox.bottom },
      itemsClientHeight: items.clientHeight, itemsScrollHeight: items.scrollHeight,
    };
  });
  expect(measurements.bar.height).toBeCloseTo(measurements.expectedBarHeight, 1);
  expect(measurements.bar.top).toBeGreaterThanOrEqual(measurements.panel.top);
  expect(measurements.bar.bottom).toBeLessThanOrEqual(measurements.panel.bottom);
  expect(measurements.title.top).toBeGreaterThanOrEqual(measurements.bar.top - 1);
  expect(measurements.title.bottom).toBeLessThanOrEqual(measurements.bar.bottom + 1);
  expect(measurements.container.top).toBeGreaterThanOrEqual(measurements.bar.bottom - 1);
  expect(measurements.container.bottom).toBeLessThanOrEqual(measurements.panel.bottom + 1);
  expect(measurements.header.bottom).toBeLessThanOrEqual(measurements.container.bottom + 1);
  if (!collapsed) {
    expect(measurements.panel.height).toBeCloseTo(402, 1);
    expect(measurements.itemsClientHeight).toBeGreaterThan(0);
    expect(measurements.itemsScrollHeight).toBeGreaterThan(measurements.itemsClientHeight);
    expect(measurements.items.top).toBeGreaterThanOrEqual(measurements.header.bottom - 1);
    expect(measurements.items.bottom).toBeLessThanOrEqual(measurements.panel.bottom + 1);
  }
}

async function assertHeaderAndWidth(page: Page) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector('ytd-masthead')!.getBoundingClientRect();
    const toolbar = document.querySelector('ytd-masthead > #container')!.getBoundingClientRect();
    const chrome = document.querySelector('#web-world-themes-window-chrome')!.getBoundingClientRect();
    const manager = document.querySelector('ytd-page-manager')!.getBoundingClientRect();
    return {
      scrollY, headerTop: header.top, headerBottom: header.bottom, toolbarTop: toolbar.top,
      chromeBottom: chrome.bottom, managerTop: manager.top, width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.headerTop).toBe(0);
  expect(layout.toolbarTop).toBeGreaterThanOrEqual(layout.chromeBottom - 1);
  if (layout.scrollY === 0) expect(layout.managerTop).toBeGreaterThanOrEqual(layout.headerBottom - 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
}

for (const dark of [false, true]) {
  for (const strength of [1, 60, 100]) {
    test(`native ${dark ? 'dark' : 'light'} surfaces keep real paint readable at ${strength}%`, async ({ popup, youtube }, testInfo) => {
      test.setTimeout(90_000);
      await youtube.setViewportSize({ width: 1360, height: 920 });
      await installNativeYouTube(youtube, dark);
      const nativeBrand = await brandPaint(youtube);
      expect(nativeBrand.map(part => part.fill)).toEqual(['rgb(255, 0, 51)', 'rgb(255, 255, 255)']);
      await setNativeTheme(popup, true, strength);
      await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
      await expect(youtube.locator('html')).toHaveAttribute('data-ww-mode', dark ? 'dark' : 'light');
      await expect(youtube.locator('html')).toHaveAttribute('style', new RegExp(`--ww-strength: ${strength / 100};`));
      await expect(youtube.locator('#web-world-themes-player-titlebar')).toBeVisible();
      await youtube.evaluate(() => window.scrollTo(0, 0));
      await assertHeaderAndWidth(youtube);
      await capture(youtube, testInfo, `native-${dark ? 'dark' : 'light'}-${strength}-top`);

      const wordmark = await assertContrast(youtube, '#youtube-paths_yt5', 4.5, true);
      expect(wordmark.backgroundLuminance).toBeGreaterThan(0.5);
      await assertContrast(youtube, '#guide-icon path', 3, true);
      expect(await brandPaint(youtube)).toEqual(nativeBrand);
      for (const selector of textSelectors) {
        const result = await assertContrast(youtube, selector);
        if (!selector.includes('renderer[selected]')) expect(result.backgroundLuminance).toBeGreaterThan(0.5);
      }
      await assertPlaylistFit(youtube, false);
      await assertPlaylistFit(youtube, true);
      await assertContrast(youtube, 'ytd-playlist-panel-renderer .header #title yt-formatted-string');
      await assertPlaylistFit(youtube, false);
      await youtube.evaluate(() => window.scrollTo(0, 454));
      await assertHeaderAndWidth(youtube);
      // Native content may scroll behind the fixed masthead. That is not clipping:
      // the bar containment assertion above is in the panel's own coordinates.
      await capture(youtube, testInfo, `native-${dark ? 'dark' : 'light'}-${strength}-scroll-454`);
    });
  }
}

for (const dark of [false, true]) {
  test(`native ${dark ? 'dark' : 'light'} geometry and paint restore after zero and OFF`, async ({ popup, youtube }, testInfo) => {
    test.setTimeout(90_000);
    await youtube.setViewportSize({ width: 1360, height: 920 });
    await installNativeYouTube(youtube, dark);
    await youtube.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => youtube.locator('video').evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    await youtube.getByRole('button', { name: 'Pause', exact: true }).click();
    const nativePixels = await videoPixels(youtube);
    expect(new Set(nativePixels.map(pixel => pixel.join(','))).size, 'The media probe must contain actual artwork, not an all-black frame').toBeGreaterThan(1);
    const native = await youtube.evaluateHandle(selectors => selectors.map(selector => {
      const element = document.querySelector(selector)!;
      const { width, height } = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { element, parent: element.parentElement, width, height, filter: style.filter, transform: style.transform, objectFit: style.objectFit };
    }), geometrySelectors);
    const snapshot = () => youtube.evaluate(() => {
      const selectors = [
        'ytd-app', '#columns', '#primary', '#below', '#cinematics', '#cinematics .box',
        '#guide-icon', '#youtube-paths_yt5', '#fixture-current-title', '#owner',
        'ytd-comments-header-renderer', 'ytd-playlist-panel-renderer',
        'ytd-playlist-panel-video-renderer:not([selected]) #byline',
      ];
      return selectors.map(selector => {
        const node = document.querySelector(selector)!;
        const style = getComputedStyle(node);
        return { selector, color: style.color, background: style.backgroundColor, fill: style.fill, display: style.display, borderRadius: style.borderRadius };
      });
    });
    const nativePaint = await snapshot();
    const nativeBrand = await brandPaint(youtube);
    const assertGeometry = async () => {
      expect(await youtube.evaluate(records => records.map(({ element, parent, width, height, filter, transform, objectFit }) => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return {
          connected: element.isConnected, sameParent: element.parentElement === parent,
          widthDelta: Math.abs(box.width - width), heightDelta: Math.abs(box.height - height),
          sameFilter: style.filter === filter, sameTransform: style.transform === transform, sameObjectFit: style.objectFit === objectFit,
        };
      }), native)).toEqual(geometrySelectors.map(() => ({
        connected: true, sameParent: true, widthDelta: 0, heightDelta: 0,
        sameFilter: true, sameTransform: true, sameObjectFit: true,
      })));
      const layout = await youtube.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        return { playerBottom: rect('#movie_player')!.bottom, belowTop: rect('#below')!.top, barBottom: rect('#web-world-themes-player-titlebar')?.bottom ?? null, outerTop: rect('#player-container-outer')!.top };
      });
      expect(layout.belowTop).toBeGreaterThanOrEqual(layout.playerBottom - 1);
      if (layout.barBottom !== null) expect(layout.barBottom).toBeLessThanOrEqual(layout.outerTop + 1);
      expect(await videoPixels(youtube)).toEqual(nativePixels);
    };
    for (const strength of [1, 60, 100]) {
      await setNativeTheme(popup, true, strength);
      await expect(youtube.locator('#web-world-themes-player-titlebar')).toBeVisible();
      expect(await youtube.locator('#web-world-themes-player-titlebar').evaluate(element => element.nextElementSibling?.id)).toBe('player-container-outer');
      await expect(youtube.locator('#player-container-outer #web-world-themes-player-titlebar')).toHaveCount(0);
      await expect(youtube.locator('#cinematics')).not.toBeVisible();
      await assertGeometry();
    }
    for (const state of [{ enabled: true, strength: 0, label: 'zero' }, { enabled: false, strength: 60, label: 'off' }]) {
      await setNativeTheme(popup, true, 60);
      await expect(youtube.locator('#web-world-themes-player-titlebar')).toHaveCount(1);
      await setNativeTheme(popup, state.enabled, state.strength);
      await expect(youtube.locator('#web-world-themes-style')).toHaveCount(0);
      await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
      for (const id of ['window-chrome', 'player-titlebar', 'playlist-titlebar', 'statusbar']) {
        await expect(youtube.locator(`#web-world-themes-${id}`)).toHaveCount(0);
      }
      expect(await snapshot()).toEqual(nativePaint);
      expect(await brandPaint(youtube)).toEqual(nativeBrand);
      expect(await youtube.locator('html').evaluate(element => element.hasAttribute('dark'))).toBe(dark);
      await assertGeometry();
      const nativeText = await assertContrast(youtube, '#fixture-current-title');
      if (dark) expect(nativeText.backgroundLuminance).toBeLessThan(0.05);
      await youtube.evaluate(() => window.scrollTo(0, 0));
      await capture(youtube, testInfo, `native-${dark ? 'dark' : 'light'}-restored-${state.label}`);
    }
    await native.dispose();
  });
}

test('native narrow watch remains readable and unclipped at 900px while scrolling', async ({ popup, youtube }, testInfo) => {
  test.setTimeout(90_000);
  await youtube.setViewportSize({ width: 900, height: 760 });
  await installNativeYouTube(youtube, true);
  await setNativeTheme(popup, true, 100);
  await expect(youtube.locator('#web-world-themes-player-titlebar')).toBeVisible();
  await youtube.evaluate(() => window.scrollTo(0, 0));
  await assertHeaderAndWidth(youtube);
  const playerBar = await youtube.locator('#web-world-themes-player-titlebar').boundingBox();
  const video = await youtube.locator('video').boundingBox();
  expect(playerBar!.y + playerBar!.height).toBeLessThanOrEqual(video!.y + 1);
  expect(playerBar!.x).toBeGreaterThanOrEqual(0);
  expect(playerBar!.x + playerBar!.width).toBeLessThanOrEqual(900);
  await capture(youtube, testInfo, 'native-dark-900-top');
  await assertContrast(youtube, '#youtube-paths_yt5', 4.5, true);
  await assertContrast(youtube, 'ytd-comments-header-renderer h2');
  await assertContrast(youtube, 'ytd-comments #content-text span');
  await capture(youtube, testInfo, 'native-dark-900-comments');
  await assertPlaylistFit(youtube, false);
  await assertContrast(youtube, 'ytd-playlist-panel-video-renderer:not([selected]) #byline');
  await capture(youtube, testInfo, 'native-dark-900-playlist-expanded');
  await assertPlaylistFit(youtube, true);
  await capture(youtube, testInfo, 'native-dark-900-playlist-collapsed');
  await youtube.evaluate(() => window.scrollTo(0, 454));
  await assertHeaderAndWidth(youtube);
  const icon = await assertContrast(youtube, '#guide-icon path', 3, true);
  expect(luminance(icon.ink)).toBeLessThan(0.2);
  await capture(youtube, testInfo, 'native-dark-900-scroll-454');
});
