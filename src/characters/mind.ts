/**
 * The resident's mind (docs/living-mind.md): what it wants, how it feels, what just happened to
 * it, and from those what it does next. A small utility AI: every activity it could take up is
 * given a score from its needs, its feelings and what the world offers, and the best one wins,
 * with a little noise from a fixed sequence (the seed and a count), so a day can always be
 * played again exactly but no two days with different seeds are alike. Pure: no clock of its own,
 * no randomness, no DOM.
 *
 * Needs drift with what it is doing (lying asleep rests it, play tires and delights it); feelings
 * are set by events (thrown off a window, petted, teased) and fade; a short memory of events
 * colours the next choices (thrown off twice, it sulks); `affinity` is the long memory of how the
 * viewer has treated it, kept across visits by the page.
 */
import { draw } from '../world/room-life';

export type Activity =
  'nap' | 'bedPhone' | 'computer' | 'floorSit' | 'sulk' | 'play' | 'inspect' | 'shove' | 'tug' | 'perch' | 'knock';

export type MindEvent =
  | 'uiOpened'
  | 'uiClosed'
  | 'thrown'
  | 'whoosh'
  | 'teased'
  | 'petted'
  | 'batted'
  | 'touched'
  | 'knocked'
  | 'woken'
  | 'lost';

export interface Mind {
  t: number;
  draws: number;
  /** 1 rested … 0 worn out. */
  energy: number;
  /** 0–1 each: nothing to do, wanting to look into things, wanting the viewer's company. */
  boredom: number;
  curiosity: number;
  social: number;
  /** Feelings, 0–1, fading. */
  joy: number;
  grump: number;
  surprise: number;
  confusion: number;
  /** −1 wary … 1 fond: how the viewer has treated it, over visits. */
  affinity: number;
  /** What happened lately (the newest last), and what it did lately. */
  recent: readonly { kind: MindEvent; t: number }[];
  did: readonly Activity[];
}

/** What the world offers right now. */
export interface Offer {
  uiOpen: boolean;
  /** A window whose frame a hand can reach; one it could sit on; a ball it can get to. */
  window: boolean;
  perch: boolean;
  ball: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const startMind = (seed = 1, affinity = 0): Mind => ({
  t: 0,
  draws: seed >>> 0,
  energy: 0.72,
  boredom: 0.5,
  curiosity: 0.55,
  // A visitor: it wants to say hello before long (a fond one sooner).
  social: 0.72 + 0.15 * Math.max(0, affinity),
  joy: 0,
  grump: 0,
  surprise: 0,
  confusion: 0,
  affinity: Math.min(1, Math.max(-1, affinity)),
  recent: [],
  did: [],
});

/** Per second, by what it is doing (`settled`: it has got there and is at it). */
const DRIFT: Record<Activity, { energy: number; boredom: number; curiosity: number }> = {
  // (A day in a few minutes: an afternoon's play tires it in about three; a nap mends it in under one.)
  nap: { energy: 1 / 38, boredom: 0, curiosity: 1 / 120 },
  bedPhone: { energy: -1 / 700, boredom: -1 / 120, curiosity: 1 / 45 },
  computer: { energy: -1 / 600, boredom: -1 / 50, curiosity: -1 / 60 },
  floorSit: { energy: 1 / 400, boredom: 1 / 28, curiosity: 1 / 40 },
  sulk: { energy: 1 / 400, boredom: 1 / 60, curiosity: 0 },
  play: { energy: -1 / 110, boredom: -1 / 22, curiosity: -1 / 150 },
  inspect: { energy: -1 / 400, boredom: -1 / 40, curiosity: -1 / 40 },
  shove: { energy: -1 / 300, boredom: -1 / 30, curiosity: -1 / 40 },
  tug: { energy: -1 / 300, boredom: -1 / 30, curiosity: -1 / 40 },
  perch: { energy: -1 / 500, boredom: -1 / 45, curiosity: -1 / 80 },
  knock: { energy: -1 / 600, boredom: -1 / 60, curiosity: 0 },
};

export function stepMind(mind: Mind, dt: number, doing: Activity, settled: boolean): Mind {
  const d = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const drift = DRIFT[doing];
  // On the way somewhere, only the slow background drifts apply.
  const k = settled ? 1 : 0.25;
  return {
    ...mind,
    t: mind.t + d,
    energy: clamp01(mind.energy + drift.energy * (drift.energy > 0 ? k : 1) * d),
    // (Both creep back up by themselves, whatever it is doing: nothing satisfies for ever.)
    boredom: clamp01(mind.boredom + (drift.boredom * k + 1 / 45) * d),
    curiosity: clamp01(mind.curiosity + (drift.curiosity * k + 1 / 110) * d),
    social: clamp01(mind.social + d / 110),
    joy: clamp01(mind.joy - d / 18),
    grump: clamp01(mind.grump - d / (doing === 'sulk' ? 16 : 45)),
    surprise: clamp01(mind.surprise - d / 1.6),
    confusion: clamp01(mind.confusion - d / 5),
  };
}

/** How many of an event it remembers from the last `seconds`. */
export const remembers = (mind: Mind, kind: MindEvent, seconds = 90) =>
  mind.recent.filter((e) => e.kind === kind && mind.t - e.t <= seconds).length;

/** Something happened to it. */
export function feel(mind: Mind, kind: MindEvent): Mind {
  const m = { ...mind, recent: [...mind.recent.slice(-11), { kind, t: mind.t }] };
  const again = remembers(mind, kind);
  switch (kind) {
    case 'uiOpened':
      return { ...m, curiosity: clamp01(m.curiosity + 0.4), surprise: clamp01(m.surprise + 0.5) };
    case 'uiClosed':
      return { ...m, curiosity: clamp01(m.curiosity - 0.2) };
    case 'thrown':
      // Once, with a friend, is a ride. Again, or with someone it is wary of, is rude.
      return again === 0 && m.affinity > -0.2
        ? { ...m, surprise: 1, joy: clamp01(m.joy + 0.45), confusion: clamp01(m.confusion + 0.5) }
        : { ...m, surprise: 1, grump: clamp01(m.grump + 0.55), affinity: Math.max(-1, m.affinity - 0.08) };
    case 'whoosh':
      return { ...m, surprise: 1, grump: clamp01(m.grump + (again > 1 ? 0.3 : 0.05)) };
    case 'teased':
      return {
        ...m,
        confusion: clamp01(m.confusion + 0.7),
        grump: clamp01(m.grump + (again > 1 ? 0.45 : 0.08)),
        curiosity: clamp01(m.curiosity + 0.1),
      };
    case 'petted':
      return {
        ...m,
        joy: clamp01(m.joy + 0.6),
        grump: clamp01(m.grump - 0.5),
        social: clamp01(m.social - 0.5),
        affinity: Math.min(1, m.affinity + 0.06),
      };
    case 'batted':
      return { ...m, joy: clamp01(m.joy + 0.3), boredom: clamp01(m.boredom - 0.12) };
    case 'touched':
      return { ...m, curiosity: clamp01(m.curiosity - 0.35), joy: clamp01(m.joy + 0.1) };
    case 'knocked':
      return { ...m, social: clamp01(m.social - 0.75) };
    case 'woken':
      // Woken before it was rested: cross. Rested enough: only startled.
      return { ...m, surprise: 1, grump: clamp01(m.grump + (m.energy < 0.6 ? 0.5 : 0.1)) };
    case 'lost':
      return { ...m, confusion: clamp01(m.confusion + 0.8), curiosity: clamp01(m.curiosity - 0.25) };
  }
}

/** Every activity's score now (0 where the world does not offer it). */
export function scores(mind: Mind, offer: Offer): Record<Activity, number> {
  const m = mind;
  const tired = 1 - m.energy;
  const awake = m.energy > 0.22 ? 1 : 0.35;
  const thrown = remembers(m, 'thrown', 60);
  const out: Record<Activity, number> = {
    // Sleep is nothing to it while it is fresh and everything once it is worn out.
    nap: 1.6 * tired ** 2.4 + (tired > 0.8 ? 0.6 : 0),
    bedPhone: 0.34 + 0.22 * m.boredom + 0.2 * tired - 0.25 * m.curiosity,
    computer: awake * (0.55 * m.boredom + 0.45 * m.curiosity + (offer.uiOpen ? 0 : 0.18)),
    floorSit: 0.22 + 0.15 * m.boredom,
    sulk: m.grump > 0.5 ? 0.6 + m.grump : 0,
    play: offer.ball ? awake * (0.45 + 0.5 * m.boredom + 0.3 * m.joy - 0.4 * m.grump) : 0,
    inspect: offer.window ? awake * (0.95 * m.curiosity - 0.3 * m.grump) : 0,
    shove: offer.window ? awake * (0.35 * m.curiosity + 0.9 * m.grump + 0.2 * m.boredom) : 0,
    tug: offer.window ? awake * (0.5 * m.curiosity + 0.3 * m.joy - 0.2 * m.grump) : 0,
    perch: offer.perch ? awake * (0.42 + 0.4 * m.joy + 0.25 * m.curiosity - 0.35 * thrown - 0.5 * m.grump) : 0,
    knock: awake * (m.social * (1 + 0.25 * m.affinity) - 0.6 * m.grump),
  };
  // What it has just done is less inviting (sleep and sulking aside: those end by themselves).
  m.did.slice(-4).forEach((activity, i, all) => {
    if (activity !== 'nap' && activity !== 'sulk') out[activity] -= 0.2 + 0.2 * (i === all.length - 1 ? 1 : 0);
  });
  return out;
}

/** What it takes up next (and the mind with that written down). */
export function choose(mind: Mind, offer: Offer): { mind: Mind; activity: Activity } {
  const scored = scores(mind, offer);
  let best: Activity = 'floorSit',
    top = -Infinity,
    draws = mind.draws;
  for (const activity of Object.keys(scored) as Activity[]) {
    const score = scored[activity];
    if (score <= 0) continue;
    const noisy = score + 0.14 * draw(mind.draws, ++draws);
    if (noisy > top) {
      top = noisy;
      best = activity;
    }
  }
  return { mind: { ...mind, draws, did: [...mind.did.slice(-5), best] }, activity: best };
}

export type Mood = 'sleepy' | 'grumpy' | 'surprised' | 'confused' | 'happy' | 'calm';
/** The feeling that shows. */
export function moodOf(mind: Mind): Mood {
  if (mind.surprise > 0.45) return 'surprised';
  if (mind.grump > 0.45) return 'grumpy';
  if (mind.confusion > 0.45) return 'confused';
  if (mind.joy > 0.4) return 'happy';
  if (mind.energy < 0.3) return 'sleepy';
  return 'calm';
}
