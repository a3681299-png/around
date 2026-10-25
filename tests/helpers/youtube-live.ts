import type { Page } from '@playwright/test';

/**
 * YouTube can open a promotion dialog (e.g. YouTube Music) at any moment. Painting stops while a
 * native dialog is open, by design, so decline it as a person would. Returns whether a dialog was
 * declined; the click moves the pointer, so pointer-driven checks must aim again afterwards.
 */
export async function declinePromotion(page: Page) {
  const dialog = page.locator('ytd-popup-container tp-yt-paper-dialog:visible');
  if (!(await dialog.count())) return false;
  await dialog
    .getByRole('button', { name: /No thanks|Not now|いいえ|後で/ })
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined);
  return true;
}
