// A day in the room, on a loop (docs/living-life.md): at the desk, then the phone, then off to
// the bed with it, lying on the front scrolling with the earphones in, legs swinging; back to the
// desk; and round again the other way (the phone left on the bed is picked up there and carried
// back to the desk). Pure: it watches what the body and the phone are doing and says, each frame,
// where to be and what the phone is for. The approach and the phone routine do the rest.
import type { ApproachPhase } from '../characters/approach';
import type { PhonePhase } from '../characters/phone-routine';

export type Place = 'chair' | 'bed';
export interface LifeOrders {
  step: string;
  seat: Place | undefined;
  use: boolean;
  buds: boolean;
  hold: boolean;
  /** Where the phone is put down (its rest) when it is let go. */
  restAt: Place;
}
export interface Seen {
  body: ApproachPhase;
  phone: PhonePhase;
  budsIn: boolean;
}

interface Step {
  name: string;
  seat: Place | undefined;
  use?: boolean;
  buds?: boolean;
  hold?: boolean;
  restAt?: Place;
  /** Done once this has been true for `after` seconds. */
  when: (seen: Seen) => boolean;
  after: number;
}

const always = () => true;
const DAY: Step[] = [
  { name: 'desk', seat: 'chair', when: (s) => s.body === 'sit', after: 2.5 },
  { name: 'desk phone', seat: 'chair', use: true, buds: true, when: (s) => s.phone === 'look' && s.budsIn, after: 9 },
  { name: 'stow', seat: 'chair', hold: true, when: (s) => s.phone === 'carry', after: 0.8 },
  { name: 'to bed', seat: 'bed', hold: true, when: (s) => s.body === 'lie', after: 1.2 },
  { name: 'bed phone', seat: 'bed', use: true, buds: true, when: (s) => s.phone === 'look' && s.budsIn, after: 11 },
  { name: 'buds out', seat: 'bed', use: true, buds: false, when: (s) => s.phone === 'look' && !s.budsIn, after: 4 },
  { name: 'put on bed', seat: 'bed', restAt: 'bed', when: (s) => s.phone === 'away', after: 2 },
  { name: 'lie', seat: 'bed', when: always, after: 3.5 },
  { name: 'back to desk', seat: 'chair', when: (s) => s.body === 'sit', after: 3 },
  { name: 'to bed again', seat: 'bed', when: (s) => s.body === 'lie', after: 1.5 },
  {
    name: 'bed phone again',
    seat: 'bed',
    use: true,
    buds: true,
    restAt: 'bed',
    when: (s) => s.phone === 'look' && s.budsIn,
    after: 9,
  },
  { name: 'take it along', seat: 'bed', hold: true, when: (s) => s.phone === 'carry', after: 0.8 },
  { name: 'to desk with it', seat: 'chair', hold: true, when: (s) => s.body === 'sit', after: 1.5 },
  {
    name: 'desk phone again',
    seat: 'chair',
    use: true,
    buds: true,
    when: (s) => s.phone === 'look' && s.budsIn,
    after: 8,
  },
  { name: 'put on desk', seat: 'chair', restAt: 'chair', when: (s) => s.phone === 'away', after: 2 },
];

export interface LifeState {
  step: number;
  /** Seconds the step's condition has held. */
  held: number;
  /** Where the phone lies when it is not in hand. */
  phoneAt: Place;
}

/** The day from one of its steps (the first by default), the phone lying at `phoneAt`. */
export const startLife = (step = 0, phoneAt: Place = 'chair'): LifeState => ({
  step: Math.min(DAY.length - 1, Math.max(0, Math.trunc(step))),
  held: 0,
  phoneAt,
});

export function stepLife(state: LifeState, seen: Seen, dt: number): LifeState {
  const step = DAY[state.step]!;
  const held = step.when(seen) ? state.held + Math.max(0, dt) : 0;
  let phoneAt = state.phoneAt;
  // The phone lies where it was last put down.
  if (seen.phone === 'away' && step.restAt) phoneAt = step.restAt;
  if (held >= step.after) return { step: (state.step + 1) % DAY.length, held: 0, phoneAt };
  return { ...state, held, phoneAt };
}

export function lifeOrders(state: LifeState): LifeOrders {
  const step = DAY[state.step]!;
  return {
    step: step.name,
    seat: step.seat,
    use: step.use ?? false,
    buds: step.buds ?? false,
    hold: step.hold ?? false,
    // Picked up from where it lies; put down where this step says, else where it lies.
    restAt: step.restAt ?? state.phoneAt,
  };
}

export const LIFE_STEPS = DAY.map((s) => s.name);
