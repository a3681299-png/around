/**
 * What the resident does with music (docs/living-live.md): it listens to a quiet song, sways to a
 * livelier one, dances to a loud one. It does not flicker between two of them at the edge (it
 * takes a moment of a new liveliness to change, and longer to stop than to start: a song's short
 * breath is danced through), and how it feels is in it: cross or worn out, it only listens; glad,
 * it dances sooner. A rise out of a quiet passage is a moment of its own (`drop`).
 *
 * Pure: the music's liveliness in, what the body is to do out.
 */
export type LiveMove = 'listen' | 'sway' | 'dance';

export interface LiveMoodState {
  move: LiveMove;
  /** 0–1, eased: how much of the dance is in the body, and how much it moves to the beat at all. */
  dance: number;
  groove: number;
  /** True for the one step in which the music rose out of a quiet passage into a dance. */
  drop: boolean;
  // (What it keeps.)
  heard: number;
  above: number;
  below: number;
  quiet: number;
}

export interface LiveMoodInput {
  dt: number;
  /** 0–1: the music's liveliness (beat.ts). */
  energy: number;
  /** 0–1 each: how cross, how worn out, how glad it is. */
  grump: number;
  tired: number;
  joy: number;
}

export const startLiveMood = (): LiveMoodState => ({
  move: 'listen',
  dance: 0,
  groove: 0,
  drop: false,
  heard: 0,
  above: 0,
  below: 0,
  quiet: 0,
});

const SWAY_AT = 0.32;
const DANCE_AT = 0.64;
/** Seconds a livelier music must last before it is taken up, and a quieter one before it is let go. */
const TAKE_UP_S = 0.8;
const LET_GO_S = 2.5;
const RANK: Record<LiveMove, number> = { listen: 0, sway: 1, dance: 2 };
const GROOVE: Record<LiveMove, number> = { listen: 0.3, sway: 0.85, dance: 1 };

export function stepLiveMood(state: LiveMoodState, input: LiveMoodInput): LiveMoodState {
  const dt = Math.min(0.25, Math.max(0, input.dt));
  const heard = state.heard + (input.energy - state.heard) * (1 - Math.exp(-dt / 0.5));
  // Glad, it dances to less.
  const danceAt = DANCE_AT - 0.14 * Math.min(1, Math.max(0, input.joy));
  // Cross or worn out, it will not be moved (it still listens).
  const unwilling = input.grump > 0.5 || input.tired > 0.75;
  const wanted: LiveMove = unwilling ? 'listen' : heard >= danceAt ? 'dance' : heard >= SWAY_AT ? 'sway' : 'listen';
  // What it would stay in, given the benefit of the doubt (well under the edge before it lets go).
  const kept: LiveMove = unwilling
    ? 'listen'
    : heard >= danceAt - 0.16
      ? 'dance'
      : heard >= SWAY_AT - 0.08
        ? 'sway'
        : 'listen';
  let { move } = state;
  let above = RANK[wanted] > RANK[move] ? state.above + dt : 0;
  let below = RANK[kept] < RANK[move] ? state.below + dt : 0;
  let drop = false;
  const quiet = heard < 0.3 ? state.quiet + dt : state.quiet;
  let quietLeft = quiet;
  if (above >= TAKE_UP_S || (unwilling && move !== 'listen')) {
    // Out of a quiet passage straight into a dance: the song's big moment.
    drop = wanted === 'dance' && quiet >= 3;
    if (wanted === 'dance') quietLeft = 0;
    move = wanted;
    above = below = 0;
  } else if (below >= LET_GO_S) {
    move = kept;
    above = below = 0;
  }
  const ease = (from: number, to: number, seconds: number) => from + (to - from) * (1 - Math.exp(-dt / seconds));
  return {
    move,
    dance: ease(state.dance, move === 'dance' ? 1 : 0, 0.7),
    groove: ease(state.groove, GROOVE[move], 0.9),
    drop,
    heard,
    above,
    below,
    quiet: quietLeft,
  };
}
