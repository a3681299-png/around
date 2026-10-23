import { expect, type Locator, type Page } from '@playwright/test';

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

/** A numeric bounding box is also available while Host verification has hidden
 * the layer. Wait for its real hit target before starting a raw drag. */
export async function beginCanvasGesture(node: Locator, point?: { x: number; y: number }) {
  const box = (await node.boundingBox())!;
  const at = point ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await node.page().mouse.move(at.x, at.y);
  await expect
    .poll(() =>
      node.evaluate((element, p) => {
        let hit = element.ownerDocument.elementFromPoint(p.x, p.y);
        while (hit?.shadowRoot) {
          const next = hit.shadowRoot.elementFromPoint(p.x, p.y);
          if (!next || next === hit) break;
          hit = next;
        }
        const group = element.closest('.composition[data-selected]');
        return Boolean(hit && (hit === element || element.contains(hit) || group?.contains(hit)));
      }, at),
    )
    .toBe(true);
  await node.page().mouse.down();
}
