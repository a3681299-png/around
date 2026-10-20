import type { Decoration, GroupLayer } from '../../src/design/types';
import { defaultCircleMask } from '../../src/effects/types';
import type { WorldInput, WorldScene } from '../../src/world/types';

/** Fixed data, shared by parity tests and the benchmark. No wall clock or random. */
export function worldScenario(count = 32): { scene: WorldScene; inputs: WorldInput[] } {
  const mask = () => ({
    ...defaultCircleMask(),
    bindings: [
      ...defaultCircleMask().bindings,
      {
        source: 'video.playing' as const,
        transform: { kind: 'boolean-gate' as const, fadeMs: 350 },
        target: 'mask.intensity' as const,
      },
    ],
  });
  const decorations: Decoration[] = Array.from({ length: count }, (_, i) => ({
    kind: 'image',
    id: `image-${i}`,
    name: `world-${i}.png`,
    assetId: `asset-${'a'.repeat(64)}`,
    placement: {
      anchor: Math.floor(i / 2) % 2 ? { kind: 'surface', target: 'video-player' } : { kind: 'viewport' },
      x: 0.1 + (i % 8) * 0.1,
      y: 0.25 + Math.floor(i / 8) * 0.15,
      widthPx: 90 + i,
      heightPx: 70,
      rotationDeg: i * 5,
    },
    visible: i % 7 !== 0,
    locked: i % 4 === 0,
    opacity: i % 9 ? 0.8 : 0,
    zIndex: i % 3,
    effects: [mask()],
  }));
  const groups: GroupLayer[] = Array.from({ length: Math.floor(count / 2) }, (_, i) => ({
    kind: 'group',
    id: `group-${i}`,
    name: `World ${i}`,
    visible: i % 5 !== 0,
    locked: i % 3 === 0,
    opacity: i % 4 ? 0.7 : 1,
    zIndex: i % 3,
    children: [`image-${i * 2}`, `image-${i * 2 + 1}`],
    effects: [mask()],
  }));
  const inputs: WorldInput[] = Array.from({ length: 180 }, (_, i) => ({
    timeMs: i * 16,
    deltaMs: i ? 16 : 0,
    viewport: { width: i < 100 ? 1100 : 720, height: 760 },
    anchors:
      i >= 120 && i < 130
        ? {}
        : {
            'video-player': { left: 80, top: 100 - Math.floor(i / 30) * 60, width: i < 100 ? 720 : 500, height: 400 },
          },
    signals: {
      pointer: i ? { x: (i * 7) % 1100, y: (i * 3) % 760 } : undefined,
      playing: Math.floor(i / 30) % 2 === 0,
    },
    environment: { hidden: i >= 80 && i < 90, reducedMotion: i >= 150 && i < 160 },
    events: [80, 90, 150, 160].includes(i)
      ? [{ type: 'host.lifecycle' }]
      : i % 30 === 0
        ? [{ type: i % 60 ? 'video.pause' : 'video.play' }]
        : [],
    seed: 1234,
  }));
  return { scene: { decorations, groups }, inputs };
}
