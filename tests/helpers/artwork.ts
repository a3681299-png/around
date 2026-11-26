import { expect, type Page } from '@playwright/test';

/** Turns on 作品を表示する in the popup. The switch is disabled until the popup has read the
 * settings; checking it before that races the popup's own load (the flaky check() of G1.1/R3-1). */
export async function showArtwork(popup: Page) {
  const toggle = popup.getByRole('switch', { name: '作品を表示する' });
  await expect(toggle).toBeEnabled();
  await toggle.check();
}
