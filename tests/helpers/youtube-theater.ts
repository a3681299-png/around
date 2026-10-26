import { expect, type Page } from '@playwright/test';

/** Verify a real native wide-view transition and its return. Split-scroll YouTube collapses
 * its fixed panel instead of setting theater; classic keeps the original attribute assertion.
 * Both paths must switch the native button's mode and expand the actual player. */
export async function enterNativeTheater(page: Page) {
  const player = page.locator('#movie_player');
  const button = player.locator('.ytp-size-button');
  const watch = page.locator('ytd-watch-flexy');
  await player.hover();
  if (/^(Default view|デフォルト表示)$/.test((await button.getAttribute('data-title-no-tooltip')) ?? '')) {
    // Window resizing may leave YouTube in its wide view before this check starts.
    const wide = await player.boundingBox();
    expect(wide).not.toBeNull();
    await button.click();
    await expect(button).toHaveAttribute('data-title-no-tooltip', /^(Theater mode|シアター モード)$/);
    await expect.poll(async () => (await player.boundingBox())?.width ?? Infinity).toBeLessThan(wide!.width - 1);
    await player.hover(); // Wait for the native resize animation to stop before taking the baseline.
  }
  await expect(button).toHaveAttribute('data-title-no-tooltip', /^(Theater mode|シアター モード)$/);
  const before = await player.boundingBox();
  expect(before).not.toBeNull();
  const panels = await watch.evaluate((element) => ({
    split: element.hasAttribute('split-scroll') && element.hasAttribute('using-fixed-panel'),
    expanded: element.hasAttribute('fixed-panel-expanded'),
  }));
  await button.click();
  await expect(button).toHaveAttribute('data-title-no-tooltip', /^(Default view|デフォルト表示)$/);
  if (panels.split) {
    expect(panels.expanded).toBe(true);
    await expect(watch).not.toHaveAttribute('fixed-panel-expanded', '');
  } else await expect(watch).toHaveAttribute('theater', '');
  await expect.poll(async () => (await player.boundingBox())?.width ?? 0).toBeGreaterThan(before!.width + 1);
  console.log(
    'Native wide view: ' +
      JSON.stringify({ splitScroll: panels.split, before: before!.width, after: (await player.boundingBox())?.width }),
  );
  return async () => {
    await player.hover();
    await button.click();
    await expect(button).toHaveAttribute('data-title-no-tooltip', /^(Theater mode|シアター モード)$/);
    if (panels.split) await expect(watch).toHaveAttribute('fixed-panel-expanded', '');
    else await expect(watch).not.toHaveAttribute('theater', '');
    await expect.poll(async () => Math.abs(((await player.boundingBox())?.width ?? 0) - before!.width)).toBeLessThan(2);
  };
}
