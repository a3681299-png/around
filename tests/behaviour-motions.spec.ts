import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { migrateV14ToV15 } from '../src/design/migrations';
import { applyCharacterPatch, BEHAVIOUR_NAMES } from '../src/characters/settings';
import { BEHAVIOURS } from '../src/world/autonomy';
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

test('the author’s own timed motion comes first: no behaviour motion replaces it', () => {
  const doc = parseDesign(document(assignment));
  const layer = doc.decorations[0] as ModelDecoration;
  // The author plays the walk (a timed motion, not idle/sit) as the layer's clip.
  layer.model = { ...layer.model, clip: characterOf(doc).motions.findIndex((m) => m.id === 'walk'), playing: true };
  for (const f of run(doc, 120, rush)) expect(f.clip).toBe(layer.model.clip);
});
