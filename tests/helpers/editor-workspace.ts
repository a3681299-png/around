import type { Locator, Page } from '@playwright/test';

/** Regression suites exercise both existing control areas in the optional split view.
 * editor-ux.spec.ts separately verifies the default tabbed, mouse-only experience. */
export async function exposeEditorControls(panel: Locator) {
  const split = panel.locator('.split');
  if ((await split.getAttribute('aria-pressed')) !== 'true') await split.click();
  await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  const guide = panel.getByRole('button', { name: '操作ガイドを閉じる', exact: true });
  if (await guide.isVisible()) await guide.click();
  const layout = panel.locator('.arrangement-section');
  // Open the folding preference even before a selection exists; target controls
  // are revealed by selection, as in the default workspace.
  await layout.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
}

/** Preview gestures use the real collapse control so optional split panels cannot cover the artwork. */
export async function withCanvas<T>(page: Page, operation: () => Promise<T>): Promise<T> {
  const panel = page.getByRole('dialog', { name: 'デザインエディター' });
  const minimize = panel.getByRole('button', { name: 'パネルを折りたたむ', exact: true });
  const restore = await minimize.isVisible();
  if (restore) await minimize.click();
  try {
    return await operation();
  } finally {
    if (restore && (await panel.isVisible()))
      await panel.getByRole('button', { name: 'パネルを展開する', exact: true }).click();
  }
}

export async function clickCanvas(node: Locator, options?: Parameters<Locator['click']>[0]) {
  await withCanvas(node.page(), () => node.click(options));
}
