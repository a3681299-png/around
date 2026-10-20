import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`optional public YouTube ${colorScheme} watch inspection with unmodified network documents`, async ({}, testInfo) => {
    test.skip(
      process.env.WW_LIVE_YOUTUBE !== '1',
      'Opt-in public-network smoke check; fixture checks remain deterministic.',
    );
    test.setTimeout(180_000);
    await mkdir('.work', { recursive: true });
    const context = await launchExtension(await mkdtemp(path.resolve('.work/live-')), false);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme });
    const capture = async (name: string) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
    };
    try {
      const manager = await context.newPage();
      await manager.goto('chrome://extensions/');
      const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
      await item.waitFor();
      const id = await item.evaluate(
        (element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id,
      );
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      await manager.close();
      await page.setViewportSize({ width: 1917, height: 917 });
      // Public video from the reported screenshot. No cookies, account, CAPTCHA,
      // markup substitution, hidden API, or application-state injection is used.
      await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI&list=RDAS4q9yaWJkI&start_radio=1', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 45_000 });
      if (colorScheme === 'dark') {
        // YouTube may ignore the OS preference until Appearance is explicitly set.
        // Change only this disposable signed-out browser through the visible UI.
        await page
          .locator('ytd-masthead')
          .getByRole('button', { name: /^(Settings|設定)$/ })
          .click();
        await page.getByRole('link', { name: /^(Appearance:|デザイン:)/ }).click();
        await page.getByRole('link', { name: /^(Dark theme|ダークモード)$/ }).click();
        await expect.poll(() => page.locator('html').evaluate((element) => element.hasAttribute('dark'))).toBe(true);
      }
      // Appearance can reload the page; await the rebuilt native header/content.
      await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('ytd-masthead #logo-icon svg').first()).toBeVisible({ timeout: 30_000 });
      await capture('live-native-watch');
      await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
      await expect(page.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
      await expect(page.locator('#web-world-themes-player-titlebar')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect
        .poll(() =>
          page.locator('#web-world-themes-player-titlebar').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(hit && element.contains(hit));
          }),
        )
        .toBe(true);
      await expect(page.locator('ytd-masthead [id^="youtube-paths"]:visible').first()).toBeVisible();
      await capture('live-silver-watch');
      // Recheck the native header at the first scroll pixel as well as deep scroll:
      // Home and watch have different sticky/autohide transition boundaries.
      const settleScroll = async (y: number) => {
        await page.bringToFront();
        // Native SPA scroll anchoring may move the page after scrollTo(0, 0).
        // Verify the measured offset after settlement, rather than just recording
        // the requested one. Reapply only if late layout displaced it.
        await expect
          .poll(
            async () => {
              await page.evaluate((y) => scrollTo(0, y), y);
              await page.waitForTimeout(1600);
              return page.evaluate(() => scrollY);
            },
            { timeout: 15_000 },
          )
          .toBe(y);
      };
      const headerStates = [];
      const inspectPaint = async (name: string) => {
        const paint = await page.evaluate(() => {
          const selectors = [
            'ytd-masthead',
            'ytd-masthead #container',
            'ytd-masthead #guide-button',
            'ytd-masthead #guide-icon',
            'ytd-masthead #guide-icon svg',
            'ytd-masthead #guide-icon path',
            'yt-searchbox',
            'yt-searchbox .ytSearchboxComponentInputBox',
            'yt-searchbox input[name="search_query"]',
          ];
          const elements = selectors.flatMap((selector) =>
            [...document.querySelectorAll(selector)].map((element) => {
              const chain = [];
              for (let node: Element | null = element; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                chain.push({
                  tag: node.tagName,
                  id: node.id,
                  classes: node.className,
                  attributes: [...node.attributes].map((a) => [a.name, a.value]),
                  color: style.color,
                  fill: style.fill,
                  opacity: style.opacity,
                  background: style.background,
                  boxShadow: style.boxShadow,
                  border: style.border,
                  mixBlendMode: style.mixBlendMode,
                  filter: style.filter,
                  backdropFilter: style.backdropFilter,
                  isolation: style.isolation,
                  position: style.position,
                  zIndex: style.zIndex,
                });
              }
              return { selector, chain, placeholder: getComputedStyle(element, '::placeholder').color };
            }),
          );
          const rules: string[] = [];
          const scan = (list: CSSRuleList) => {
            for (const rule of [...list]) {
              if ('cssRules' in rule) scan((rule as CSSGroupingRule).cssRules);
              else if (
                /masthead|guide-icon|ytSearchbox/.test(rule.cssText) &&
                /blend|filter|opacity|fill:|transparent|scroll/.test(rule.cssText)
              )
                rules.push(rule.cssText);
            }
          };
          for (const sheet of [...document.styleSheets]) {
            try {
              scan(sheet.cssRules);
            } catch {
              /* cross-origin CSS is not accessible */
            }
          }
          return { scrollY, elements, rules };
        });
        await writeFile(testInfo.outputPath(`${name}.json`), JSON.stringify(paint, null, 2));
        await capture(name);
      };
      await settleScroll(0);
      await inspectPaint('live-top-rest-initial');
      for (const scrollY of [0, 1, 40, 454, 40, 1, 0]) {
        await settleScroll(scrollY);
        let controlState: unknown;
        try {
          await expect
            .poll(async () => {
              controlState = await page.evaluate(() => {
                return ['ytd-masthead yt-searchbox input[name="search_query"]', 'ytd-masthead #guide-icon'].map(
                  (selector) => {
                    const candidates = [...document.querySelectorAll(selector)];
                    const element = candidates.find((node) => {
                      const box = node.getBoundingClientRect();
                      return box.width > 0 && box.height > 0;
                    });
                    if (!element) return { selector, problem: 'No displayed control', candidates: candidates.length };
                    const ancestors = [];
                    for (let node: Element | null = element; node; node = node.parentElement) {
                      const style = getComputedStyle(node);
                      if (Number(style.opacity) < 0.99 || style.visibility !== 'visible' || style.display === 'none') {
                        ancestors.push({
                          tag: node.tagName,
                          id: node.id,
                          opacity: style.opacity,
                          visibility: style.visibility,
                          display: style.display,
                        });
                      }
                    }
                    const rect = element.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    const reachable = Boolean(hit && (element.contains(hit) || hit.contains(element)));
                    return {
                      selector,
                      visible: ancestors.length === 0 && reachable,
                      ancestors,
                      hit: hit?.tagName + '#' + hit?.id,
                      x: rect.x,
                      y: rect.y,
                      width: rect.width,
                      height: rect.height,
                    };
                  },
                );
              });
              return (controlState as Array<{ visible?: boolean }>).every((state) => state.visible);
            })
            .toBe(true);
        } finally {
          await writeFile(
            testInfo.outputPath(`live-header-controls-${scrollY}.json`),
            JSON.stringify(controlState, null, 2),
          );
        }
        await expect(page.locator('yt-searchbox .ytSearchboxComponentInputBox').first()).toHaveCSS(
          'box-shadow',
          /inset/,
        );
        headerStates.push(
          await page.evaluate(() => ({
            scrollY: window.scrollY,
            hidden: document.querySelector('ytd-app')?.hasAttribute('masthead-hidden'),
            frosted: document.querySelector('ytd-masthead')?.getAttribute('frosted-glass-mode'),
            controls: [
              'ytd-masthead yt-searchbox input[name="search_query"]',
              'ytd-masthead #guide-icon',
              'ytd-masthead yt-searchbox .ytSearchboxComponentInputBox',
            ].map((selector) => {
              const element = document.querySelector(selector)!;
              const style = getComputedStyle(element),
                box = element.getBoundingClientRect();
              return {
                selector,
                color: style.color,
                opacity: style.opacity,
                top: box.top,
                height: box.height,
                shadow: style.boxShadow,
              };
            }),
          })),
        );
        if (scrollY === 0 || scrollY === 1 || scrollY === 454) await inspectPaint(`live-header-scroll-${scrollY}`);
      }
      await writeFile(testInfo.outputPath('live-header-scroll-states.json'), JSON.stringify(headerStates, null, 2));
      await page.locator('ytd-watch-metadata h1').first().scrollIntoViewIfNeeded();
      await capture('live-silver-metadata');
      const playerGeometry = await page.evaluate(() => {
        const selectors = [
          '#web-world-themes-player-titlebar',
          '#player',
          '#player-container-outer',
          '#player-container-inner',
          '#player-container',
          'ytd-player',
          '#movie_player',
        ];
        return selectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, missing: true };
          const r = element.getBoundingClientRect(),
            s = getComputedStyle(element);
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(12, r.height / 2));
          return {
            selector,
            parent: element.parentElement?.tagName + '#' + element.parentElement?.id,
            position: s.position,
            top: s.top,
            transform: s.transform,
            zIndex: s.zIndex,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            hit: hit?.tagName + '#' + hit?.id,
          };
        });
      });
      await writeFile(testInfo.outputPath('live-player-geometry.json'), JSON.stringify(playerGeometry, null, 2));
      const backgrounds = await page
        .locator('ytd-watch-flexy, ytd-watch-metadata, ytd-comments')
        .evaluateAll((elements) =>
          elements.map((element) => ({
            tag: element.tagName,
            background: getComputedStyle(element).backgroundColor,
            color: getComputedStyle(element).color,
          })),
        );
      await writeFile(
        testInfo.outputPath('live-observations.json'),
        JSON.stringify(
          {
            url: page.url(),
            browserColorScheme: colorScheme,
            nativeDark: await page.locator('html').getAttribute('dark'),
            backgrounds,
          },
          null,
          2,
        ),
      );
      for (const surface of backgrounds) expect(surface.background).not.toBe('rgb(15, 15, 15)');
      const wordmark = page.locator('ytd-masthead [id^="youtube-paths"]').first();
      await expect(wordmark).toHaveAttribute('data-ww-surface', /wordmark/);
      expect(await wordmark.evaluate((element) => getComputedStyle(element).fill)).toBe(
        await page
          .locator('ytd-watch-metadata h1')
          .first()
          .evaluate((element) => getComputedStyle(element).color),
      );
      await page.evaluate(() => window.scrollTo(0, 454));
      await expect(page.locator('ytd-comments-header-renderer:visible').first()).toBeVisible({ timeout: 30_000 });
      await page
        .locator('ytd-comments [data-ww-bbs-number]')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {});
      await capture('live-silver-scroll-comments');
      const personalDetails = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('ytd-comments [data-ww-bbs-row]')];
        const durationHosts = [...document.querySelectorAll('yt-thumbnail-badge-view-model badge-shape')].map(
          (element) => ({
            text: element.querySelector('.ytBadgeShapeText')?.textContent?.trim(),
            marked: element.getAttribute('data-ww-surface')?.includes('duration') ?? false,
            color: getComputedStyle(element).color,
            font: getComputedStyle(element).fontFamily,
          }),
        );
        const votes = [...document.querySelectorAll('ytd-comments #vote-count-middle')].map((element) => ({
          text: element.textContent,
          color: getComputedStyle(element).color,
        }));
        const exactDates = [...document.querySelectorAll('[data-ww-bbs-date]')].map((element) => ({
          text: element.textContent,
          source: element.getAttribute('title'),
        }));
        return {
          loadedRows: rows.length,
          numbers: rows.map((row) => row.querySelector('[data-ww-bbs-number]')?.textContent),
          durationHosts,
          votes,
          exactDates,
        };
      });
      await writeFile(testInfo.outputPath('live-personalization.json'), JSON.stringify(personalDetails, null, 2));
      if (personalDetails.loadedRows > 0)
        expect(personalDetails.numbers).toEqual(
          Array.from({ length: personalDetails.loadedRows }, (_, index) => String(index + 1)),
        );
      for (const badge of personalDetails.durationHosts) {
        if (/^(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)$/.test(badge.text ?? '')) {
          expect(badge.marked).toBe(true);
          expect(badge.font).toContain('Web World Pixel');
        } else expect(badge.marked).toBe(false);
      }

      await page.evaluate(() => scrollTo(0, 0));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('ytd-masthead #voice-search-button svg').first()).toBeVisible({ timeout: 30_000 });
      await settleScroll(0);
      await inspectPaint('live-top-rest-reload');
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page.locator('yt-searchbox .ytSearchboxComponentInputBox').first()).toHaveCSS('box-shadow', /inset/);
      await page.locator('ytd-masthead a#logo').first().click();
      await expect(page).toHaveURL('https://www.youtube.com/');
      await page.goBack();
      await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('ytd-masthead #voice-search-button svg').first()).toBeVisible({ timeout: 30_000 });
      await settleScroll(0);
      await inspectPaint('live-top-rest-spa-back');
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page.locator('yt-searchbox .ytSearchboxComponentInputBox').first()).toHaveCSS('box-shadow', /inset/);
      await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
      await expect(page.locator('#web-world-themes-style')).toHaveCount(0);
      await expect(page.locator('[data-ww-surface]')).toHaveCount(0);
      await capture('live-restored-watch');
    } finally {
      await capture('live-last-state').catch(() => {});
      await context.close();
    }
  });
}
