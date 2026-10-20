import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { contrastAt, installNativeYouTube, pixels } from './helpers/native-youtube';
import { PALETTE_PRESETS } from '../src/themes/retro/palette';

async function save(popup: Page, patch: Record<string, boolean | number>) {
  await popup.evaluate((values) => chrome.storage.local.set(values), patch);
}

async function feature(popup: Page, id: string, enabled: boolean) {
  await save(popup, { [`webWorldThemes.features.${id}`]: enabled });
}

async function addModernBadges(page: Page) {
  await page.evaluate(() => {
    const related = document.querySelector('#related') ?? document.querySelector('ytd-watch-flexy')!;
    const card = document.createElement('ytd-compact-video-renderer');
    card.id = 'fixture-modern-badges';
    card.innerHTML =
      '<a href="/watch?v=another"><yt-thumbnail-badge-view-model><badge-shape id="fixture-duration" class="ytBadgeShapeHost"><span class="ytBadgeShapeText">5:28</span></badge-shape></yt-thumbnail-badge-view-model><yt-thumbnail-overlay-badge-view-model><yt-thumbnail-badge-view-model><badge-shape id="fixture-special" class="ytBadgeShapeHost ytBadgeShapeThumbnailSpecial"><span class="ytBadgeShapeText">新着</span></badge-shape></yt-thumbnail-badge-view-model></yt-thumbnail-overlay-badge-view-model></a>';
    related.append(card);
    const votes = document.createElement('ytd-comment-engagement-bar');
    votes.innerHTML =
      '<div id="toolbar"><span id="vote-count-middle" style="color:rgb(180,180,180)">3.8万</span><button id="fixture-vote-action">Like</button></div>';
    document.querySelector('ytd-comments')!.append(votes);
    document
      .querySelector('#fixture-vote-action')!
      .addEventListener('click', (event) => (event.currentTarget as HTMLElement).setAttribute('aria-pressed', 'true'));
    const css = document.createElement('style');
    css.textContent =
      'badge-shape { display:inline-block; background:rgba(0,0,0,.6); color:white; font:14px Arial; margin:4px; } badge-shape .ytBadgeShapeText { color:white; font:14px Arial; }';
    document.head.append(css);
  });
}

test('modern recommendation durations match playlist LCDs without restyling LIVE or new badges', async ({
  popup,
  youtube,
}) => {
  await installNativeYouTube(youtube, true);
  await addModernBadges(youtube);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  const duration = youtube.locator('#fixture-duration');
  await expect(duration).toHaveAttribute('data-ww-surface', /duration/);
  await expect(duration.locator('.ytBadgeShapeText')).toHaveCSS('font-size', '12px');
  await expect(duration.locator('.ytBadgeShapeText')).toHaveCSS('font-family', /Web World Pixel/);
  const style = await duration.evaluate((el) => ({
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(
    await youtube
      .locator('ytd-thumbnail-overlay-time-status-renderer')
      .first()
      .evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })),
  ).toEqual(style);
  await expect(youtube.locator('#fixture-special')).not.toHaveAttribute('data-ww-surface', /duration/);
  await duration.locator('span').evaluate((el) => {
    el.firstChild!.textContent = 'LIVE';
  });
  await expect(duration).not.toHaveAttribute('data-ww-surface', /duration/);
  await duration.locator('span').evaluate((el) => {
    el.firstChild!.textContent = '1:23:45';
  });
  await expect(duration).toHaveAttribute('data-ww-surface', /duration/);
  await youtube.evaluate(() => {
    const wrapper = document.createElement('ytd-thumbnail-overlay-time-status-renderer');
    wrapper.id = 'fixture-nested-duration';
    wrapper.innerHTML =
      '<yt-thumbnail-badge-view-model><badge-shape><span class="ytBadgeShapeText">5:28</span></badge-shape></yt-thumbnail-badge-view-model>';
    document.querySelector('#fixture-modern-badges')!.append(wrapper);
  });
  const nested = youtube.locator('#fixture-nested-duration');
  await expect(nested).toHaveAttribute('data-ww-surface', /duration/);
  await nested.locator('span').evaluate((el) => {
    el.firstChild!.textContent = 'LIVE';
  });
  await expect(nested).not.toHaveAttribute('data-ww-surface', /duration/);
  await nested.locator('span').evaluate((el) => {
    el.firstChild!.textContent = '5:28';
  });
  await expect(nested).toHaveAttribute('data-ww-surface', /duration/);
  await feature(popup, 'lcd-durations', false);
  await expect(duration.locator('span')).toHaveCSS('font-size', '14px');
  await feature(popup, 'lcd-durations', true);
  await expect(duration.locator('span')).toHaveCSS('font-size', '12px');
});

test('comment vote numbers have readable contrast and native actions survive their own toggle', async ({
  popup,
  youtube,
}) => {
  await installNativeYouTube(youtube, true);
  await addModernBadges(youtube);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  const count = youtube.locator('#vote-count-middle');
  await expect(count).toHaveAttribute('data-ww-surface', /comment-vote/);
  await count.scrollIntoViewIfNeeded();
  expect((await contrastAt(youtube, '#vote-count-middle')).ratio).toBeGreaterThanOrEqual(4.5);
  await expect(count).toHaveText('3.8万');
  await youtube.locator('#fixture-vote-action').click();
  await expect(youtube.locator('#fixture-vote-action')).toHaveAttribute('aria-pressed', 'true');
  await feature(popup, 'readable-votes', false);
  await expect(count).toHaveCSS('color', 'rgb(180, 180, 180)');
  await feature(popup, 'readable-votes', true);
  await expect(count).not.toHaveCSS('color', 'rgb(180, 180, 180)');
});

test('presets and palette extremes stay legible in both native modes and persist across reloads', async ({
  popup,
  youtube,
}, testInfo) => {
  test.setTimeout(120_000);
  await installNativeYouTube(youtube, true);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  for (const [name, palette] of Object.entries(PALETTE_PRESETS)) {
    await popup.getByRole('button', { name: name[0]!.toUpperCase() + name.slice(1), exact: true }).click();
    await expect(popup.locator('#palette-hue')).toHaveValue(String(palette.hue));
    await expect
      .poll(() => youtube.locator('html').evaluate((el) => el.style.getPropertyValue('--ww-retro-page')))
      .not.toBe('');
    await youtube.evaluate(() => window.scrollTo(0, 0));
    await youtube.screenshot({ path: testInfo.outputPath(`palette-${name}.png`), animations: 'disabled' });
  }
  for (const dark of [false, true]) {
    await youtube.locator('html').evaluate((el, value) => el.toggleAttribute('dark', value), dark);
    for (const hue of [0, 120, 240, 360])
      for (const saturation of [0, 100])
        for (const brightness of [0, 100]) {
          await save(popup, {
            'webWorldThemes.palette.hue': hue,
            'webWorldThemes.palette.saturation': saturation,
            'webWorldThemes.palette.brightness': brightness,
          });
          await expect(popup.locator('#palette-brightness')).toHaveValue(String(brightness));
          await youtube.locator('#fixture-current-title').scrollIntoViewIfNeeded();
          for (const selector of ['#fixture-current-title', 'ytd-comments #content-text span']) {
            await youtube.locator(selector).first().scrollIntoViewIfNeeded();
            expect(
              (await contrastAt(youtube, selector)).ratio,
              `${dark}/${hue}/${saturation}/${brightness}/${selector}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
  }
  await popup.getByRole('button', { name: 'Mint', exact: true }).click();
  await feature(popup, 'palette', false);
  await expect
    .poll(() => youtube.locator('html').evaluate((el) => el.style.getPropertyValue('--ww-retro-page')))
    .toBe('');
  await popup.reload();
  await expect(popup.locator('#palette-hue')).toHaveValue(String(PALETTE_PRESETS.mint.hue));
  await expect(popup.locator('#feature-palette')).not.toBeChecked();
  await feature(popup, 'palette', true);
  await expect
    .poll(() => youtube.locator('html').evaluate((el) => el.style.getPropertyValue('--ww-retro-page')))
    .not.toBe('');
});

test('background transparency preserves third-party background images and readable paper', async ({
  popup,
  youtube,
}) => {
  await installNativeYouTube(youtube, false);
  await youtube.locator('html').evaluate((el) => {
    el.style.backgroundImage = 'linear-gradient(90deg, rgb(1, 20, 50), rgb(60, 30, 90))';
  });
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await feature(popup, 'transparent-background', true);
  await expect(youtube.locator('body')).toHaveCSS('background-color', /(?:0\)|\/ 0\))/);
  await expect(youtube.locator('html')).toHaveCSS('background-image', /linear-gradient/);
  const paper = await youtube.locator('ytd-watch-metadata').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(paper).not.toBe('rgba(0, 0, 0, 0)');
  await youtube.locator('html').evaluate((el) => el.style.setProperty('--ww-background-surface-opacity', '.5'));
  await expect(youtube.locator('body')).toHaveCSS('background-color', /0\.5\)/);
  await feature(popup, 'transparent-background', false);
  await expect(youtube.locator('body')).not.toHaveCSS('background-color', /0\.5\)/);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(youtube.locator('html')).toHaveCSS('background-image', /linear-gradient/);
  await expect(youtube.locator('html')).toHaveAttribute('style', /--ww-background-surface-opacity: 0?.5/);
});

test('every new preference cleans up repeatedly at OFF and zero without changing media pixels', async ({
  popup,
  youtube,
}) => {
  test.setTimeout(90_000);
  await installNativeYouTube(youtube, true);
  await youtube.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  const source = await youtube.locator('video').evaluateHandle((video) => video);
  const sample = async () => {
    await youtube.locator('video').scrollIntoViewIfNeeded();
    const rect = (await youtube.locator('video').boundingBox())!;
    const points = [0.3, 0.5, 0.7].map((x) => ({
      x: Math.round(rect.x + rect.width * x),
      y: Math.round(rect.y + rect.height * 0.4),
    }));
    return pixels(youtube, await youtube.screenshot({ animations: 'disabled', scale: 'css' }), points);
  };
  const before = await sample();
  const ids = [
    'palette',
    'glossy-titlebars',
    'focus-titlebars',
    'daily-details',
    'surface-noise',
    'bbs-comments',
    'transparent-background',
    'lcd-durations',
    'readable-votes',
  ];
  for (let cycle = 0; cycle < 2; cycle++) {
    await save(popup, {
      'webWorldThemes.enabled': true,
      'webWorldThemes.strength': 100,
      'webWorldThemes.noiseStrength': 100,
    });
    for (const id of ids) {
      await feature(popup, id, true);
      await expect(youtube.locator('html')).toHaveAttribute(`data-ww-feature-${id}`, '');
      await feature(popup, id, false);
      await expect(youtube.locator('html')).not.toHaveAttribute(`data-ww-feature-${id}`, '');
      await feature(popup, id, true);
    }
    await feature(popup, 'transparent-background', false);
    await expect(youtube.locator('body')).toHaveCSS('background-image', /radial-gradient/);
    expect(await sample()).toEqual(before);
    await save(popup, { 'webWorldThemes.noiseStrength': 0 });
    await expect
      .poll(() => youtube.locator('html').evaluate((el) => el.style.getPropertyValue('--ww-noise-strength')))
      .toBe('0');
    expect(await sample()).toEqual(before);
    expect(await source.evaluate((video) => video === document.querySelector('video'))).toBe(true);
    await expect(youtube.locator('video')).toHaveCSS('filter', 'none');
    await expect(youtube.locator('video')).toHaveCSS('opacity', '1');
    await save(popup, { 'webWorldThemes.strength': 0 });
    await expect(youtube.locator('#web-world-themes-style')).toHaveCount(0);
    expect(
      await youtube
        .locator('html')
        .evaluate((el) => el.getAttributeNames().filter((name) => name.startsWith('data-ww-feature'))),
    ).toEqual([]);
    expect(
      await youtube.locator('html').evaluate((el) => Array.from(el.style).filter((name) => name.startsWith('--ww-'))),
    ).toEqual([]);
    await save(popup, { 'webWorldThemes.strength': 60, 'webWorldThemes.enabled': false });
    await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
  }
  await source.dispose();
});
