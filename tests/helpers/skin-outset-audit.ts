import { build } from 'esbuild';
import type { Page } from '@playwright/test';
import { pixels } from './native-youtube';

export async function installOutsetAudit(page: Page) {
  const probe = await build({
    stdin: {
      contents: "export { youtubeOperations } from './src/sites/youtube-operations';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__ui11Geometry',
  });
  // DevTools evaluation of our test bundle, not a <script> assignment. YouTube enforces
  // TrustedScript for script.text; leave that policy and the site's CSP intact.
  await page.evaluate(probe.outputFiles[0]!.text);
}

/** Compare the actual painted outer strips with native controls and the G1 protected planes. */
export async function outsetAudit(page: Page) {
  return page.evaluate(() => {
    const source = (window as any).__ui11Geometry.youtubeOperations(document);
    const operations = source.capture();
    source.destroy();
    type Rect = { left: number; top: number; width: number; height: number };
    const rect = (node: Element): Rect => {
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    const area = (a: Rect, b: Rect) =>
      Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
    const intersection = (a: Rect, b: Rect): Rect => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      width: Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)),
      height: Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)),
    });
    const sameRect = (a: Rect, b: Rect) =>
      (['left', 'top', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) < 0.001);
    const viewport = { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const controls = [
      ...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="textbox"]'),
    ]
      .map((node) => ({ node, box: rect(node) }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && area(box, viewport) > 0);
    const nodes = [
      ...document.querySelectorAll('[data-around-surface~="video-card"],[data-around-surface~="comment-input"]'),
    ].filter((node) => area(rect(node), viewport) > 0);
    const parts = nodes.map((node, index) => {
      const box = rect(node);
      const css = getComputedStyle(node);
      const values = css.borderImageOutset.split(' ').map(parseFloat);
      const top = values[0]!,
        right = values[1] ?? top,
        bottom = values[2] ?? top,
        left = values[3] ?? right;
      const strips = [
        { left: box.left - left, top: box.top - top, width: box.width + left + right, height: top },
        { left: box.left - left, top: box.top + box.height, width: box.width + left + right, height: bottom },
        { left: box.left - left, top: box.top, width: left, height: box.height },
        { left: box.left + box.width, top: box.top, width: right, height: box.height },
      ];
      const intersections = (other: Rect) =>
        strips
          .map((strip) => intersection(intersection(strip, other), viewport))
          .filter((box) => box.width > 0 && box.height > 0);
      // G1 envelopes include a 4px focus margin. A native control or input container belonging
      // to this same skinned component is intentionally inside its native styling boundary.
      // Keep those contacts in the evidence; compare unrelated protected planes separately.
      const lineage = [node, ...node.querySelectorAll('*')];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) lineage.push(parent);
      const neighbors = controls
        .filter(
          ({ node: other, box: otherBox }) =>
            !node.contains(other) && !other.contains(node) && strips.some((strip) => area(strip, otherBox) > 0.01),
        )
        .map(({ node: other, box: otherBox }) => ({
          tag: other.tagName,
          label: other.getAttribute('aria-label'),
          text: other.textContent?.trim().slice(0, 60),
          box: otherBox,
          area: strips.reduce((sum, strip) => sum + area(strip, otherBox), 0),
          intersections: intersections(otherBox),
        }));
      const g1 = operations.surfaces
        .filter(
          (surface: any) =>
            surface.availability.visible && strips.some((strip) => area(strip, surface.protectedEnvelope) > 0.01),
        )
        .map((surface: any) => ({
          id: surface.id,
          policy: surface.policy,
          box: surface.protectedEnvelope,
          area: strips.reduce((sum, strip) => sum + area(strip, surface.protectedEnvelope), 0),
          shape: surface.shape,
          samePart:
            !surface.id.startsWith('player.') && lineage.some((element) => sameRect(rect(element), surface.shape)),
          intersections: intersections(surface.protectedEnvelope),
        }));
      return {
        index,
        kind: node
          .getAttribute('data-around-surface')!
          .split(' ')
          .find((id) => id === 'video-card' || id === 'comment-input')!,
        box,
        outset: [top, right, bottom, left],
        source: css.borderImageSource,
        strips,
        neighbors,
        g1,
        paint: {
          left: box.left - left,
          top: box.top - top,
          width: box.width + left + right,
          height: box.height + top + bottom,
        },
      };
    });
    const touchingFrames = parts.flatMap((part, index) =>
      parts
        .slice(index + 1)
        .filter((other) => area(part.paint, other.paint) > 0.01)
        .map((other) => ({ first: part.index, second: other.index, area: area(part.paint, other.paint) })),
    );
    return {
      viewport: { width: innerWidth, height: innerHeight, outerWidth, outerHeight, dpr: devicePixelRatio },
      supported: operations.supported,
      bands: operations.surfaces.filter((surface: any) =>
        ['player.controls.top', 'player.controls.bottom'].includes(surface.id),
      ),
      parts,
      touchingFrames,
    };
  });
}

/** A rectangle can cross a sticky header while its paint stays behind that header. Compare
 * every affected CSS pixel, including G1's focus margin, instead of equating boxes with paint. */
export async function outsetPaintDiff(
  page: Page,
  before: Buffer,
  after: Buffer,
  audit: Awaited<ReturnType<typeof outsetAudit>>,
) {
  const points = new Map<string, { x: number; y: number }>();
  const contacts = audit.parts.flatMap((part) => [
    ...part.neighbors.map((row) => ({ kind: part.kind, id: row.label ?? row.tag, ...row })),
    ...part.g1
      .filter((row: any) => !row.samePart && row.policy.occlusion === 'forbid')
      .map((row: any) => ({ kind: part.kind, ...row })),
  ]);
  for (const contact of contacts)
    for (const box of contact.intersections) {
      for (let y = Math.floor(box.top); y < Math.ceil(box.top + box.height); y++)
        for (let x = Math.floor(box.left); x < Math.ceil(box.left + box.width); x++) points.set(`${x},${y}`, { x, y });
    }
  const locations = [...points.values()];
  if (!locations.length) return { checked: 0, contacts, differences: [] };
  const [a, b] = await Promise.all([pixels(page, before, locations), pixels(page, after, locations)]);
  return {
    checked: locations.length,
    contacts,
    differences: locations.flatMap((point, index) =>
      a[index]!.some((value, channel) => value !== b[index]![channel])
        ? [{ ...point, before: a[index], after: b[index] }]
        : [],
    ),
  };
}
