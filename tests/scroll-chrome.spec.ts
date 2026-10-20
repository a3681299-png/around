import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function enable(popup: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
}

/** Native public YouTube CSS inspected 2026-10-05: the Home chip wrapper is
 * fixed while scrolling, but [not-sticky] switches it to relative/top:0.
 * The previous fixture had only a plain .chip-row and missed that boundary. */
async function installNativeChips(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'fixture-native-chips';
    style.textContent = `
      ytd-page-manager { padding-top: 0; }
      ytd-page-manager > h1 { display: none; }
      ytd-feed-filter-chip-bar-renderer { display:block; height:56px; }
      #chips-wrapper.ytd-feed-filter-chip-bar-renderer {
        position:fixed; top:var(--ytd-rich-grid-chips-bar-top,56px);
        z-index:2000; height:56px; display:flex; align-items:center;
        width:calc(100% - 224px); margin-bottom:0;
        background:var(--yt-spec-base-background);
      }
      ytd-feed-filter-chip-bar-renderer[not-sticky] #chips-wrapper.ytd-feed-filter-chip-bar-renderer {
        position:relative; top:0; width:100%;
      }
      #fixture-chip-scroll-tail { height:1800px; }
    `;
    document.head.append(style);
    const install = () => {
      const row = document.querySelector('.chip-row');
      if (!row || row.parentElement?.matches('ytd-feed-filter-chip-bar-renderer')) return;
      const host = document.createElement('ytd-feed-filter-chip-bar-renderer');
      row.before(host);
      host.append(row);
      row.id = 'chips-wrapper';
      row.classList.add('ytd-feed-filter-chip-bar-renderer');
      host.toggleAttribute('not-sticky', scrollY === 0);
      const tail = document.createElement('div');
      tail.id = 'fixture-chip-scroll-tail';
      document.querySelector('ytd-page-manager')!.append(tail);
    };
    install();
    document.addEventListener('yt-navigate-finish', install);
    addEventListener(
      'scroll',
      () => {
        document.querySelector('ytd-feed-filter-chip-bar-renderer')?.toggleAttribute('not-sticky', scrollY === 0);
      },
      { passive: true },
    );
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
}

async function assertChipPosition(page: Page, top: boolean) {
  if (top) await expect(page.locator('ytd-feed-filter-chip-bar-renderer')).toHaveAttribute('not-sticky', '');
  else await expect(page.locator('ytd-feed-filter-chip-bar-renderer')).not.toHaveAttribute('not-sticky');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const masthead = document.querySelector('ytd-masthead')!.getBoundingClientRect();
        const chips = document.querySelector('#chips-wrapper')!.getBoundingClientRect();
        const hit = document.elementFromPoint(chips.left + 15, chips.top + chips.height / 2);
        return Math.abs(chips.top - masthead.bottom) < 1 && Boolean(hit?.closest('#chips-wrapper'));
      }),
    )
    .toBe(true);
}

for (const dark of [false, true]) {
  test(`Home native ${dark ? 'dark' : 'light'} chips remain directly below the header at top/down/up and SPA back`, async ({
    youtube,
    popup,
  }, testInfo) => {
    await youtube.setViewportSize({ width: 1917, height: 917 });
    await youtube.evaluate((dark) => document.documentElement.toggleAttribute('dark', dark), dark);
    await installNativeChips(youtube);
    await enable(popup);
    for (const width of [1917, 900, 1917]) {
      await youtube.setViewportSize({ width, height: 917 });
      for (const y of [0, 1, 250, 800, 250, 1, 0]) {
        await youtube.evaluate((y) => scrollTo(0, y), y);
        await assertChipPosition(youtube, y === 0);
      }
    }
    await youtube.screenshot({ path: testInfo.outputPath('home-chips-returned-top.png') });
    await youtube.locator('ytd-rich-grid-media a[data-fixture-nav]').first().click();
    await expect(youtube.locator('#web-world-themes-player-titlebar')).toBeVisible();
    await youtube.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() => youtube.locator('video').evaluate((element) => (element as HTMLVideoElement).paused))
      .toBe(false);
    await youtube.goBack();
    await youtube.evaluate(() => scrollTo(0, 0));
    await assertChipPosition(youtube, true);
    await expect(youtube.locator('#web-world-themes-window-chrome')).toHaveCount(1);
    await expect(youtube.locator('#web-world-themes-player-titlebar')).toHaveCount(0);
    await popup.getByRole('switch', { name: 'Window chrome' }).uncheck();
    await assertChipPosition(youtube, true);
    await youtube.evaluate(() => scrollTo(0, 250));
    await assertChipPosition(youtube, false);
    await popup.getByRole('switch', { name: 'Window chrome' }).check();
    await assertChipPosition(youtube, false);
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await assertChipPosition(youtube, false);
    await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
    await assertChipPosition(youtube, false);
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    await assertChipPosition(youtube, false);
    await youtube.evaluate(() => scrollTo(0, 0));
    await assertChipPosition(youtube, true);
    await expect(youtube.locator('#web-world-themes-style')).toHaveCount(0);
  });
}

for (const dark of [false, true]) {
  test(`watch native ${dark ? 'dark' : 'light'} autohide and frosted states preserve themed header controls`, async ({
    youtube,
    popup,
  }, testInfo) => {
    await youtube.goto('https://www.youtube.com/watch?v=fixture');
    await youtube.setViewportSize({ width: 1917, height: 917 });
    await youtube.evaluate((dark) => {
      document.documentElement.toggleAttribute('dark', dark);
      const app = document.querySelector('ytd-app')!;
      const masthead = document.querySelector('ytd-masthead')!;
      const wrapper = document.createElement('div');
      wrapper.id = 'masthead-container';
      masthead.before(wrapper);
      wrapper.append(masthead);
      const backdrop = document.createElement('div');
      backdrop.id = 'background';
      masthead.append(backdrop);
      const frost = document.createElement('div');
      frost.id = 'frosted-glass';
      app.prepend(frost);
      const style = document.createElement('style');
      style.textContent = `
        #masthead-container { position:fixed;top:0;left:0;right:0;z-index:2020; }
        #masthead-container ytd-masthead { position:static; }
        ytd-app[masthead-hidden] #masthead-container:not(:focus-within) {
          transform:translateY(calc(-100% - 5px)); opacity:0;
        }
        ytd-masthead > #background { position:absolute;top:0;width:100%;height:56px;z-index:-1;background:#fff; }
        ytd-masthead[frosted-glass-mode="without-chipbar"] > #background { backdrop-filter:blur(48px);background:rgba(255,255,255,.8); }
        ytd-masthead[frosted-glass-mode="with-chipbar"] > #background { display:none; }
        #frosted-glass { position:fixed;top:0;width:100%;height:112px;z-index:2018;backdrop-filter:blur(48px);background:rgba(255,255,255,.8); }
        ytd-page-manager { min-height:2200px; }
      `;
      document.head.append(style);
      addEventListener('scroll', () => app.toggleAttribute('masthead-hidden', scrollY > 0), { passive: true });
      document.dispatchEvent(new Event('yt-page-data-updated'));
    }, dark);
    await enable(popup);
    await youtube.getByRole('button', { name: 'Play', exact: true }).click();
    for (const mode of ['none', 'without-chipbar', 'with-chipbar']) {
      await youtube
        .locator('ytd-masthead')
        .evaluate((element, mode) => element.setAttribute('frosted-glass-mode', mode), mode);
      for (const y of [0, 1, 40, 454, 900, 40, 0]) {
        await youtube.evaluate((y) => scrollTo(0, y), y);
        await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '1');
        await expect(youtube.locator('#masthead-container')).toHaveCSS('transform', 'none');
        await expect(youtube.locator('ytd-masthead > #background')).toHaveCSS('display', 'none');
        await expect(youtube.locator('ytd-app > #frosted-glass')).toHaveCSS('display', 'none');
        await expect
          .poll(() =>
            youtube.evaluate(() =>
              ['input[name="search_query"]', '[aria-label="Guide"]', '.search-submit'].every((selector) => {
                const element = document.querySelector(selector)!;
                for (let node: Element | null = element; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (Number(style.opacity) < 0.99 || style.visibility !== 'visible' || style.display === 'none')
                    return false;
                }
                const rect = element.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return Boolean(hit && (element.contains(hit) || hit.contains(element)));
              }),
            ),
          )
          .toBe(true);
        await expect(youtube.locator('yt-searchbox .ytSearchboxComponentInputBox')).toHaveCSS('box-shadow', /inset/);
        await expect
          .poll(() => youtube.locator('video').evaluate((element) => (element as HTMLVideoElement).paused))
          .toBe(false);
      }
    }
    await youtube.evaluate(() => scrollTo(0, 40));
    await youtube.screenshot({ path: testInfo.outputPath('watch-scroll-header-visible.png') });
    await youtube.getByRole('textbox', { name: 'Search', exact: true }).fill('scroll test');
    await expect(youtube.getByRole('textbox', { name: 'Search', exact: true })).toHaveValue('scroll test');
    for (const width of [900, 1917]) {
      await youtube.setViewportSize({ width, height: 700 });
      await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '1');
      await expect(youtube.getByRole('textbox', { name: 'Search', exact: true })).toBeVisible();
    }
    await youtube.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 0);
    });
    await youtube.bringToFront();
    await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
    await expect(youtube.locator('html')).toHaveAttribute('data-ww-fullscreen', '');
    await expect(youtube.locator('ytd-masthead')).not.toBeVisible();
    await youtube.evaluate(() => document.exitFullscreen());
    await expect(youtube.locator('ytd-masthead')).toBeVisible();
    await youtube.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 250);
    });
    await popup.getByRole('switch', { name: 'Window chrome' }).uncheck();
    await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '0');
    await expect(youtube.locator('ytd-app > #frosted-glass')).toHaveCSS('display', 'block');
    await popup.getByRole('switch', { name: 'Window chrome' }).check();
    await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '1');
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '0');
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
    await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '1');
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '0');
    await youtube.evaluate(() => scrollTo(0, 0));
    await expect(youtube.locator('#masthead-container')).toHaveCSS('opacity', '1');
  });
}
