import { test, expect } from './fixtures';
import { image, open, save, media, overlay } from './helpers/world-host';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import type { DesignDocument } from '../src/design/types';

test('scroll opacity reaches the DOM before the first RAF of the scroll frame is presented', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  await save(panel);
  const key = 'webWorldThemes.design.youtube',
    design = await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
  design.signalRules = [defaultScrollOpacityRule(design.decorations[0]!.id)];
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  await youtube.evaluate(() => {
    document.body.style.minHeight = '6000px';
  });
  await expect(youtube.locator(media)).toHaveCSS('opacity', '0');
  for (const progress of [0.25, 0.5, 0.75, 1, 0]) {
    const result = await youtube.evaluate(
      (progress) =>
        new Promise<{ actual: number; expected: number }>((resolve) => {
          document.addEventListener(
            'scroll',
            () => {
              // Registered after the production capture listeners: observe the end of
              // the first RAF batch, without waiting a second rendering opportunity.
              requestAnimationFrame(() => {
                const root = document.scrollingElement!,
                  p = root.scrollTop / (root.scrollHeight - root.clientHeight);
                const node = document
                  .querySelector('#web-world-themes-decorations')!
                  .shadowRoot!.querySelector<HTMLElement>('.media')!;
                resolve({ actual: Number(node.style.opacity), expected: 1 - Math.abs(p * 2 - 1) });
              });
            },
            { once: true },
          );
          const root = document.scrollingElement!;
          scrollTo(0, Math.round((root.scrollHeight - root.clientHeight) * progress));
        }),
      progress,
    );
    expect(result.actual).toBe(result.expected);
  }
});

test('saved page progress rules drive DOM opacity in both directions and restore after reload, height changes and OFF', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await image(panel, youtube);
  await save(panel);
  const key = 'webWorldThemes.design.youtube',
    design = await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
  design.decorations[0]!.opacity = 0;
  design.signalRules = [defaultScrollOpacityRule(design.decorations[0]!.id)];
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  const go = async (progress: number) => {
    await youtube.evaluate((value) => {
      const root = document.scrollingElement!;
      scrollTo(0, Math.round((root.scrollHeight - root.clientHeight) * value));
    }, progress);
    await expect
      .poll(() =>
        youtube.locator(media).evaluate((node: HTMLElement) => {
          const root = document.scrollingElement!,
            range = root.scrollHeight - root.clientHeight,
            value = range > 0 ? root.scrollTop / range : 0;
          return Math.abs(Number(node.style.opacity) - (1 - Math.abs(value * 2 - 1)));
        }),
      )
      .toBeLessThan(0.00001);
  };
  await go(0);
  await go(0.5);
  await go(1);
  await go(0.25);
  await go(0.5);
  await youtube.reload();
  await go(0.5);
  await youtube.evaluate(() => {
    document.body.style.minHeight = '6000px';
  });
  await go(0.25);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
});
