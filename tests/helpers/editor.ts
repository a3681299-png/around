import { expect, type Page } from '@playwright/test';

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

/**
 * UI0-d, until round 3 decides them: the few checks of what only the floating editor (F) or the
 * in-page Studio (I) has. Neither has an entry any more; their content-script messages remain, so
 * these checks keep running unchanged until each is moved or retired (docs/ui0d-2.md).
 */
export async function openRetiredEditor(popup: Page, youtube: Page, kind: 'floating' | 'inpage' = 'floating') {
  await youtube.bringToFront();
  await popup.evaluate(
    async (type) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab!.id!, { type });
      if (!response?.ok) throw new Error(response?.error ?? 'The retired editor did not open.');
    },
    kind === 'floating' ? 'web-world-themes:open-creator-editor' : 'web-world-themes:open-inpage-studio',
  );
  const panel = youtube.getByRole('dialog', { name: 'デザインエディター' });
  await expect(panel).toBeVisible();
  return panel;
}
