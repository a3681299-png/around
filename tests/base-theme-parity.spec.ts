import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { storeDesign } from './helpers/skin-verification';

/*
 * Most saved artwork names the retro theme as its base (baseThemeId 'retro'); recorded artwork and
 * newer artwork name none (null). The artwork itself — its compiled skin CSS, the parts it marks and
 * the parts the page exposes — is the same either way, so the retro theme can go without changing
 * what any saved artwork draws.
 */
const rules = [
  { kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#ddeeff', borderRadiusPx: 18 } },
  { kind: 'surface-style', target: 'search-box', style: { borderRadiusPx: 4 } },
];
const design = (baseThemeId: string | null) => ({
  schemaVersion: 13,
  id: 'base-theme-parity',
  siteId: 'youtube',
  baseThemeId,
  rules,
  decorations: [],
});

async function artwork(popup: Page, youtube: Page, baseThemeId: string | null) {
  await storeDesign(popup, design(baseThemeId));
  await youtube.reload();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-design', 'base-theme-parity');
  await expect(youtube.locator('#web-world-themes-design-style')).toHaveCount(1);
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  return youtube.evaluate(() => {
    const marks: Record<string, number> = {};
    // YouTube's own parts; the retro theme's added window (title and menu bars) is its own.
    for (const node of document.querySelectorAll('[data-ww-surface]'))
      if (!node.closest('[id^="web-world-themes"]'))
        for (const surface of node.getAttribute('data-ww-surface')!.split(' '))
          marks[surface] = (marks[surface] ?? 0) + 1;
    return {
      css: document.getElementById('web-world-themes-design-style')!.textContent,
      marks,
      card: getComputedStyle(document.querySelector('[data-ww-surface~="video-card"]')!).borderTopLeftRadius,
    };
  });
}

test('artwork based on the retro theme and artwork with no base compile, mark and dress the same', async ({
  popup,
  youtube,
}) => {
  const retro = await artwork(popup, youtube, 'retro');
  const independent = await artwork(popup, youtube, null);
  expect(retro.css).toContain('#ddeeff');
  expect(independent).toEqual(retro);
  expect(retro.card).toBe('18px');
  // Any other base is still refused: the page keeps no artwork from it.
  await storeDesign(popup, design('another-theme'));
  await youtube.reload();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  await expect(youtube.locator('#web-world-themes-design-style')).toHaveCount(0);
});
