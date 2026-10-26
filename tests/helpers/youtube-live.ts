import type { Page } from '@playwright/test';

/** Split-scroll watch pages put comments in a native panel rather than below the video.
 * Open its real rail button when closed, leaving the caller's visibility/content checks intact. */
export async function openNativeComments(page: Page) {
  const watch = page.locator('ytd-watch-flexy');
  if (
    !(await watch.evaluate(
      (element) => element.hasAttribute('split-scroll') && element.hasAttribute('using-fixed-panel'),
    ))
  )
    return;
  const button = watch
    .locator('button[aria-label="Comments"]:visible, button[role="tab"][aria-label^="Comments,"]:visible')
    .first();
  if (!(await button.isVisible())) return;
  if ((await button.getAttribute('aria-pressed')) !== 'true' && (await button.getAttribute('aria-selected')) !== 'true')
    await button.click();
}

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

/** Wider than the approach rule's margins (40px to start, 72px to clear). */
export const APPROACH_CLEARANCE = 80;
/**
 * The point in `area` farthest from every visible native control and the player's control
 * bands. Within 40-72px of those the G1 approach rule correctly returns motion and gaze to rest,
 * and YouTube's layout (guide links, card menus, play buttons) differs between runs, so live
 * pointer checks aim at the clearest point instead of a fixed coordinate. Fails, naming the
 * clearance found, when no point in `area` is at least `minimum` away.
 */
export async function clearestPoint(
  page: Page,
  area: { left: number; top: number; right: number; bottom: number },
  minimum = APPROACH_CLEARANCE,
) {
  const best = await page.evaluate((area) => {
    const boxes = [
      ...document.querySelectorAll(
        'button, a[href], [role="button"], [role="slider"], [role="menu"], [role="dialog"], [role="listbox"], input, textarea, select, [contenteditable="true"], ytd-searchbox, yt-searchbox',
      ),
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
      Math.min(1e6, ...boxes.map((b) => Math.max(b.left - x, x - b.right, b.top - y, y - b.bottom)));
    let best = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2, clearance: -Infinity };
    for (let i = 0; i <= 16; i++)
      for (let j = 0; j <= 16; j++) {
        const x = area.left + ((area.right - area.left) * i) / 16,
          y = area.top + ((area.bottom - area.top) * j) / 16,
          c = clearance(x, y);
        if (c > best.clearance) best = { x, y, clearance: c };
      }
    return best;
  }, area);
  if (best.clearance < minimum)
    throw new Error(
      `No point ${minimum}px clear of native controls in ${JSON.stringify(area)}: ${JSON.stringify(best)}`,
    );
  return { x: best.x, y: best.y };
}

/** An error's message for a live check record: the received values and diagnostics included. */
export function errorSummary(error: unknown) {
  return String(error)
    .replace(new RegExp(String.fromCharCode(27) + '\[[0-9;]*m', 'g'), '')
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('at ') && !line.startsWith('Call log'))
    .slice(0, 12)
    .join(' · ')
    .slice(0, 2000);
}

/**
 * YouTube can play an advert before the video. While it runs the player has a second media
 * element and changing native UI, and protection holds artwork by design, so checks of the
 * video itself wait for it to end, skipping it when YouTube offers that as a person would.
 */
export async function waitForAdvertToEnd(page: Page, timeout = 120_000) {
  const player = page.locator('#movie_player');
  const end = Date.now() + timeout;
  while ((await player.getAttribute('class').catch(() => ''))?.split(' ').includes('ad-showing')) {
    if (Date.now() > end) throw new Error('A YouTube advert did not end within ' + timeout + 'ms.');
    const skip = page.locator('.ytp-skip-ad-button:visible, .ytp-ad-skip-button-modern:visible').first();
    if (await skip.count()) await skip.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
}
