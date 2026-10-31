import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * The editor as people will use it from UI0-d on: the Studio page connected to the YouTube tab.
 * It opens as an ordinary extension tab, so it runs headless. The side panel itself (a native
 * Chrome surface whose asset leases the background verifies) stays in tests/side-panel.spec.ts.
 * `width` picks the arrangement: about 400 is the side panel's, 1440 the Studio window's.
 */
export async function openEditor(
  context: BrowserContext,
  popup: Page,
  youtube: Page,
  { width = 1440, height = 900 }: { width?: number; height?: number } = {},
) {
  await youtube.bringToFront();
  const extension = new URL(popup.url()).host;
  const tab = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  if (tab === undefined) throw new Error('No active YouTube tab to edit.');
  const studio = await context.newPage();
  await studio.setViewportSize({ width, height });
  await studio.goto(`chrome-extension://${extension}/studio/index.html?target=${tab}`);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.getByRole('dialog', { name: 'デザインエディター' });
  await expect(panel).toBeVisible();
  return { studio, panel };
}
