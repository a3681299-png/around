import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { evaluateModels } from '../../src/world/models';
import type { WorldInput, WorldLayout } from '../../src/world/types';

const design = JSON.parse(readFileSync('.work/playground/content/design.json', 'utf8'));
for (const cause of ['timed clip', 'moving path'] as const) {
  test(`world prioritizes the author's ${cause} over the computed pose`, async () => {
    const run: typeof evaluateModels =
      process.env.CHUNK2_FAULT === 'author' ? (await import('./models-author-off.mjs')).evaluateModels : evaluateModels;
    const layer = structuredClone(design.decorations.find((layer: any) => layer.id === 'resident'));
    if (cause === 'timed clip') {
      layer.character.motions[0].role = 'gesture';
      layer.character.motions[0].source.duration = 2;
    } else layer.motion = { enabled: true, orientToMovement: false };
    let previous: ReturnType<typeof evaluateModels>['state'] | undefined;
    const poses = [];
    for (let t = 0; t <= 5200; t += 16) {
      const position = { x: 300 + (cause === 'moving path' ? t / 12 : 0), y: 240 };
      const input: WorldInput = {
        viewport: { width: 1280, height: 900 },
        anchors: {},
        timeMs: t,
        deltaMs: 16,
        environment: { hidden: false, reducedMotion: false },
        events: t === 160 ? [{ type: 'video.play' }] : t === 1600 ? [{ type: 'video.pause' }] : [],
        signals: {
          pointer: { x: 900, y: 120 },
          samples: { 'user.idle.duration': 9 },
          scroll: { y: t * 4, maxY: 100_000 },
        },
      };
      const layout: WorldLayout = {
        roots: [layer.id],
        groups: [],
        layers: [{ layer, position, renderable: true, visible: true, locked: false, effectiveOpacity: 1 }],
      };
      const result = run(layout, previous, input);
      previous = result.state;
      poses.push(result.evaluations[0]!.pose!);
    }
    expect(
      poses.every(
        (pose) =>
          pose &&
          pose.hips.every((value) => value === 0) &&
          pose.yawDeg === 0 &&
          pose.offset.x === 0 &&
          pose.offset.y === 0 &&
          pose.opacity === 1 &&
          Object.keys(pose.bones).every((bone) => ['chest', 'leftUpperArm', 'rightUpperArm', 'spine'].includes(bone)),
      ),
    ).toBe(true);
    expect(new Set(poses.map((pose) => pose.bones.chest?.[0])).size).toBeGreaterThan(10);
    expect(poses.some((pose) => pose.blink > 0)).toBe(true);
    if (cause === 'timed clip') expect(previous![layer.id]!.timeMs).toBeGreaterThan(0);
  });
}
