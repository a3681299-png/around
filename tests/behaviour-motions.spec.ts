import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { migrateV14ToV15 } from '../src/design/migrations';
import { applyCharacterPatch, BEHAVIOUR_NAMES } from '../src/characters/settings';
import { AUTONOMY, BEHAVIOURS } from '../src/world/autonomy';
import { gaitSpeedPx, matchGait } from '../src/world/gait';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import type { DesignDocument, ModelDecoration } from '../src/design/types';

/**
 * v15 (chunk 3): which of the character's motions plays for each autonomy behaviour, which part
 * of it (seconds) and how fast. Only a fixed behaviour name, a motion id of this character and
 * numbers; the engine plays it only while the autonomy decides (never over the author's motion).
 */
const v14 = JSON.parse(readFileSync('tests/fixtures/designs/history-v14.json', 'utf8'));
const motion = (id: string, duration: number) => {
  const base = structuredClone(v14.decorations[0].character.motions[0]);
  base.id = id;
  base.role = 'move';
  base.source.duration = duration;
  // In place: these motions test the assignment; a travelling walk's gait is tested below.
  base.source.hipsTravel = [0, 0, 0];
  return base;
};
const document = (behaviourMotions?: unknown, version = 15, extra: Record<string, unknown> = {}) => {
  const doc = structuredClone(v14);
  doc.schemaVersion = version;
  const character = doc.decorations[0].character;
  character.motions.push(motion('hop', 2.6), motion('walk', 1), motion('run', 0.7));
  Object.assign(character, { autonomy: true, ...extra });
  if (behaviourMotions !== undefined) character.behaviourMotions = behaviourMotions;
  return doc;
};
const assignment = {
  rest: { motion: 'idle', from: 0, to: 1, speed: 1 },
  flee: { motion: 'hop', from: 0.6, to: 1.9, speed: 1.5 },
  approach: { motion: 'walk', from: 0, to: 1, speed: 0.5 },
  return: { motion: 'run', from: 0, to: 0.7, speed: 1 },
};
const characterOf = (doc: DesignDocument) => (doc.decorations[0] as ModelDecoration).character!;

test('the data’s behaviour names are the autonomy’s behaviours', () => {
  expect([...BEHAVIOUR_NAMES]).toEqual([...BEHAVIOURS]);
});

test('behaviour motions roundtrip; a v14 document cannot carry them', () => {
  const parsed = parseDesign(document(assignment));
  expect(characterOf(parsed).behaviourMotions).toEqual(assignment);
  expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toStrictEqual(parsed);
  expect(() => migrateV14ToV15(document(assignment, 14))).toThrow('v15');
  // Absent: nothing is assigned (the computed motion alone, as before).
  expect(Object.hasOwn(characterOf(parseDesign(document())), 'behaviourMotions')).toBe(false);
});

test('only known behaviours, this character’s motions, a part inside the motion and a bounded speed', () => {
  const bad: unknown[] = [
    { dance: { motion: 'idle', from: 0, to: 1, speed: 1 } },
    { flee: { motion: 'nope', from: 0, to: 1, speed: 1 } },
    { flee: { motion: 'hop', from: 1.9, to: 0.6, speed: 1 } },
    { flee: { motion: 'hop', from: 0.6, to: 0.6, speed: 1 } },
    { flee: { motion: 'hop', from: -0.1, to: 1, speed: 1 } },
    { flee: { motion: 'hop', from: 0, to: 2.7, speed: 1 } },
    { flee: { motion: 'hop', from: 0, to: 1, speed: 0.2 } },
    { flee: { motion: 'hop', from: 0, to: 1, speed: 4.01 } },
    { flee: { motion: 'hop', from: 0, to: 1, speed: '1' } },
    { flee: { motion: 'hop', from: 0, to: 1, speed: 1, script: 'alert(1)' } },
    { flee: { motion: 'hop', from: 0, to: 1 } },
    { flee: 'hop' },
    [],
    'flee',
  ];
  for (const value of bad) expect(() => parseDesign(document(value)), JSON.stringify(value)).toThrow();
  // The bounds themselves are allowed; numbers are kept to 0.01.
  const edge = characterOf(parseDesign(document({ flee: { motion: 'hop', from: 0, to: 2.6, speed: 4 } })));
  expect(edge.behaviourMotions?.flee).toEqual({ motion: 'hop', from: 0, to: 2.6, speed: 4 });
  const rounded = characterOf(
    parseDesign(document({ doze: { motion: 'walk', from: 0.123, to: 0.987, speed: 0.333 } })),
  );
  expect(rounded.behaviourMotions?.doze).toEqual({ motion: 'walk', from: 0.12, to: 0.99, speed: 0.33 });
  // A held pose (length 0) is the part 0…0 and nothing else.
  const pose = (from: number, to: number) => {
    const doc = document({ doze: { motion: 'pose', from, to, speed: 1 } });
    doc.decorations[0].character.motions.push(motion('pose', 0));
    return doc;
  };
  expect(characterOf(parseDesign(pose(0, 0))).behaviourMotions?.doze).toEqual({
    motion: 'pose',
    from: 0,
    to: 0,
    speed: 1,
  });
  expect(() => parseDesign(pose(0, 0.5))).toThrow();
});

test('a motion patch keeps the assignment, and drops an entry whose motion is removed', () => {
  const layer = parseDesign(document(assignment)).decorations[0] as ModelDecoration;
  const kept = applyCharacterPatch(
    { source: layer.source, character: layer.character!, model: layer.model },
    { keep: layer.character!.motions.map((m) => m.id).filter((id) => id !== 'walk') },
  );
  expect(kept.character.behaviourMotions).toEqual({
    rest: assignment.rest,
    flee: assignment.flee,
    return: assignment.return,
  });
  const set = applyCharacterPatch(
    { source: layer.source, character: layer.character!, model: layer.model },
    { behaviourMotions: { flee: { motion: 'run', from: 0, to: 0.5, speed: 2 } } },
  );
  expect(set.character.behaviourMotions).toEqual({ flee: { motion: 'run', from: 0, to: 0.5, speed: 2 } });
});

/** The world: a pointer rushes at the character; its clip follows the behaviour. */
function run(doc: DesignDocument, frames: number, pointer: (t: number) => { x: number; y: number } | undefined) {
  let state = initialWorldState();
  const out: { t: number; clip: number | null; timeMs: number; behaviour: string | undefined }[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i * 16;
    const result = evaluateWorld(doc, state, {
      timeMs: t,
      deltaMs: i ? 16 : 0,
      viewport: { width: 1100, height: 760 },
      anchors: {},
      signals: { playing: true, pointer: pointer(t) },
      events: [],
      environment: { hidden: false, reducedMotion: false },
    });
    state = result.state;
    const m = result.frame.models![0]!;
    out.push({
      t,
      clip: m.clip,
      timeMs: m.timeMs,
      behaviour: (state.models?.['trusie']?.body as { autonomy?: { behaviour: string } } | undefined)?.autonomy
        ?.behaviour,
    });
  }
  return out;
}
// The character is drawn at the viewport's middle (550, 380), 160 px tall.
const rush = (t: number) => ({ x: Math.min(490, -400 + t * 2.4), y: 380 });

test('the assigned motion plays its part at its speed while the autonomy picks the behaviour', () => {
  const doc = parseDesign(document(assignment));
  const motions = characterOf(doc).motions.map((m) => m.id);
  const frames = run(doc, 160, rush);
  // At rest first: the rest motion (idle), inside its part.
  expect(frames[5]!.behaviour).toBe('rest');
  expect(frames[10]!.clip).toBe(motions.indexOf('idle'));
  const fleeing = frames.filter((f) => f.behaviour === 'flee');
  expect(fleeing.length).toBeGreaterThan(10);
  // A frame after the behaviour changed, its motion plays: the hop, between 0.6 s and 1.9 s,
  // advancing 1.5 times as fast as the clock.
  const during = fleeing.slice(2);
  for (const f of during) {
    expect(f.clip).toBe(motions.indexOf('hop'));
    expect(f.timeMs).toBeGreaterThanOrEqual(600);
    expect(f.timeMs).toBeLessThanOrEqual(1900);
  }
  const [a, b] = [during[0]!, during[1]!];
  expect(b.timeMs - a.timeMs).toBeCloseTo(16 * 1.5, 5);
  // Deterministic: the same inputs give the same frames.
  expect(run(doc, 160, rush)).toEqual(frames);
});

test('without an assignment, or with the autonomy off, the author’s clip plays as before', () => {
  const plain = run(parseDesign(document()), 120, rush);
  const off = run(parseDesign(document(assignment, 15, { autonomy: false })), 120, rush);
  // (The fixture's author clip is a standard motion its body measure rules out: null, as in v14.)
  const assignedClips = ['hop', 'walk', 'run'].map((id) =>
    characterOf(parseDesign(document())).motions.findIndex((m) => m.id === id),
  );
  for (const f of plain) expect(assignedClips).not.toContain(f.clip);
  expect(off.map((f) => [f.clip, f.timeMs])).toEqual(plain.map((f) => [f.clip, f.timeMs]));
});

test('a walk that travels: going home it walks at the speed its feet keep, playing at the matching rate, never hopping', () => {
  const doc = parseDesign(document({ ...assignment, return: { motion: 'walk', from: 0, to: 1, speed: 1 } }));
  const character = characterOf(doc),
    walk = character.motions.find((m) => m.id === 'walk')!;
  // The walk's hips go 0.4 m forward in its 1 s (its rest hips 0.9 m high).
  walk.source = { ...walk.source, hipsTravel: [0, 0, 0.4] };
  const layer = doc.decorations[0] as ModelDecoration;
  const natural = gaitSpeedPx(walk, layer.source.vrm?.body, layer.placement.heightPx)!;
  const { rate, speedPx } = matchGait(AUTONOMY.returnSpeed, natural);
  // Frightened away, then the pointer leaves: it goes home with the walk.
  let state = initialWorldState();
  const frames: {
    behaviour: string | undefined;
    clip: number | null;
    timeMs: number;
    hop: number;
    x: number;
    yaw: number;
  }[] = [];
  // (This walk is slow, 32 px/s at its fastest: home takes a while.)
  for (let i = 0; i < 1600; i++) {
    const t = i * 16;
    const result = evaluateWorld(doc, state, {
      timeMs: t,
      deltaMs: i ? 16 : 0,
      viewport: { width: 1100, height: 760 },
      anchors: {},
      signals: { playing: true, pointer: t < 1500 ? rush(t) : { x: 10, y: 10 } },
      events: [],
      environment: { hidden: false, reducedMotion: false },
    });
    state = result.state;
    const m = result.frame.models![0]!;
    const body = state.models?.['trusie']?.body as { autonomy?: { behaviour: string; offset: { x: number } } };
    frames.push({
      behaviour: body?.autonomy?.behaviour,
      clip: m.clip,
      timeMs: m.timeMs,
      hop: m.pose?.offset.y ?? 0,
      x: body?.autonomy?.offset.x ?? 0,
      yaw: m.yawDeg,
    });
  }
  const going = frames.filter((f, i) => f.behaviour === 'return' && frames[i + 1]?.behaviour === 'return');
  expect(going.length).toBeGreaterThan(10);
  const walkIndex = character.motions.findIndex((m) => m.id === 'walk');
  const [a, b] = [going[3]!, going[4]!];
  expect(b.clip).toBe(walkIndex);
  // The walk plays at the rate that keeps up, and the body moves at the walk's speed.
  expect((b.timeMs - a.timeMs + 1000) % 1000).toBeCloseTo(16 * rate, 3);
  expect(Math.abs(b.x - a.x)).toBeCloseTo(speedPx * 0.016, 1);
  // Walking, not hopping, and turned the way it goes (it fled right, so home is to the left).
  for (const f of going) expect(f.hop).toBe(0);
  expect(going.at(-2)!.x).toBeLessThan(going[0]!.x);
  expect(going.at(-2)!.yaw).toBeCloseTo(-90, 0);
  // Home again, it turns back to the viewer.
  expect(frames.at(-1), JSON.stringify(frames.slice(-3))).toMatchObject({ behaviour: 'rest', yaw: 0 });
});

test('between sitting and standing, the motion that sits down or stands up plays once first', () => {
  const doc = parseDesign(document());
  const character = characterOf(doc);
  // A sitting loop, a once-through motion that lowers the hips and one that raises them.
  const sitLoop = { ...motion('perch', 2), role: 'sit' };
  const down = { ...motion('perch-down', 0.5), role: 'sit', loop: false };
  down.source = { ...down.source, hipsTravel: [0, -0.3, 0] };
  const up = { ...motion('perch-up', 0.4), role: 'sit', loop: false };
  up.source = { ...up.source, hipsTravel: [0, 0.3, 0] };
  character.motions.push(sitLoop, down, up);
  character.behaviourMotions = {
    rest: { motion: 'perch', from: 0, to: 2, speed: 1 },
    flee: { motion: 'hop', from: 0, to: 2.6, speed: 1 },
    approach: { motion: 'walk', from: 0, to: 1, speed: 1 },
    return: { motion: 'walk', from: 0, to: 1, speed: 1 },
  };
  const parsed = parseDesign(doc);
  const ids = characterOf(parsed).motions.map((m) => m.id);
  const frames = run(parsed, 700, (t) => (t < 1500 ? rush(t) : { x: 10, y: 10 }));
  // Sitting at rest; frightened, it springs away at once (no getting up first).
  expect(frames[3]!.clip).toBe(ids.indexOf('perch'));
  const fled = frames.findIndex((f) => f.clip === ids.indexOf('hop'));
  expect(fled).toBeGreaterThan(3);
  expect(frames.slice(0, fled).some((f) => f.clip === ids.indexOf('perch-up'))).toBe(false);
  // Home again, it sits down with the motion that lowers the hips (once, from its start), then sits.
  const lowering = frames.findIndex((f, i) => i > fled && f.clip === ids.indexOf('perch-down'));
  expect(lowering).toBeGreaterThan(fled);
  expect(frames[lowering]!.timeMs).toBeLessThan(40);
  const sat = frames.findIndex((f, i) => i > lowering && f.clip === ids.indexOf('perch'));
  expect((sat - lowering) * 16).toBeGreaterThanOrEqual(500 - 32);
  // A slow, curious pointer: it gets up with the motion that raises the hips, then walks.
  const curious = run(parsed, 300, (t) => ({ x: 550 - 260 + Math.min(t, 1500) * 0.1, y: 380 }));
  const rising = curious.findIndex((f) => f.clip === ids.indexOf('perch-up'));
  expect(rising).toBeGreaterThan(0);
  expect(curious.slice(rising).some((f) => f.clip === ids.indexOf('walk'))).toBe(true);
});

test('the author’s own timed motion comes first: no behaviour motion replaces it', () => {
  const doc = parseDesign(document(assignment));
  const layer = doc.decorations[0] as ModelDecoration;
  // The author plays the walk (a timed motion, not idle/sit) as the layer's clip.
  layer.model = { ...layer.model, clip: characterOf(doc).motions.findIndex((m) => m.id === 'walk'), playing: true };
  for (const f of run(doc, 120, rush)) expect(f.clip).toBe(layer.model.clip);
});
