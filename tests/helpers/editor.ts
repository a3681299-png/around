import { expect, type Page } from '@playwright/test';
import { clearestPoint } from './youtube-live';

/**
 * The editor as people use it from UI0-d on: the editor page connected to the YouTube tab. It opens
 * as an ordinary extension tab, so it runs headless. The side panel itself (a native Chrome surface
 * whose asset leases the background verifies) stays in tests/side-panel.spec.ts.
 * `width` picks the arrangement: below 720 the side panel's (one column, tabs), 1440 the window's.
 * The YouTube tab is brought back to the front, as a person keeps looking at it.
 */
export async function openEditor(
  popup: Page,
  youtube: Page,
  { width = 1440, height = 900 }: { width?: number; height?: number } = {},
) {
  await youtube.bringToFront();
  const extension = new URL(popup.url()).host;
  const tab = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  if (tab === undefined) throw new Error('No active YouTube tab to edit.');
  // Opening the editor again for this tab replaces its earlier editor page, as its window would.
  const page = `chrome-extension://${extension}/studio/index.html`;
  for (const earlier of youtube.context().pages()) if (earlier.url() === `${page}?target=${tab}`) await earlier.close();
  const studio = await youtube.context().newPage();
  await studio.setViewportSize({ width, height });
  await studio.goto(`${page}?target=${tab}`);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.getByRole('dialog', { name: 'デザインエディター' });
  await expect(panel).toBeVisible();
  await youtube.bringToFront();
  return { studio, panel };
}

/** Closes the editor's pages, as a person closes its window. The floating editor went away with a
 * reload of YouTube; the editor page instead reconnects and resumes, so checks of the page without
 * an editor close it first. */
export async function closeEditorPages(youtube: Page) {
  for (const page of youtube.context().pages())
    if (/^chrome-extension:\/\/[a-p]{32}\/studio\/index\.html/.test(page.url())) await page.close();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
}

/** The in-video icon opens Chrome's side panel within its click while 制作モード is ON (a headed
 * browser; the panel itself is driven with tests/helpers/side-panel.ts). The icon sits among the
 * player's controls; a person then moves to the panel, so focus and pointer leave those controls.
 * In real Chrome the panel takes the focus; driven panels do not, so the test moves them. Until
 * they leave, the operation guard keeps decorations yielding to those controls (G1). */
export async function openSidePanelFromIcon(popup: Page, youtube: Page) {
  const mode = popup.getByRole('switch', { name: '制作モード', exact: true });
  if (!(await mode.isChecked())) await mode.check();
  await youtube.bringToFront();
  await youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
  await youtube.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const viewport = await youtube.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const away = await clearestPoint(youtube, { left: 0, top: 0, right: viewport.width, bottom: viewport.height });
  await youtube.mouse.move(away.x, away.y, { steps: 4 });
  return away;
}
