import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { exposeEditorControls } from './helpers/editor-workspace';
import { pngPixels } from './helpers/png-pixels';

/**
 * G1, chunk 3: the player's control bands are protected only while its bars are shown
 * (docs/autonomy-plan.md 「塊3」). The fixture player mimics YouTube: the bars fade out while the
 * player carries ytp-autohide. Artwork may paint in the bands only then; the first frame the bars
 * appear already has the band clip, because the clip follows the class in the style system.
 */
const PLANE = '#web-world-themes-video-decorations';
const BOTTOM_BAND = 112,
  TOP_BAND = 64;

async function redArtworkInTheCorner(popup: Page, youtube: Page) {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  // YouTube's bars fade out while the player carries ytp-autohide.
  await youtube.addStyleTag({
    content: '#movie_player.ytp-autohide .ytp-chrome-bottom{opacity:0;transition:opacity .25s}',
  });
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const context = c.getContext('2d')!;
    // Magenta: no part of the fixture player has this colour (its progress bar is red).
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 0, 64, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await editor.getByLabel('配置の基準').selectOption('video-player');
  await editor.getByLabel('画像の幅').fill('160');
  await editor.getByLabel('画像の高さ').fill('180');
  // The bottom-right corner, over the fullscreen button: most of it is in the bottom band, its top
  // above it (that part is always drawn, so a count is never taken while drawing is held).
  await editor.getByLabel('画像のX位置').fill('90');
  await editor.getByLabel('画像のY位置').fill('80');
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(youtube);
  await expect(youtube.locator(`${PLANE} [data-image-id]`)).toBeAttached();
}

/** Magenta (artwork) pixels in the player's bottom band and just above it, from one screenshot. */
async function magenta(youtube: Page) {
  const player = (await youtube.locator('#movie_player').boundingBox())!;
  // One screenshot of the whole player, decoded here: a second capture or a decoding page could
  // change the page under test (a resize hold, a hidden tab) between what we see and count.
  const { width, height, rgba } = pngPixels(await youtube.screenshot({ clip: player }));
  let band = 0,
    above = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (!(rgba[at]! > 200 && rgba[at + 1]! < 60 && rgba[at + 2]! > 200)) continue;
      if (y >= height - BOTTOM_BAND) band++;
      else above++;
    }
  return { band, above };
}
/** The band's magenta once the artwork is drawn (its part above the band is on screen). */
async function redInBottomBand(youtube: Page) {
  let last = { band: 0, above: 0 };
  await expect
    .poll(async () => (last = await magenta(youtube)).above, { message: 'the artwork above the band is drawn' })
    .toBeGreaterThan(500);
  return last.band;
}

/**
 * Watches the player from inside the page: at the very moment the class goes (the mutation
 * callback runs before any rendering of that change) and on every frame after, the plane's
 * computed clip must cut both bands while the bars are shown. Returns the frames that did not.
 */
async function watchBars(youtube: Page) {
  await youtube.evaluate(
    ([plane, top, bottom]) => {
      const player = document.querySelector('#movie_player')!;
      const host = document.querySelector(plane as string) as HTMLElement;
      const w = window as unknown as { barProblems: string[]; barChecks: number; stopBars: () => void };
      w.barProblems = [];
      w.barChecks = 0;
      const check = (when: string) => {
        if (player.classList.contains('ytp-autohide')) return;
        w.barChecks++;
        const clip = getComputedStyle(host).clipPath;
        if (clip !== `inset(${top}px 0px ${bottom}px)`) w.barProblems.push(`${when}: ${clip}`);
      };
      const observer = new MutationObserver(() => check('class change'));
      observer.observe(player, { attributes: true, attributeFilter: ['class'] });
      let running = true;
      const frame = () => {
        if (!running) return;
        check('frame');
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      w.stopBars = () => {
        running = false;
        observer.disconnect();
      };
    },
    [PLANE, TOP_BAND, BOTTOM_BAND] as const,
  );
  return async () =>
    youtube.evaluate(() => {
      const w = window as unknown as { barProblems: string[]; barChecks: number; stopBars: () => void };
      w.stopBars();
      return { problems: w.barProblems, checks: w.barChecks };
    });
}
const hideBars = (youtube: Page, hidden: boolean) =>
  youtube.evaluate(
    (hidden) => document.querySelector('#movie_player')!.classList.toggle('ytp-autohide', hidden),
    hidden,
  );

/**
 * The bar's own glyphs (the fixture's buttons draw white text) in the bottom band, with the
 * artwork and with its plane made transparent: where a glyph is white without the artwork, it is
 * the same with it. Also how much of the band the artwork paints (under the bars, by stacking).
 */
async function barGlyphs(youtube: Page) {
  const player = (await youtube.locator('#movie_player').boundingBox())!;
  const clip = { x: player.x, y: player.y + player.height - BOTTOM_BAND, width: player.width, height: BOTTOM_BAND };
  const canvases = (opacity: string) =>
    youtube.evaluate(
      ([plane, value]) => {
        for (const c of (document.querySelector(plane!) as HTMLElement).shadowRoot!.querySelectorAll<HTMLElement>(
          '.image, canvas, img',
        ))
          c.style.opacity = value!;
      },
      [PLANE, opacity],
    );
  const withIt = pngPixels(await youtube.screenshot({ clip }));
  await canvases('0');
  const without = pngPixels(await youtube.screenshot({ clip }));
  await canvases('');
  let glyph = 0,
    covered = 0,
    artwork = 0;
  for (let i = 0; i < without.rgba.length; i += 4) {
    const a = withIt.rgba,
      b = without.rgba;
    if (a[i]! > 200 && a[i + 1]! < 60 && a[i + 2]! > 200) artwork++;
    // A glyph's own (opaque) pixels: pure white. Its anti-aliased rim is partly see-through and
    // shows whatever is behind the bar, the artwork included, so it is not counted.
    if (!(b[i]! >= 250 && b[i + 1]! >= 250 && b[i + 2]! >= 250)) continue;
    glyph++;
    if (Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c]! - b[i + c]!))) > 24) covered++;
  }
  return { glyph, covered, artwork };
}

/** Layering (docs/layering-plan.md): every frame from the class change on, the plane sits directly
 * after the media at its level; the frames where it did not. */
async function watchOrder(youtube: Page) {
  await youtube.evaluate((plane) => {
    const player = document.querySelector('#movie_player')!;
    const host = document.querySelector(plane) as HTMLElement;
    const w = window as unknown as { orderProblems: string[]; orderChecks: number; stopOrder: () => void };
    w.orderProblems = [];
    w.orderChecks = 0;
    const check = (when: string) => {
      w.orderChecks++;
      const media = host.previousElementSibling as HTMLElement | null;
      if (
        !media?.classList.contains('html5-video-container') ||
        getComputedStyle(host).zIndex !== getComputedStyle(media).zIndex
      )
        w.orderProblems.push(`${when}: after ${media?.className}, z ${getComputedStyle(host).zIndex}`);
    };
    const observer = new MutationObserver(() => check('class change'));
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    let running = true;
    const frame = () => {
      if (!running) return;
      check('frame');
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    w.stopOrder = () => {
      running = false;
      observer.disconnect();
    };
  }, PLANE);
  return async () =>
    youtube.evaluate(() => {
      const w = window as unknown as { orderProblems: string[]; orderChecks: number; stopOrder: () => void };
      w.stopOrder();
      return { problems: w.orderProblems, checks: w.orderChecks };
    });
}

test('G1 bands (layering): the bars are drawn over the artwork in the band, shown or hidden, and stay pressable', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  test.skip(!layeringOn, 'The cut-out way is checked by the tests below.');
  await redArtworkInTheCorner(popup, youtube);
  await youtube.evaluate(() => {
    const player = document.querySelector('#movie_player')!;
    const show = () => player.classList.remove('ytp-autohide');
    player.addEventListener('pointermove', show);
    document.addEventListener('keydown', show, true);
  });
  const player = (await youtube.locator('#movie_player').boundingBox())!;
  for (const action of [
    async () => youtube.mouse.move(player.x + player.width / 2, player.y + player.height / 2, { steps: 3 }),
    async () => youtube.keyboard.press('k'),
    async () => youtube.keyboard.press('Tab'),
  ]) {
    await youtube.mouse.move(2, 2);
    await hideBars(youtube, true);
    await expect.poll(() => redInBottomBand(youtube)).toBeGreaterThan(1000);
    const stop = await watchOrder(youtube);
    await action();
    await youtube.waitForTimeout(300);
    const watched = await stop();
    expect(watched.problems).toEqual([]);
    expect(watched.checks).toBeGreaterThan(3);
    // Bars shown: the artwork is still in the band (under the bars), and no glyph of theirs changed.
    const bars = await barGlyphs(youtube);
    expect(bars.artwork).toBeGreaterThan(1000);
    expect(bars.glyph).toBeGreaterThan(50);
    expect(bars.covered).toBe(0);
  }
  // The real button under the artwork takes the click.
  const button = youtube.getByRole('button', { name: 'Fullscreen', exact: true });
  const box = (await button.boundingBox())!;
  expect(
    await youtube.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('aria-label'), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }),
  ).toBe('Fullscreen');
});

test('G1 bands (layering): with the plane put over the bars, the same check fails (the check is real)', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  test.skip(!layeringOn, 'The cut-out way is checked by the tests below.');
  await redArtworkInTheCorner(popup, youtube);
  // Deliberately broken, in this page only: the plane above every part of the player.
  await youtube.evaluate((plane) => {
    const shadow = (document.querySelector(plane) as HTMLElement).shadowRoot!;
    const broken = document.createElement('style');
    broken.textContent = ':host{z-index:5000!important}';
    shadow.append(broken);
  }, PLANE);
  await expect.poll(() => redInBottomBand(youtube)).toBeGreaterThan(1000);
  // The fullscreen and settings glyphs under the artwork (a few dozen opaque pixels each).
  expect((await barGlyphs(youtube)).covered).toBeGreaterThan(5);
});

test('G1 bands: artwork may paint in the bands only while the bars are hidden', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  test.skip(layeringOn, 'Cut-out way only: layering paints under the bars (checked above).');
  await redArtworkInTheCorner(popup, youtube);
  // Bars shown (the fixture starts without ytp-autohide): the band is clipped.
  await expect.poll(() => redInBottomBand(youtube)).toBe(0);
  // Bars hidden: the character is in the corner, over the (hidden) fullscreen button.
  await hideBars(youtube, true);
  await expect.poll(() => redInBottomBand(youtube)).toBeGreaterThan(1000);
  // The bars appear: from the class change on, every frame cuts the bands.
  const stop = await watchBars(youtube);
  await hideBars(youtube, false);
  await youtube.waitForTimeout(300);
  const watched = await stop();
  expect(watched.problems).toEqual([]);
  expect(watched.checks).toBeGreaterThan(5);
  expect(await redInBottomBand(youtube)).toBe(0);
});

test('G1 bands: the bars brought back by a pointer move or a key are clipped from their first frame', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  test.skip(layeringOn, 'Cut-out way only: layering paints under the bars (checked above).');
  await redArtworkInTheCorner(popup, youtube);
  // Like YouTube: a pointer move over the player or a key (k, arrows, Tab) shows the bars.
  await youtube.evaluate(() => {
    const player = document.querySelector('#movie_player')!;
    const show = () => player.classList.remove('ytp-autohide');
    player.addEventListener('pointermove', show);
    document.addEventListener('keydown', show, true);
  });
  const player = (await youtube.locator('#movie_player').boundingBox())!;
  for (const action of [
    async () => youtube.mouse.move(player.x + player.width / 2, player.y + player.height / 2, { steps: 3 }),
    async () => youtube.keyboard.press('k'),
    async () => youtube.keyboard.press('ArrowRight'),
    async () => youtube.keyboard.press('Tab'),
  ]) {
    await youtube.mouse.move(2, 2);
    await hideBars(youtube, true);
    await expect.poll(() => redInBottomBand(youtube)).toBeGreaterThan(1000);
    const stop = await watchBars(youtube);
    await action();
    await youtube.waitForTimeout(200);
    const watched = await stop();
    expect(watched.problems).toEqual([]);
    expect(watched.checks).toBeGreaterThan(3);
    expect(await redInBottomBand(youtube)).toBe(0);
  }
});

/**
 * Chunk 3 verification (docs/chunk3-verification.md): during an advert YouTube can hide its bars
 * (ytp-autohide) while the advert's own parts stay in the bands. While the player shows an advert,
 * the bands stay clipped whatever the bars do, from the very style recalculation the advert starts.
 */
test('G1 bands: an advert keeps the bands clipped while the bars are hidden', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  test.skip(layeringOn, 'Cut-out way only: layering has no band clip; the advert parts are over it by stacking.');
  await redArtworkInTheCorner(popup, youtube);
  await hideBars(youtube, true);
  await expect.poll(() => redInBottomBand(youtube)).toBeGreaterThan(1000);
  // The advert starts with the bars hidden (as on YouTube, where ytp-autohide stays): the plane's
  // computed clip at that very moment, then the pixels.
  const clip = await youtube.evaluate((plane) => {
    document.querySelector('#movie_player')!.classList.add('ad-showing', 'ad-interrupting');
    return getComputedStyle(document.querySelector(plane) as HTMLElement).clipPath;
  }, PLANE);
  expect(clip).toBe(`inset(${TOP_BAND}px 0px ${BOTTOM_BAND}px)`);
  await expect.poll(() => redInBottomBand(youtube)).toBe(0);
  // The advert over: hidden bars open the bands again.
  await youtube.evaluate(() =>
    document.querySelector('#movie_player')!.classList.remove('ad-showing', 'ad-interrupting'),
  );
  await expect.poll(() => redInBottomBand(youtube)).toBeGreaterThan(1000);
});

test('G1 bands: without the "only while shown" rule the same check fails (the check is real)', async ({
  popup,
  youtube,
  layeringOn,
}) => {
  test.skip(layeringOn, 'Cut-out way only: layering has no band clip to break (its check is above).');
  await redArtworkInTheCorner(popup, youtube);
  // Deliberately broken, in this page only: the plane drops its band clip whatever the bars do.
  await youtube.evaluate((plane) => {
    const shadow = (document.querySelector(plane) as HTMLElement).shadowRoot!;
    const broken = document.createElement('style');
    broken.textContent = ':host{clip-path:none!important}';
    shadow.append(broken);
  }, PLANE);
  const stop = await watchBars(youtube);
  await hideBars(youtube, true);
  await youtube.waitForTimeout(100);
  await hideBars(youtube, false);
  await youtube.waitForTimeout(200);
  const watched = await stop();
  expect(watched.problems.length).toBeGreaterThan(0);
  expect(await redInBottomBand(youtube)).toBeGreaterThan(1000);
});
