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

/**
 * The point in `area` farthest from every visible native control and the player's control
 * bands. Within 40-72px of those the G1 approach rule correctly returns motion and gaze to rest,
 * and YouTube's layout (guide links, card menus, play buttons) differs between runs, so live
 * pointer checks aim at the clearest point instead of a fixed coordinate.
 */
export function clearestPoint(page: Page, area: { left: number; top: number; right: number; bottom: number }) {
  return page.evaluate((area) => {
    const boxes = [
      ...document.querySelectorAll('button, a[href], [role="button"], [role="slider"], input, textarea, select'),
    ]
      .filter((e) => !e.closest('[id^="web-world-themes"]') && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => e.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    const player = document.querySelector('#movie_player')?.getBoundingClientRect();
    if (player)
      boxes.push(
        new DOMRect(player.left, player.top, player.width, Math.min(64, player.height)),
        new DOMRect(
          player.left,
          player.bottom - Math.min(112, player.height),
          player.width,
          Math.min(112, player.height),
        ),
      );
    const clearance = (x: number, y: number) =>
      Math.min(Infinity, ...boxes.map((b) => Math.max(b.left - x, x - b.right, b.top - y, y - b.bottom)));
    let best = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
    for (let i = 0; i <= 12; i++)
      for (let j = 0; j <= 12; j++) {
        const x = area.left + ((area.right - area.left) * i) / 12,
          y = area.top + ((area.bottom - area.top) * j) / 12;
        if (clearance(x, y) > clearance(best.x, best.y)) best = { x, y };
      }
    return best;
  }, area);
}
