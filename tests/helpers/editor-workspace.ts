import { expect, type Locator, type Page } from '@playwright/test';
import { attachOperationDiagnostics } from './operation-diagnostics';

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

/** Collapsing the panel changes the page layout; protection briefly holds drawing while it
 * re-reads the native surfaces. Screenshots and gestures wait until drawing has resumed. */
export async function protectionSettled(page: Page) {
  const host = page.locator('#web-world-themes-decorations');
  if (!(await host.count())) return;
  // The record updates on the next draw, while a new change hides layers at once; require both,
  // twice in a row, so a pending change cannot pass between the two reads.
  const settled = () =>
    page.evaluate(() => {
      const record = document.querySelector('#web-world-themes-decorations')?.getAttribute('data-ww-safety');
      const stopped = record ? (JSON.parse(record).stopped ?? '') : '';
      const hidden = [...document.querySelectorAll('[id^="web-world-themes-"][id$="decorations"]')].some((host) =>
        [...(host.shadowRoot?.querySelectorAll<HTMLElement>('[data-image-id]') ?? [])].some(
          (node) => node.style.visibility === 'hidden' && !node.hasAttribute('data-safety-limited'),
        ),
      );
      return !stopped && !hidden;
    });
  await expect.poll(async () => (await settled()) && (await settled())).toBe(true);
}

/** Preview gestures use the real collapse control so optional split panels cannot cover the artwork. */
export async function withCanvas<T>(page: Page, operation: () => Promise<T>): Promise<T> {
  const panel = page.getByRole('dialog', { name: 'デザインエディター' });
  const minimize = panel.getByRole('button', { name: 'パネルを折りたたむ', exact: true });
  const restore = await minimize.isVisible();
  if (restore) await minimize.click();
  await protectionSettled(page);
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
  let last: unknown;
  await expect
    .poll(async () => {
      const state = await node.evaluate((element, p) => {
        let hit = element.ownerDocument.elementFromPoint(p.x, p.y);
        while (hit?.shadowRoot) {
          const next = hit.shadowRoot.elementFromPoint(p.x, p.y);
          if (!next || next === hit) break;
          hit = next;
        }
        const group = element.closest('.composition[data-selected]');
        const ok = Boolean(hit && (hit === element || element.contains(hit) || group?.contains(hit)));
        if (ok) return { ok };
        // What took the point instead, for live-site failures that do not reproduce alone.
        const root = element.getRootNode();
        const visible = (e: Element) => {
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        };
        return {
          ok,
          point: p,
          hit: hit && `${hit.tagName}#${hit.id}.${String(hit.className).slice(0, 60)}`,
          plane: (() => {
            let at: Node = element;
            while (at.getRootNode() instanceof ShadowRoot) {
              const host = (at.getRootNode() as ShadowRoot).host;
              if (host.id.startsWith('web-world-themes')) return host.id;
              at = host;
            }
            return '';
          })(),
          planeClips: [...document.querySelectorAll<HTMLElement>('[id^="web-world-themes-"][id$="decorations"]')].map(
            (h) => `${h.id}=${h.style.getPropertyValue('--ww-decoration-clip').slice(0, 60)}`,
          ),
          horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          visibility: (element as HTMLElement).style.visibility,
          clip:
            root instanceof ShadowRoot
              ? (root.host as HTMLElement).style.getPropertyValue('--ww-decoration-clip').slice(0, 160)
              : '',
          safety: document
            .querySelector('#web-world-themes-decorations')
            ?.getAttribute('data-ww-safety')
            ?.slice(0, 600),
          playerControls: [...document.querySelectorAll('#movie_player button, #movie_player [role="button"]')]
            .filter(visible)
            .map((e) => `${String(e.className).slice(0, 40)}@${Math.round(e.getBoundingClientRect().top)}`),
          dialogs: [...document.querySelectorAll('tp-yt-paper-dialog, [role="dialog"]')].filter(visible).length,
          player: (() => {
            const r = document.querySelector('#movie_player')?.getBoundingClientRect();
            return r && [r.left, r.top, r.width, r.height].map(Math.round);
          })(),
        };
      }, at);
      last = state;
      return state.ok;
    })
    .toBe(true)
    .catch(async (error: Error) => {
      await attachOperationDiagnostics(node.page()).catch(() => undefined);
      throw new Error(
        `${error.message}${String.fromCharCode(10)}Artwork is not the hit target: ${JSON.stringify(last)}`,
      );
    });
  await node.page().mouse.down();
}

/** A point on the artwork that is its real hit target, the centre when possible. On the live
 * site a native control (e.g. a paused video's large play button) can sit over part of it; that
 * part correctly stays native, so a person grabs the rest. Falls back to the centre. */
export async function visiblePart(node: Locator) {
  let found: { x: number; y: number } | undefined;
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      if (!box) return false;
      const points = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
      for (let i = 1; i < 6; i++)
        for (let j = 1; j < 6; j++) points.push({ x: box.x + (box.width * i) / 6, y: box.y + (box.height * j) / 6 });
      found = await node.evaluate((element, points) => {
        const own = (p: { x: number; y: number }) => {
          let hit = element.ownerDocument.elementFromPoint(p.x, p.y);
          while (hit?.shadowRoot) {
            const next = hit.shadowRoot.elementFromPoint(p.x, p.y);
            if (!next || next === hit) break;
            hit = next;
          }
          const group = element.closest('.composition[data-selected]');
          return Boolean(hit && (hit === element || element.contains(hit) || group?.contains(hit)));
        };
        return points.find(own);
      }, points);
      return Boolean(found);
    })
    .toBe(true)
    .catch(() => undefined);
  if (found) return found;
  const box = (await node.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
