import { writeFileSync } from 'node:fs';
import { initialApproach, stepApproach } from '../../src/world/operations';
const rect = { left: 0, top: 0, width: 1000, height: 800 };
const s: any = {
  id: 'large-control',
  owner: 'native',
  generation: { documentId: 1, geometry: 1 },
  kind: 'click',
  shape: rect,
  protectedEnvelope: rect,
  availability: {
    present: true,
    visible: true,
    disabled: false,
    focused: false,
    editing: false,
    dragging: false,
    captured: false,
  },
  policy: {
    transform: 'fixed-plane',
    occlusion: 'forbid',
    input: 'native-only',
  },
  compositionCapability: 'exclusion',
  scrolls: false,
};
const from = { x: 0, y: 0 },
  to = { x: 1000, y: 800 },
  bounds = { left: 0, top: 700, right: 20, bottom: 720 };
const state = stepApproach(
  initialApproach(),
  {
    generation: { documentId: 1, geometry: 1 },
    viewport: { width: 1200, height: 1000 },
    surfaces: [s],
    supported: true,
  },
  { timeMs: 0, keyed: false, previousPoint: from, point: to },
  [
    {
      id: 'remote-corner',
      dynamic: true,
      opacity: 1,
      pointerEvents: false,
      outset: 0,
      composition: 'overlay',
      bounds,
    },
  ],
);
const distance = Math.min(
  ...[
    [bounds.left, bounds.top],
    [bounds.right, bounds.top],
    [bounds.left, bounds.bottom],
    [bounds.right, bounds.bottom],
  ].map(([x, y]) => Math.abs(1000 * y - 800 * x) / Math.hypot(1000, 800)),
);
writeFileSync(
  '.work/g12v-evidence/d11-diagonal.json',
  JSON.stringify(
    {
      from,
      to,
      control: rect,
      layer: bounds,
      minimumCornerDistanceToSegment: distance,
      actualHeld: [...state.held],
      near: [...state.near],
      note: 'D11 uses an axis-aligned path bounding rectangle, not exact 72px distance from a diagonal segment; conservative extra hold.',
    },
    null,
    2,
  ),
);
