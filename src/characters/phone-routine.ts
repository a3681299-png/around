/**
 * Using a phone with wired earphones (docs/living-life.md): picking it up, raising it to look at,
 * putting each earphone in with the other hand, scrolling and tapping, taking them out, putting
 * the phone down. Pure and deterministic, like approach.ts: it decides which hand goes where
 * (named places, resolved to the room by the page each frame: the phone's rest, the place in
 * front of the face it is held at, the buds, the ears), what each bud and the phone are held
 * by, and how bright the screen is. The body does it by IK; the page draws the phone.
 *
 * A hand's place is a move between two named places, `from` → `to`, `k` of the way there (eased
 * by the page), with a weight that blends it from the motion's own hand (0) to the place (1).
 */
import { draw } from '../world/room-life';

export type PhonePhase =
  'away' | 'pick' | 'raise' | 'look' | 'budOnL' | 'budOnR' | 'budOffR' | 'budOffL' | 'lower' | 'put' | 'carry';
/** Where a hand can be sent. `free` is wherever the motion has it. `grip` is the second hand on
 * the phone (beside the first, two-thumbed). */
export type HandPlace = 'free' | 'rest' | 'view' | 'grip' | 'budL' | 'budR' | 'earL' | 'earR';
export type Holder = 'phone' | 'hand' | 'ear';

export interface PhoneState {
  t: number;
  phase: PhonePhase;
  since: number;
  phone: 'rest' | 'hand';
  budL: Holder;
  budR: Holder;
  /** The numbers drawn so far (taps and two-handed spells come from a fixed sequence). */
  draws: number;
  /** The next tap and the end of the current one; a two-handed spell until `twoUntil`. */
  tapAt: number;
  tapUntil: number;
  twoAt: number;
  twoUntil: number;
  /** The second hand, eased, so it never jumps as a spell begins or ends. */
  two: number;
  /** A raise or a lowering that starts from the hand at the side (carried), not from the rest. */
  fromSide: boolean;
}

export interface PhoneInput {
  dt: number;
  /** Wanted in hand (else put down). */
  use: boolean;
  /** Earphones wanted in (only while the phone is in hand). */
  buds: boolean;
  /** Not in use, but kept in hand (carried at the side, screen off, the earphones left in): the
   * body is going somewhere else to use it. */
  hold?: boolean;
  seed?: number;
}

export interface HandAim {
  from: HandPlace;
  to: HandPlace;
  k: number;
  weight: number;
  /** Fingers closed round what the hand holds (0 open, 1 closed). */
  grip: number;
}

export interface PhoneIntent {
  phase: PhonePhase;
  phone: 'rest' | 'hand';
  budL: Holder;
  budR: Holder;
  left: HandAim;
  right: HandAim;
  /** 0 dark to 1 on. */
  screen: number;
  /** The thumb on the screen (a tap is a quick 0 → 1 → 0). */
  thumb: number;
  /** How much the eyes and head are on the phone. */
  look: number;
}

/** Seconds of each step. A bud: reach it, take it, carry it to the ear, let go, bring the hand back. */
export const PHONE = {
  pick: 0.9,
  pickGrab: 0.62,
  raise: 0.7,
  bud: { take: 0.45, carry: 1.0, back: 1.35 },
  budOff: { take: 0.45, carry: 0.95, back: 1.25 },
  lower: 0.6,
  /** Down to the side (carry), or back up from there. */
  stow: 0.6,
  put: 0.75,
  putLet: 0.45,
  tap: 0.17,
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (v: number) => v * v * (3 - 2 * v);

export const startPhone = (): PhoneState => ({
  t: 0,
  phase: 'away',
  since: 0,
  phone: 'rest',
  budL: 'phone',
  budR: 'phone',
  draws: 0,
  tapAt: 0,
  tapUntil: 0,
  twoAt: 0,
  twoUntil: 0,
  two: 0,
  fromSide: false,
});

export function stepPhone(state: PhoneState, input: PhoneInput): PhoneState {
  const dt = Math.min(0.25, Math.max(0, Number.isFinite(input.dt) ? input.dt : 0));
  let s: PhoneState = { ...state, t: state.t + dt };
  const seed = input.seed ?? 7;
  const next = () => draw(seed, s.draws++);
  const elapsed = s.t - s.since;
  const begin = (phase: PhonePhase, extra: Partial<PhoneState> = {}) => {
    s = { ...s, phase, since: s.t, ...extra };
  };
  const worn = s.budL === 'ear' || s.budR === 'ear';
  // What comes after the phone is up and on, or after a bud move: the next bud move or using it.
  const onward = () => {
    // Kept in hand to go elsewhere: down to the side as it is, earphones and all.
    if (!input.use && input.hold) return begin('carry');
    if (!input.use) {
      if (s.budR === 'ear') return begin('budOffR');
      if (s.budL === 'ear') return begin('budOffL');
      return begin('lower');
    }
    if (input.buds && s.budL !== 'ear') return begin('budOnL');
    if (input.buds && s.budR !== 'ear') return begin('budOnR');
    if (!input.buds && s.budR === 'ear') return begin('budOffR');
    if (!input.buds && s.budL === 'ear') return begin('budOffL');
    begin('look', { tapAt: s.t + 0.6 + next() * 0.8, twoAt: s.t + 1.5 + next() * 2 });
  };
  switch (s.phase) {
    case 'away':
      if (input.use) begin('pick');
      break;
    case 'pick':
      if (elapsed >= PHONE.pickGrab && s.phone === 'rest') s = { ...s, phone: 'hand' };
      if (elapsed >= PHONE.pick) begin('raise', { fromSide: false });
      break;
    case 'raise':
      if (elapsed >= (s.fromSide ? PHONE.stow : PHONE.raise)) onward();
      break;
    case 'carry':
      // Brought back up to be used here, or to have its earphones taken out before it is put down.
      if (elapsed >= PHONE.stow && (input.use || !input.hold)) begin('raise', { fromSide: true });
      break;
    case 'look': {
      // Taps now and then; now and then the other hand comes to it (two thumbs) for a while.
      if (s.t >= s.tapAt) s = { ...s, tapUntil: s.t + PHONE.tap, tapAt: s.t + PHONE.tap + 0.45 + next() * 1.6 };
      if (s.t >= s.twoAt) {
        const spell = 1.6 + next() * 2.6;
        s = { ...s, twoUntil: s.t + spell, twoAt: s.t + spell + 2.5 + next() * 4 };
      }
      const wantTwo = s.t < s.twoUntil ? 1 : 0;
      s = { ...s, two: s.two + (wantTwo - s.two) * (1 - Math.exp(-6 * dt)) };
      const change = !input.use || input.buds !== worn || (input.buds && !(s.budL === 'ear' && s.budR === 'ear'));
      // The second hand lets go before anything else is done.
      if (change && s.two < 0.05) {
        s = { ...s, two: 0, twoUntil: 0 };
        onward();
      } else if (change) s = { ...s, twoUntil: 0 };
      break;
    }
    case 'budOnL':
    case 'budOnR':
    case 'budOffL':
    case 'budOffR': {
      const on = s.phase === 'budOnL' || s.phase === 'budOnR';
      const key = s.phase.endsWith('L') ? 'budL' : 'budR';
      const beats = on ? PHONE.bud : PHONE.budOff;
      // Taken at the end of the reach, let go at the end of the carry.
      if (elapsed >= beats.take && elapsed < beats.carry && s[key] !== 'hand') s = { ...s, [key]: 'hand' };
      if (elapsed >= beats.carry && s[key] === 'hand') s = { ...s, [key]: on ? 'ear' : 'phone' };
      if (elapsed >= beats.back) onward();
      break;
    }
    case 'lower':
      if (elapsed >= PHONE.lower) begin('put');
      break;
    case 'put':
      if (elapsed >= PHONE.putLet && s.phone === 'hand') s = { ...s, phone: 'rest' };
      if (elapsed >= PHONE.put) begin(input.use ? 'pick' : 'away');
      break;
  }
  return s;
}

const still = (place: HandPlace, weight: number, grip: number): HandAim => ({
  from: place,
  to: place,
  k: 1,
  weight,
  grip,
});

export function phoneIntent(s: PhoneState): PhoneIntent {
  const elapsed = s.t - s.since;
  const over = (from: number, to: number) => ease(clamp01((elapsed - from) / (to - from)));
  let left: HandAim = still('free', 0, 0);
  let right: HandAim = still('view', 1, 1);
  let screen = 1,
    thumb = 0,
    look = 1;
  switch (s.phase) {
    case 'away':
      right = still('free', 0, 0);
      screen = 0;
      look = 0;
      break;
    case 'pick':
      // Out to the phone, fingers closing on it as the hand arrives.
      right = {
        from: 'rest',
        to: 'rest',
        k: 1,
        weight: over(0, PHONE.pickGrab),
        grip: over(PHONE.pickGrab - 0.12, PHONE.pickGrab + 0.1),
      };
      screen = 0;
      look = over(0, 0.3);
      break;
    case 'raise':
      // From the rest along the way up; or, carried, from the side (the motion's own hand).
      right = s.fromSide
        ? { from: 'view', to: 'view', k: 1, weight: over(0, PHONE.stow), grip: 1 }
        : { from: 'rest', to: 'view', k: over(0, PHONE.raise), weight: 1, grip: 1 };
      screen = s.fromSide ? over(PHONE.stow * 0.5, PHONE.stow) : over(PHONE.raise * 0.5, PHONE.raise);
      break;
    case 'carry':
      // Down to the side, the screen off; it swings with the walk in the closed hand.
      right = { from: 'view', to: 'view', k: 1, weight: 1 - over(0, PHONE.stow), grip: 1 };
      screen = 1 - over(0, PHONE.stow * 0.5);
      look = 1 - over(0, PHONE.stow * 0.7);
      break;
    case 'look':
      left = { from: 'grip', to: 'grip', k: 1, weight: ease(clamp01(s.two)), grip: ease(clamp01(s.two)) };
      thumb = s.t < s.tapUntil ? Math.sin((Math.PI * (s.tapUntil - s.t)) / PHONE.tap) : 0;
      break;
    case 'budOnL':
    case 'budOnR':
    case 'budOffL':
    case 'budOffR': {
      const on = s.phase === 'budOnL' || s.phase === 'budOnR';
      const side = s.phase.endsWith('L') ? 'L' : 'R';
      const b = on ? PHONE.bud : PHONE.budOff;
      // On: the bud is on the phone, goes to the ear. Off: from the ear back to the phone.
      const pickAt: HandPlace = on ? (side === 'L' ? 'budL' : 'budR') : side === 'L' ? 'earL' : 'earR';
      const putAt: HandPlace = on ? (side === 'L' ? 'earL' : 'earR') : side === 'L' ? 'budL' : 'budR';
      if (elapsed < b.take)
        left = { from: pickAt, to: pickAt, k: 1, weight: over(0, b.take), grip: over(b.take - 0.1, b.take) };
      else if (elapsed < b.carry) left = { from: pickAt, to: putAt, k: over(b.take, b.carry), weight: 1, grip: 1 };
      else
        left = {
          from: putAt,
          to: putAt,
          k: 1,
          weight: 1 - over(b.carry, b.back),
          grip: 1 - over(b.carry, b.carry + 0.12),
        };
      // The eyes follow the bud to the ear and come back to the phone.
      look = 1 - 0.6 * over(b.take * 0.5, b.take + 0.2) * (1 - over(b.carry, b.back));
      break;
    }
    case 'lower':
      right = { from: 'view', to: 'rest', k: over(0.1, PHONE.lower), weight: 1, grip: 1 };
      screen = 1 - over(0, PHONE.lower * 0.6);
      look = 1 - over(PHONE.lower * 0.5, PHONE.lower);
      break;
    case 'put':
      right = {
        from: 'rest',
        to: 'rest',
        k: 1,
        weight: 1 - over(PHONE.putLet, PHONE.put),
        grip: 1 - over(PHONE.putLet - 0.1, PHONE.putLet + 0.05),
      };
      screen = 0;
      look = 1 - over(0, 0.3);
      break;
  }
  return { phase: s.phase, phone: s.phone, budL: s.budL, budR: s.budR, left, right, screen, thumb, look };
}
