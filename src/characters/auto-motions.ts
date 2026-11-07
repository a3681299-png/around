import { BEHAVIOUR_NAMES, type BehaviourMotions, type CharacterMotion, type MotionRole } from './settings';
import type { VrmAnimationInfo } from './motion-info';

/**
 * Reading motions with nothing set (docs/product-design-snapshot.md, "読み込むだけで、感情に応じて
 * 動く"): each imported motion's role and feel from its name (the names libraries commonly use:
 * Idle, Walking, Jog, Sitting, Jump, Hit, Dance…) and from what the file itself measures (the hips'
 * travel, a one-frame pose). Where they disagree the measurement wins; a motion neither explains is
 * a gesture, held back (low confidence). Only the existing data comes out of it (a role, a loop
 * flag, the behaviours' motions): no new fields, so the artwork's version does not change.
 */
export type MotionKind =
  'idle' | 'walk' | 'run' | 'sit' | 'sleep' | 'pose' | 'jump' | 'surprise' | 'happy' | 'talk' | 'gesture';
export interface MotionGuess {
  role: MotionRole;
  kind: MotionKind;
  loop: boolean;
  /** 0…1: a known name that the measurement agrees with is near 1; an unknown name is low. */
  confidence: number;
}

/** In order: the first that matches a word of the name decides. */
const NAMES: [RegExp, MotionRole, MotionKind][] = [
  [/^(sleep|sleeping|asleep|doze|dozing|nap|lying|lie|laying)$/, 'sit', 'sleep'],
  [/^(sit|sits|sitting|seated)$/, 'sit', 'sit'],
  [/^(jump|jumping|hop|hopping)$/, 'react', 'jump'],
  [/^(hit|surprise|surprised|scared|shock|shocked|flinch|startle|startled)$/, 'react', 'surprise'],
  [/^(dance|dancing|cheer|cheering|happy|celebrate|celebration|victory|joy)$/, 'dance', 'happy'],
  [/^(run|running|jog|jogging|sprint|sprinting)$/, 'move', 'run'],
  [/^(walk|walking|stroll|strolling)$/, 'move', 'walk'],
  [/^(talk|talking|chat|chatting)$/, 'gesture', 'talk'],
  [
    /^(wave|waving|interact|point|pointing|beckon|beckoning|spell|gesture|clap|clapping|greet|greeting)$/,
    'gesture',
    'gesture',
  ],
  [/^(idle|bored|stand|standing|breathe|breathing|wait|waiting)$/, 'idle', 'idle'],
];
/** One-time parts of a motion: they play once, never loop. */
const ONCE = /^(enter|exit|start|land|landing|end|stop|in|out|once)$/;
/** Hips travel per second, in rest hips heights, above which a motion moves the body. */
const MOVING = 0.3;
const RUNNING = 1.5;

const words = (name: string) =>
  name
    .replace(/\.vrma$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

export function classifyMotion(name: string, info: VrmAnimationInfo): MotionGuess {
  if (info.duration === 0) return { role: 'sit', kind: 'pose', loop: true, confidence: 0.9 };
  const w = words(name);
  const named = NAMES.find(([pattern]) => w.some((word) => pattern.test(word)));
  const loopWord = w.includes('loop'),
    once = w.some((word) => ONCE.test(word));
  const [x, , z] = info.hipsTravel;
  const speed = Math.hypot(x, z) / Math.max(1e-6, info.duration) / Math.max(1e-6, info.restHipsHeight);
  const moves = speed > MOVING;
  let role: MotionRole, kind: MotionKind, confidence: number;
  if (named) {
    [, role, kind] = named;
    confidence = 0.8;
    if (moves && role !== 'move' && role !== 'react') {
      // Named to stand, but the hips go somewhere: it moves (the measurement wins).
      role = 'move';
      kind = speed > RUNNING ? 'run' : 'walk';
      confidence = 0.6;
    } else if (moves && role === 'move') confidence = 0.9;
  } else if (moves) {
    role = 'move';
    kind = speed > RUNNING ? 'run' : 'walk';
    confidence = 0.6;
  } else {
    role = 'gesture';
    kind = 'gesture';
    confidence = 0.3;
  }
  const loop = !once && (loopWord || !(role === 'react' || (role === 'gesture' && kind === 'gesture')));
  return { role, kind, loop, confidence };
}

/** How well a motion fits a behaviour: higher is better, 0 does not fit. */
function fit(behaviour: (typeof BEHAVIOUR_NAMES)[number], m: CharacterMotion, guess: MotionGuess): number {
  if (!m.loop || !(m.source.duration > 0)) return 0;
  // Of equals, the plainest name: "walk-loop" before "walk-formal-loop".
  const plain = 1 / (1 + m.id.length / 40) + guess.confidence;
  switch (behaviour) {
    case 'rest':
      // At home it sits on the edge (the engine seats a sitting role there, chunk 3's corner);
      // without a sitting loop, it stands idle.
      return m.role === 'sit' && guess.kind === 'sit'
        ? 4 + plain
        : m.role === 'idle'
          ? (guess.kind === 'idle' ? 2 : 1) + plain
          : 0;
    case 'flee':
      return m.role === 'move' ? (guess.kind === 'run' ? 2 : 1) + plain : 0;
    case 'approach':
      // A curious creep: a walk only (a run toward the pointer reads as a charge).
      return m.role === 'move' && guess.kind === 'walk' ? 2 + plain : 0;
    case 'return':
      return m.role === 'move' ? (guess.kind === 'walk' ? 2 : 1) + plain : 0;
    case 'doze':
      return guess.kind === 'sleep' ? 3 + plain : m.role === 'sit' ? 1 + plain : 0;
  }
}

/**
 * The motion each autonomy behaviour plays, for the behaviours the author has not set: the whole
 * motion at its own speed. Behaviours nothing fits stay unset (the computed motion plays).
 */
export function assignBehaviours(
  motions: readonly CharacterMotion[],
  existing: BehaviourMotions | undefined,
): BehaviourMotions {
  const out: BehaviourMotions = { ...existing };
  const guesses = new Map(motions.map((m) => [m.id, classifyMotion(m.id, m.source)]));
  for (const behaviour of BEHAVIOUR_NAMES) {
    if (out[behaviour]) continue;
    let best: CharacterMotion | undefined,
      score = 0;
    for (const m of motions) {
      const s = fit(behaviour, m, guesses.get(m.id)!);
      if (s > score) [best, score] = [m, s];
    }
    // Rounded down: the part must end inside the motion (1.6667 s rounded to 1.67 is refused).
    if (best)
      out[behaviour] = { motion: best.id, from: 0, to: Math.floor(best.source.duration * 100 + 1e-6) / 100, speed: 1 };
  }
  return out;
}

/**
 * The behaviours after more motions arrive (a folder can come in several reads). A row equal to
 * what the earlier motions gave automatically was never the author's: it is picked again from the
 * whole set. A row that differs is the author's and stays. Nothing extra is stored to tell them
 * apart (the artwork's version does not change).
 */
export function reassignBehaviours(
  before: readonly CharacterMotion[],
  after: readonly CharacterMotion[],
  current: BehaviourMotions | undefined,
): BehaviourMotions {
  const automatic = assignBehaviours(before, undefined);
  const authored: BehaviourMotions = {};
  for (const name of BEHAVIOUR_NAMES) {
    const row = current?.[name],
      auto = automatic[name];
    const same =
      row &&
      auto &&
      row.motion === auto.motion &&
      row.from === auto.from &&
      row.to === auto.to &&
      row.speed === auto.speed;
    if (row && !same) authored[name] = row;
  }
  return assignBehaviours(after, authored);
}
