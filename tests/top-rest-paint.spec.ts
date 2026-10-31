import { test, expect } from './fixtures';
import { installNativeYouTube, pixels, luminance } from './helpers/native-youtube';
import type { Page } from '@playwright/test';

/** Expanded, relevant public rules from Ambient light for YouTube, pinned at
 * 18d17188e5562e5ee913f005192d30c9a60be078/src/styles/content.scss:681-688,
 * 711-722, 910-919, 1022-1045. This is a source-derived compatibility fixture,
 * not proof that the reporting user's browser has that extension installed. */
async function installTopRestPaint(page: Page) {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ambientlight-enabled', '');
    const masthead = document.querySelector('ytd-masthead')!;
    const wrapper = document.createElement('div');
    wrapper.id = 'masthead-container';
    masthead.before(wrapper);
    wrapper.append(masthead);
    const guide = masthead.querySelector('.header-icon')!;
    const guideHost = document.createElement('div');
    guideHost.id = 'guide-button';
    guide.before(guideHost);
    guideHost.append(guide);
    const input = masthead.querySelector<HTMLInputElement>('yt-searchbox input')!;
    input.classList.add('ytSearchboxComponentInput');
    input.placeholder = 'Search';
    const searchButton = document.createElement('button');
    searchButton.className = 'ytSearchboxComponentSearchButton';
    searchButton.setAttribute('aria-label', 'Native search icon');
    searchButton.innerHTML =
      '<yt-icon id="fixture-search-icon"><svg viewBox="0 0 24 24"><path d="M3 5h18v2H3z"/></svg></yt-icon>';
    const clearButton = searchButton.cloneNode(true) as HTMLElement;
    clearButton.className = 'ytSearchboxComponentClearButton';
    clearButton.setAttribute('aria-label', 'Native clear icon');
    clearButton.querySelector('yt-icon')!.id = 'fixture-clear-icon';
    input.closest('yt-searchbox')!.append(searchButton, clearButton);
    const style = document.createElement('style');
    style.id = 'fixture-top-rest-paint';
    style.textContent = `
      #masthead-container { position:fixed;top:0;left:0;right:0;z-index:2020; }
      #masthead-container ytd-masthead { position:static; }
      ytd-page-manager { min-height:2400px; }
      yt-searchbox { display:flex; }
      yt-searchbox .ytSearchboxComponentInputBox { flex:1; }
      html[data-ambientlight-enabled][dark] #masthead-container.at-top yt-searchbox:not(:hover):not(:focus-within) .ytSearchboxComponentSearchButton yt-icon,
      html[data-ambientlight-enabled][dark] #masthead-container.at-top yt-searchbox:not(:hover):not(:focus-within) .ytSearchboxComponentClearButton yt-icon { color:rgba(255,255,255,.4) !important; }
      html[data-ambientlight-enabled] yt-searchbox .ytSearchboxComponentInputBox { box-shadow:none !important; }
      html[data-ambientlight-enabled] #masthead-container.at-top #guide-button:not(:hover) button:not(:focus) yt-icon { color:rgba(0,0,0,.4) !important;fill:currentColor !important;transition:color .15s; }
      html[data-ambientlight-enabled]:not([dark]) #masthead-container.at-top #guide-button:not(:hover) button:not(:focus) yt-icon { color:rgb(0,0,0) !important; }
      html[data-ambientlight-enabled][dark] #masthead-container.at-top #guide-button:not(:hover) button:not(:focus) yt-icon { color:rgba(255,255,255,.4) !important; }
      html[data-ambientlight-enabled] #masthead-container yt-searchbox:not([has-focus]):not(:focus-within):not(:hover) .ytSearchboxComponentInputBox { background:none !important; }
      html[data-ambientlight-enabled][dark] #masthead-container.at-top yt-searchbox:not(:hover):not(:focus-within) .ytSearchboxComponentInputBox { box-shadow:none !important;background-color:transparent !important;border-color:rgba(255,255,255,.1) !important; }
      html[data-ambientlight-enabled][dark] #masthead-container.at-top yt-searchbox:not(:hover):not(:focus-within) .ytSearchboxComponentInput::-webkit-input-placeholder { color:rgba(255,255,255,.4) !important; }
      html[data-ambientlight-enabled]:not([dark]) #masthead-container.at-top yt-searchbox:not(:hover):not(:focus-within) .ytSearchboxComponentInputBox { background-color:transparent !important;border-color:rgba(0,0,0,.1) !important; }
      html[data-ambientlight-enabled]:not([dark]) #masthead-container.at-top yt-searchbox:not(:hover):not(:focus-within) .ytSearchboxComponentInput::-webkit-input-placeholder { color:rgba(0,0,0,.4) !important; }
    `;
    document.head.append(style);
    let timer: ReturnType<typeof setTimeout>;
    const settled = () => {
      clearTimeout(timer);
      timer = setTimeout(() => wrapper.classList.toggle('at-top', scrollY === 0), 200);
    };
    addEventListener('scroll', settled, { passive: true });
    document.addEventListener('yt-navigate-finish', settled);
    settled();
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
}

async function rest(page: Page, y: number) {
  await page.bringToFront();
  await page.mouse.move(1800, 800);
  await page.evaluate((y) => {
    (document.activeElement as HTMLElement)?.blur();
    scrollTo(0, y);
  }, y);
  await page.waitForTimeout(700); // Beyond delayed observer and 150ms color transition.
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
  if (y === 0) await expect(page.locator('#masthead-container')).toHaveClass('at-top');
  else await expect(page.locator('#masthead-container')).not.toHaveClass('at-top');
}

async function readable(page: Page) {
  await expect(page.locator('yt-searchbox .ytSearchboxComponentInputBox')).toHaveCSS('box-shadow', /inset/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector('#guide-icon')!).color ===
          getComputedStyle(document.querySelector('ytd-masthead')!).color,
      ),
    )
    .toBe(true);
  const paint = await page.evaluate(() => {
    const input = document.querySelector('yt-searchbox input')!;
    const guide = document.querySelector('#guide-icon')!;
    const ink = getComputedStyle(document.querySelector('ytd-masthead')!).color;
    return { guide: getComputedStyle(guide).color, ink, placeholder: getComputedStyle(input, '::placeholder').color };
  });
  expect(paint.guide).toBe(paint.ink);
  await expect(page.locator('#fixture-search-icon')).toHaveCSS('color', paint.ink);
  await expect(page.locator('#fixture-clear-icon')).toHaveCSS('color', paint.ink);
  expect(paint.placeholder).not.toMatch(/^rgba\(/);
  // Sample a solid interior point of the actual hamburger path, not only its
  // computed style: a composited pale glyph would otherwise pass visibility.
  const box = await page.locator('#guide-icon svg').boundingBox();
  const rgb = (
    await pixels(page, await page.screenshot({ scale: 'css' }), [
      { x: Math.floor(box!.x + 12), y: Math.floor(box!.y + 6) },
    ])
  )[0]!;
  expect(luminance(rgb)).toBeLessThan(0.25);
}

for (const dark of [true, false]) {
  test(`settled top-rest ${dark ? 'dark' : 'light'} transparent-header paint keeps search and guide legible`, async ({
    youtube,
    popup,
  }, testInfo) => {
    test.setTimeout(60_000);
    await youtube.setViewportSize({ width: 1917, height: 917 });
    await installNativeYouTube(youtube, dark);
    await installTopRestPaint(youtube);
    await popup.getByRole('switch', { name: 'テーマを使う' }).check();
    await popup.getByRole('slider', { name: 'エフェクトの強さ' }).press('End');
    await rest(youtube, 0);
    if (dark) {
      // Negative control: remove only the five new adapter paint rules, leaving
      // the entire previous theme/geometry and the source-derived CSS intact.
      const removed = await youtube.evaluate(() => {
        const sheet = (document.querySelector('#web-world-themes-style') as HTMLStyleElement).sheet!;
        const removed: string[] = [];
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
          const rule = sheet.cssRules[i] as CSSStyleRule;
          if (rule.selectorText?.includes('#masthead-container') && rule.selectorText.includes('data-ww-site')) {
            removed.unshift(rule.cssText);
            sheet.deleteRule(i);
          }
        }
        return removed;
      });
      expect(removed).toHaveLength(5);
      await youtube.waitForTimeout(300);
      await expect(youtube.locator('yt-searchbox .ytSearchboxComponentInputBox')).toHaveCSS('box-shadow', 'none');
      await expect(youtube.locator('#guide-icon')).toHaveCSS('color', 'rgba(255, 255, 255, 0.4)');
      await youtube.screenshot({ path: testInfo.outputPath('source-derived-before-top-rest.png') });
      await youtube.evaluate((rules) => {
        const sheet = (document.querySelector('#web-world-themes-style') as HTMLStyleElement).sheet!;
        for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
      }, removed);
    }
    for (const y of [0, 1, 40, 454, 40, 1, 0, 1, 0]) {
      await rest(youtube, y);
      await readable(youtube);
    }
    await youtube.screenshot({ path: testInfo.outputPath('source-derived-after-top-rest.png') });
    await youtube.getByRole('textbox', { name: 'Search', exact: true }).fill('top rest');
    await readable(youtube);
    await youtube.getByRole('textbox', { name: 'Search', exact: true }).fill('');
    await rest(youtube, 0);
    await readable(youtube);
    await popup.getByRole('switch', { name: '窓の飾り' }).uncheck();
    await rest(youtube, 0);
    await readable(youtube);
    await popup.getByRole('switch', { name: '窓の飾り' }).check();
    await popup.getByRole('slider', { name: 'エフェクトの強さ' }).press('Home');
    await expect(youtube.locator('#web-world-themes-style')).toHaveCount(0);
    if (dark) await expect(youtube.locator('#guide-icon')).toHaveCSS('color', 'rgba(255, 255, 255, 0.4)');
    await popup.getByRole('slider', { name: 'エフェクトの強さ' }).press('End');
    await rest(youtube, 0);
    await readable(youtube);
    await youtube.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
    await rest(youtube, 0);
    await readable(youtube);
    await popup.getByRole('switch', { name: 'テーマを使う' }).uncheck();
    await expect(youtube.locator('#web-world-themes-style')).toHaveCount(0);
    await expect(youtube.locator('html')).toHaveAttribute('data-ambientlight-enabled', '');
    await expect(youtube.locator('#fixture-top-rest-paint')).toHaveCount(1);
  });
}
