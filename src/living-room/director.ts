/**
 * The director (docs/living-mind.md): turns what the resident's mind takes up (src/characters/
 * mind.ts) into orders for its body, its phone and the desktop, frame by frame, and tells the
 * mind what happened. It replaces the fixed loop of a day: nothing here is a timetable.
 *
 * One event runs through everything. The resident sits at the desk and turns the desktop on: the
 * room is lit from the front, a window opens, the wallpaper is set to how it feels, a ball
 * appears, it chases the ball across the floor and bats it, hops onto a window and rides it while
 * the viewer drags it, is thrown off, sulks with its back turned, is petted, forgives.
 *
 * Pure: it sees the body's phase, the phone's and what the desktop offers, and answers with
 * orders. The page (resident.ts) carries them out.
 */
import type { ApproachPhase } from '../characters/approach';
import type { PhonePhase } from '../characters/phone-routine';
import type { Vec3 } from '../characters/two-bone-ik';
import { draw } from '../world/room-life';
import {
  choose,
  feel,
  moodOf,
  remembers,
  startMind,
  stepMind,
  type Activity,
  type Mind,
  type MindEvent,
  type Mood,
} from '../characters/mind';

/** A thing of the desktop the body can come to: where a hand reaches it, where one sits on it. */
export interface StageThing {
  hand?: Vec3;
  perch?: { at: Vec3; heading: number };
  /** How fast it is moving over the screen (CSS pixels a second), and whether the viewer holds it. */
  speed: number;
  held: boolean;
}
export interface StageView {
  open: boolean;
  window?: StageThing;
  ball?: StageThing;
}
/** What the resident does to the desktop. */
export type StageAct =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'app'; id: 'ambience' | 'resident' | 'ball' }
  | { type: 'wallpaper'; index: number }
  | { type: 'impulse'; thing: 'window' | 'ball'; kind: 'nudge' | 'push' | 'pull' | 'bat' }
  | { type: 'knock' }
  | { type: 'sit'; on: boolean };

export type Emote = 'zzz' | 'bang' | 'what' | 'note' | 'anger' | 'heart' | 'dots';

export interface Seen {
  dt: number;
  body: ApproachPhase;
  phone: PhonePhase;
  stage: StageView;
  /** Its hand landed on what it was reaching for, this frame. */
  landed: boolean;
  /** What happened to it since the last frame (petted, a window flew past…). */
  events: readonly MindEvent[];
  /** Where it knocks on the screen from (a point in front of its place at the room's front). */
  knockAt: Vec3;
}

export interface Orders {
  activity: Activity;
  seat: 'bed' | 'chair' | 'floor' | undefined;
  /** Sitting with its back to the viewer (sulking). */
  backTurned: boolean;
  asleep: boolean;
  phone: 'rest' | 'use' | 'hold';
  /** A point to walk up to and put a hand on; `eager` darts at it. */
  touch: Vec3 | undefined;
  eager: boolean;
  perch: { at: Vec3; heading: number } | undefined;
  /** Thrown off its perch, this frame. */
  tumble: boolean;
  /** Something to keep the eyes on. */
  look: Vec3 | undefined;
  feel: { sleepy: number; grumpy: number; confused: number; surprised: number; joy: number };
  emote: Emote | undefined;
  acts: StageAct[];
  says: string;
  mood: Mood;
}

export interface DirectorState {
  mind: Mind;
  activity: Activity;
  /** Seconds in this activity, and since the body settled into it (0 until then). */
  time: number;
  doing: number;
  step: number;
  count: number;
  /** How long this one lasts (drawn when it began). */
  until: number;
  /** The next activity, waiting for the phone to be put down first. */
  next: Activity | undefined;
  /** The resident itself turned the desktop on (it turns it off before it sleeps). */
  openedIt: boolean;
  wasOpen: boolean;
  /** Seconds without what the activity needs; seconds since the hand landed (−1: not yet). */
  lost: number;
  landedFor: number;
  teased: boolean;
  tumbled: boolean;
  flash: Emote | undefined;
  flashLeft: number;
  /** The last perch it was given (kept while it climbs down). */
  perch: { at: Vec3; heading: number } | undefined;
}

/** A window moving faster than this throws off whoever sits on it (CSS pixels a second). */
export const THROW_SPEED = 1250;
/** A thing moving slower than this can be walked up to (it is watched until then). */
const CATCHABLE = 260;
/** How long it tries for a thing it cannot reach before it gives up (seconds). */
const GIVE_UP_S = 3.2;

export const startDirector = (seed = 1, affinity = 0): DirectorState => {
  return {
    // The page opens on it lying with its phone: that is the room at rest.
    mind: { ...startMind(seed, affinity), did: ['bedPhone'] },
    activity: 'bedPhone',
    time: 0,
    doing: 0,
    step: 0,
    count: 0,
    until: 9,
    next: undefined,
    openedIt: false,
    wasOpen: false,
    lost: 0,
    landedFor: -1,
    teased: false,
    tumbled: false,
    flash: undefined,
    flashLeft: 0,
    perch: undefined,
  };
};

const SEAT: Partial<Record<Activity, Orders['seat']>> = {
  nap: 'bed',
  bedPhone: 'bed',
  computer: 'chair',
  floorSit: 'floor',
  sulk: 'floor',
};
const SETTLED: Record<NonNullable<Orders['seat']>, ApproachPhase> = { bed: 'lie', chair: 'sit', floor: 'sit' };
const SAYS: Record<Activity, string> = {
  nap: 'すやすや眠っている',
  bedPhone: 'ベッドでスマホを見ている',
  computer: 'パソコンをさわっている',
  floorSit: '床でひと息ついている',
  sulk: 'すねて背を向けている',
  play: 'ボールを追いかけている',
  inspect: '窓が気になっている',
  shove: '窓を押しのけている',
  tug: '窓を引っぱっている',
  perch: '窓の上に座っている',
  knock: '画面をコンコン叩いている',
};

/** The wallpaper that suits how it feels (an index into the desktop's wallpapers). */
function wallpaperFor(mind: Mind): number {
  if (mind.grump > 0.4) return 3;
  if (mind.joy > 0.35) return 5;
  if (mind.energy < 0.35) return 0;
  return [1, 2, 4][Math.floor(draw(mind.draws, 7001) * 3)] ?? 1;
}

export function stepDirector(state: DirectorState, seen: Seen): { state: DirectorState; orders: Orders } {
  const dt = Math.min(0.25, Math.max(0, seen.dt));
  let s: DirectorState = { ...state, time: state.time + dt, flashLeft: Math.max(0, state.flashLeft - dt) };
  let mind = s.mind;
  const acts: StageAct[] = [];
  const { stage } = seen;
  const flash = (emote: Emote, seconds: number) => {
    s = { ...s, flash: emote, flashLeft: seconds };
  };

  // --- what happened ---------------------------------------------------------------------------
  const events = [...seen.events];
  // The desktop came on or went off, and not by its own hand.
  if (stage.open !== s.wasOpen) {
    if (stage.open && !s.openedIt) events.push('uiOpened');
    if (!stage.open) {
      events.push('uiClosed');
      s = { ...s, openedIt: false };
    }
    s = { ...s, wasOpen: stage.open };
  }
  let interrupted = false;
  for (const event of events) {
    const asleep = s.activity === 'nap' && s.doing > 1.5;
    if (asleep && (event === 'petted' || event === 'whoosh' || event === 'uiOpened')) {
      // A light sleeper only when it has had some rest.
      if (event !== 'uiOpened' || mind.energy > 0.45) {
        mind = feel(mind, 'woken');
        interrupted = true;
      }
    }
    mind = feel(mind, event);
    if (event === 'petted') flash('heart', 1.6);
    if (event === 'whoosh' || event === 'thrown') flash('bang', 1.1);
    if (event === 'uiOpened' && (s.activity === 'bedPhone' || s.activity === 'floorSit')) {
      flash('bang', 0.9);
      interrupted = true;
    }
  }

  // --- the activity in hand ----------------------------------------------------------------------
  const seat = SEAT[s.activity];
  const settled = seat ? seen.body === SETTLED[seat] : true;
  const doing = settled ? s.doing + dt : 0;
  s = { ...s, doing };
  mind = stepMind(mind, dt, s.activity, settled && doing > 0);
  const thing = s.activity === 'play' ? stage.ball : stage.window;
  let touch: Vec3 | undefined,
    perch: Orders['perch'],
    look: Vec3 | undefined,
    tumble = false,
    done = false,
    asleep = false,
    phone: Orders['phone'] = 'rest';
  const touching = () => {
    // A thing the viewer has in hand is not snatched at (it waits and watches); its hand landing
    // moves the thing.
    // Nor is a thing still flying chased: the eyes follow it until it slows.
    if (thing?.hand && !thing.held && thing.speed < CATCHABLE) touch = thing.hand;
    look = thing?.hand;
    const reaching = seen.body === 'reach' || seen.body === 'settle' || seen.body === 'walk';
    if (thing?.held && reaching && !s.teased) {
      mind = feel(mind, 'teased');
      flash('what', 1.6);
      s = { ...s, teased: true };
    }
    // Out of reach: nowhere a hand could come to it, or nowhere to stand to do so (the body stays
    // looking at it, in `notice`, and gets no further).
    const stuck = !thing?.hand || (Boolean(touch) && seen.body === 'notice');
    s = { ...s, lost: stuck ? s.lost + dt : seen.body === 'notice' ? s.lost : 0 };
    if (s.landedFor >= 0) s = { ...s, landedFor: s.landedFor + dt };
  };
  switch (s.activity) {
    case 'nap':
      asleep = doing > 1.5;
      // It turns the desktop it turned on off again before it sleeps.
      if (s.step === 0 && s.openedIt && stage.open) acts.push({ type: 'close' });
      s = { ...s, step: 1 };
      done = mind.energy >= 0.92;
      break;
    case 'bedPhone':
      phone = settled ? 'use' : 'rest';
      done = doing > s.until;
      break;
    case 'floorSit':
      done = doing > s.until;
      break;
    case 'sulk':
      done = mind.grump < 0.22 && s.time > 8;
      break;
    case 'computer': {
      // Sitting at the desk it works the desktop: on, the wallpapers, one for its mood, its own
      // window back in front (the one it can reach from the floor), a ball.
      const due = [0.9, 2.3, 3.6, 4.9, 6][s.step];
      if (due !== undefined && doing > due) {
        if (s.step === 0 && !stage.open) {
          acts.push({ type: 'open' });
          s = { ...s, openedIt: true, wasOpen: true };
        } else if (s.step === 1) acts.push({ type: 'app', id: 'ambience' });
        else if (s.step === 2) acts.push({ type: 'wallpaper', index: wallpaperFor(mind) });
        else if (s.step === 3) acts.push({ type: 'app', id: 'resident' });
        else if (s.step === 4 && !stage.ball && mind.grump < 0.4) acts.push({ type: 'app', id: 'ball' });
        s = { ...s, step: s.step + 1 };
      }
      done = doing > 7.6;
      // Now that it is on, there is something to do with it.
      if (done) mind = { ...mind, boredom: Math.max(mind.boredom, 0.45) };
      break;
    }
    case 'play':
    case 'inspect':
    case 'shove':
    case 'tug': {
      touching();
      if (seen.landed) {
        const kind =
          s.activity === 'play' ? 'bat' : s.activity === 'shove' ? 'push' : s.activity === 'tug' ? 'pull' : 'nudge';
        acts.push({ type: 'impulse', thing: s.activity === 'play' ? 'ball' : 'window', kind });
        mind = feel(mind, s.activity === 'play' ? 'batted' : 'touched');
        if (s.activity === 'play') flash('note', 1.2);
        s = { ...s, count: s.count + 1, landedFor: 0, teased: false };
      }
      const enough = s.activity === 'play' ? s.count >= 4 || s.time > 32 : s.count >= 1 && s.landedFor > 1.4;
      // It cannot get at it: puzzled, it gives up.
      if (s.lost > GIVE_UP_S) {
        mind = feel(mind, 'lost');
        flash('what', 1.8);
      }
      done = enough || !thing || s.lost > GIVE_UP_S || !stage.open;
      break;
    }
    case 'perch': {
      const up = seen.body === 'perch';
      if (stage.window?.perch && !s.tumbled) s = { ...s, perch: stage.window.perch };
      const staying = s.time < s.until && stage.open && Boolean(stage.window) && !s.tumbled;
      perch = staying ? s.perch : undefined;
      if (up && s.step === 0) {
        acts.push({ type: 'sit', on: true });
        flash('note', 1.4);
        s = { ...s, step: 1 };
      }
      if (up && !s.tumbled && (stage.window?.speed ?? 0) > THROW_SPEED) {
        tumble = true;
        mind = feel(mind, 'thrown');
        flash('bang', 1.1);
        s = { ...s, tumbled: true };
      }
      if (!up && s.step === 1) {
        acts.push({ type: 'sit', on: false });
        s = { ...s, step: 2 };
      }
      s = { ...s, lost: stage.window?.perch || up ? 0 : s.lost + dt };
      // Down again (hopped or thrown) and on its feet: over.
      done =
        (s.step === 2 && seen.body === 'idle') || (s.step === 0 && s.lost > 5) || (!staying && seen.body === 'idle');
      break;
    }
    case 'knock':
      touch = s.count ? undefined : seen.knockAt;
      if (seen.landed && !s.count) {
        acts.push({ type: 'knock' });
        mind = feel(mind, 'knocked');
        s = { ...s, count: 1, landedFor: 0 };
      }
      if (s.landedFor >= 0) s = { ...s, landedFor: s.landedFor + dt };
      done = (s.count > 0 && s.landedFor > 1.2) || s.time > 20;
      break;
  }

  // --- what next -------------------------------------------------------------------------------
  // (Thrown off, it finishes falling before it thinks of anything else.)
  const falling = seen.body === 'tumble' || seen.body === 'dazed';
  if ((done || interrupted) && !s.next && !falling) {
    const picked = choose(mind, {
      uiOpen: stage.open,
      window: Boolean(stage.window?.hand),
      perch: Boolean(stage.window?.perch),
      ball: Boolean(stage.ball?.hand),
    });
    mind = picked.mind;
    s = { ...s, next: picked.activity };
  }
  if (s.next) {
    // The phone stays on the bed: it is put down (earphones out) before the body goes anywhere.
    const free = seen.phone === 'away' || s.next === 'bedPhone';
    if (free) {
      const tired = s.next === 'nap';
      s = {
        ...s,
        activity: s.next,
        next: undefined,
        time: 0,
        doing: 0,
        step: 0,
        count: 0,
        lost: 0,
        landedFor: -1,
        teased: false,
        tumbled: false,
        perch: undefined,
        until:
          s.next === 'perch'
            ? 13 + 9 * draw(mind.draws, 7003)
            : s.next === 'bedPhone'
              ? 14 + 10 * draw(mind.draws, 7004)
              : 7 + 5 * draw(mind.draws, 7005),
      };
      // (A drowsy pause as it turns in; not over something it is still showing.)
      if (tired && s.flashLeft <= 0) flash('dots', 1.4);
      touch = undefined;
      perch = undefined;
      // (What the old activity wanted of the phone is not carried into the new one.)
      phone = 'rest';
    } else phone = 'rest';
  }

  const mood = moodOf(mind);
  const emote: Emote | undefined =
    s.flashLeft > 0
      ? s.flash
      : asleep
        ? 'zzz'
        : s.activity === 'sulk'
          ? 'anger'
          : mood === 'confused'
            ? 'what'
            : s.activity === 'perch' && seen.body === 'perch'
              ? 'note'
              : undefined;
  const leaving = Boolean(s.next);
  s = { ...s, mind };
  return {
    state: s,
    orders: {
      activity: s.activity,
      seat: SEAT[s.activity],
      backTurned: s.activity === 'sulk',
      asleep,
      phone,
      touch: leaving ? undefined : touch,
      eager: s.activity === 'play' || s.activity === 'shove' || mind.curiosity > 0.6,
      perch: leaving ? undefined : perch,
      tumble,
      look: leaving ? undefined : look,
      feel: {
        sleepy: asleep ? 0 : Math.max(0, 1 - mind.energy / 0.38),
        grumpy: mind.grump,
        confused: mind.confusion,
        surprised: mind.surprise,
        joy: mind.joy,
      },
      emote,
      acts,
      says: falling ? 'ほうり出された！' : leaving && seen.phone !== 'away' ? 'スマホを置いている' : SAYS[s.activity],
      mood,
    },
  };
}

/** How often a thing of the past minute and a half is remembered (for the page's read-out). */
export const memoryOf = (mind: Mind) => ({
  thrown: remembers(mind, 'thrown'),
  teased: remembers(mind, 'teased'),
  petted: remembers(mind, 'petted'),
});
