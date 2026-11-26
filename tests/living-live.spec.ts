import { test, expect } from '@playwright/test';
import { youtubeId, embedUrl } from '../src/living-room/live/youtube-id';
import { GRID_H, GRID_W, easeLight, readFrame, startLight } from '../src/living-room/live/frame-light';
import { startBeat, stepBeat, type BeatState } from '../src/living-room/live/beat';
import { quadMatrix } from '../src/living-room/live/homography';
import { startLiveMood, stepLiveMood, type LiveMoodState } from '../src/characters/live-mood';
import { feel, scores, startMind } from '../src/characters/mind';
import { startDirector, stepDirector, type Seen } from '../src/living-room/director';
import { reduceDesktop, startDesktop } from '../src/living-room/desktop/state';

// Live mode (docs/living-live.md): a YouTube picture as a screen in the room, its colours in the
// room's light, its sound in the resident's body. The parts that decide are pure.

test('a YouTube address of any usual shape gives its video id; anything else gives none', () => {
  const id = 'aqz-KE-bpKQ';
  for (const text of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?feature=share&v=${id}&t=42s`,
    `https://youtu.be/${id}?si=abc`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=xyz`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `  youtu.be/${id}  `,
  ])
    expect(youtubeId(text), text).toBe(id);
  for (const text of [
    '',
    'hello',
    'https://example.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ"><script>',
    'javascript:alert(1)',
    'https://evil.example/youtu.be/aqz-KE-bpKQ',
  ])
    expect(youtubeId(text), text).toBeUndefined();
  // The player's address is built from fixed text and a checked id only.
  expect(embedUrl(id, 'http://127.0.0.1:4183')).toBe(
    `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&playsinline=1&rel=0&origin=http%3A%2F%2F127.0.0.1%3A4183`,
  );
});

/** A frame of the grid: `paint` gives each cell its sRGB colour. */
const frame = (paint: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(GRID_W * GRID_H * 4);
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) data.set([...paint(x, y), 255], (y * GRID_W + x) * 4);
  return data;
};

test('the picture is read where it is: red on its left lights the left, blue on its right the right', () => {
  const light = readFrame(frame((x) => (x < GRID_W / 2 ? [255, 0, 0] : [0, 0, 255])));
  expect(light.left[0]).toBeGreaterThan(0.9);
  expect(light.left[2]).toBeLessThan(0.05);
  expect(light.right[2]).toBeGreaterThan(0.9);
  expect(light.right[0]).toBeLessThan(0.05);
  // The middle sees both; the whole is their mean, in linear light.
  expect(light.centre[0]).toBeCloseTo(0.5, 1);
  expect(light.all[0]).toBeCloseTo(0.5, 2);
  expect(light.all[2]).toBeCloseTo(0.5, 2);
});

test('top and bottom are read apart, black bars carry no light, and brightness is the eye’s', () => {
  const light = readFrame(frame((_, y) => (y < 2 ? [0, 0, 0] : y < GRID_H / 2 ? [0, 255, 0] : [255, 255, 255])));
  expect(light.bottom[0]).toBeGreaterThan(0.9);
  expect(light.top[1]).toBeGreaterThan(0.4);
  expect(light.top[0]).toBeLessThan(0.05);
  expect(readFrame(frame(() => [0, 0, 0])).level).toBe(0);
  expect(readFrame(frame(() => [255, 255, 255])).level).toBeCloseTo(1, 5);
  // Green is brighter to the eye than blue.
  expect(readFrame(frame(() => [0, 255, 0])).level).toBeGreaterThan(readFrame(frame(() => [0, 0, 255])).level * 5);
});

test('light follows a cut quickly but never jumps: a flash is softened, a strobe is held down', () => {
  const dark = readFrame(frame(() => [0, 0, 0]));
  const white = readFrame(frame(() => [255, 255, 255]));
  let s = startLight();
  s = easeLight(s, dark, 1);
  // One frame after a cut to white the room is not white yet…
  s = easeLight(s, white, 1 / 60);
  expect(s.light.all[0]).toBeGreaterThan(0);
  expect(s.light.all[0]).toBeLessThan(0.35);
  // …a quarter of a second later it nearly is.
  for (let i = 0; i < 15; i++) s = easeLight(s, white, 1 / 60);
  expect(s.light.all[0]).toBeGreaterThan(0.8);
  // A strobe (white and black by turns, ten times a second) is not passed on as a strobe: the
  // room's swing between one frame and the next stays small.
  let swing = 0;
  for (let i = 0; i < 120; i++) {
    const before = s.light.level;
    s = easeLight(s, Math.floor(i / 6) % 2 ? white : dark, 1 / 60);
    if (i > 60) swing = Math.max(swing, Math.abs(s.light.level - before));
  }
  expect(swing).toBeLessThan(0.06);
});

/** Runs a beat tracker over a kick drum at `bpm` for `seconds`, at 60 frames a second. */
function drum(bpm: number, seconds: number, loud = 1, state: BeatState = startBeat()) {
  const period = 60 / bpm;
  let s = state;
  let onsets = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i / 60;
    const since = t % period;
    // A kick: sharp, gone in a tenth of a second; a steady bed under it.
    const bass = loud * (0.15 + 0.85 * Math.exp(-since / 0.05));
    s = stepBeat(s, { dt: 1 / 60, bass, mid: 0.3 * loud, high: 0.2 * loud });
    if (s.onset) onsets++;
  }
  return { s, onsets };
}

test('a steady kick is counted: one onset a beat, the tempo found, the beat clock in step with it', () => {
  for (const bpm of [90, 120, 150]) {
    const { s, onsets } = drum(bpm, 12);
    expect(Math.abs(onsets - (12 * bpm) / 60), `${bpm} onsets`).toBeLessThanOrEqual(2);
    expect(Math.abs(s.bpm - bpm), `${bpm} tempo`).toBeLessThan(4);
    expect(s.confidence).toBeGreaterThan(0.6);
  }
  // The beat clock: whole numbers fall on the kicks (within a twelfth of a beat).
  const { s } = drum(120, 12.0);
  const phase = s.beat - Math.round(s.beat);
  expect(Math.abs(phase)).toBeLessThan(0.12);
});

test('energy is how loud it is against how loud it has been, and against how loud a song is', () => {
  const loud = drum(128, 10, 1).s;
  expect(loud.energy).toBeGreaterThan(0.6);
  // The same track turned down some still reads as lively…
  expect(drum(128, 10, 0.5).s.energy).toBeGreaterThan(0.6);
  // …but a soft opening is soft from its first bar, though nothing louder has been heard yet
  // (measured on a real video: a quiet intro's bass and middle are a fifth of the chorus's).
  expect(drum(100, 10, 0.07).s.energy).toBeLessThan(0.45);
  // A quiet passage after a loud one reads as quiet.
  let s = loud;
  for (let i = 0; i < 4 * 60; i++) s = stepBeat(s, { dt: 1 / 60, bass: 0.03, mid: 0.04, high: 0.02 });
  expect(s.energy).toBeLessThan(0.25);
  // Silence: nothing, and no beat is made up.
  s = startBeat();
  for (let i = 0; i < 5 * 60; i++) s = stepBeat(s, { dt: 1 / 60, bass: 0, mid: 0, high: 0 });
  expect(s.energy).toBe(0);
  expect(s.onset).toBe(false);
  expect(s.confidence).toBeLessThan(0.2);
});

test('what it does with the music: it listens to a quiet song, sways to a livelier one, dances to a loud one', () => {
  const hold = (state: LiveMoodState, energy: number, seconds: number, mood = { grump: 0, tired: 0, joy: 0 }) => {
    let s = state;
    for (let i = 0; i < seconds * 30; i++) s = stepLiveMood(s, { dt: 1 / 30, energy, ...mood });
    return s;
  };
  let s = hold(startLiveMood(), 0.1, 6);
  expect(s.move).toBe('listen');
  s = hold(s, 0.5, 6);
  expect(s.move).toBe('sway');
  s = hold(s, 0.9, 6);
  expect(s.move).toBe('dance');
  expect(s.dance).toBeGreaterThan(0.9);
  // It does not flicker between two things at the edge between them…
  let changes = 0;
  let last = s.move;
  for (let i = 0; i < 600; i++) {
    s = stepLiveMood(s, { dt: 1 / 30, energy: 0.66 + 0.05 * Math.sin(i * 0.9), grump: 0, tired: 0, joy: 0 });
    if (s.move !== last) changes++;
    last = s.move;
  }
  expect(changes).toBeLessThanOrEqual(1);
  // …and it does not stop the moment the song breathes: a short break is danced through.
  s = hold(startLiveMood(), 0.9, 6);
  s = hold(s, 0.2, 1);
  expect(s.move).toBe('dance');
  s = hold(s, 0.2, 6);
  expect(s.move).not.toBe('dance');
});

test('its mood is in it: cross or worn out it only listens; glad, it dances sooner', () => {
  const run = (energy: number, mood: { grump: number; tired: number; joy: number }) => {
    let s = startLiveMood();
    for (let i = 0; i < 240; i++) s = stepLiveMood(s, { dt: 1 / 30, energy, ...mood });
    return s.move;
  };
  expect(run(0.95, { grump: 0.8, tired: 0, joy: 0 })).toBe('listen');
  expect(run(0.95, { grump: 0, tired: 0.9, joy: 0 })).toBe('listen');
  expect(run(0.6, { grump: 0, tired: 0, joy: 0 })).toBe('sway');
  expect(run(0.6, { grump: 0, tired: 0, joy: 0.9 })).toBe('dance');
});

test('a rise out of a quiet passage is a moment: it is told once, not while the song stays loud', () => {
  let s = startLiveMood();
  let drops = 0;
  const step = (energy: number, seconds: number) => {
    for (let i = 0; i < seconds * 30; i++) {
      s = stepLiveMood(s, { dt: 1 / 30, energy, grump: 0, tired: 0, joy: 0 });
      if (s.drop) drops++;
    }
  };
  step(0.15, 6);
  step(0.95, 8);
  expect(drops).toBe(1);
  step(0.2, 6);
  step(0.95, 4);
  expect(drops).toBe(2);
});

test('a screen in the room: the matrix puts the card’s four corners on the four points it is seen at', () => {
  const [w, h] = [960, 540];
  const corners: [number, number][] = [
    [212, 96],
    [1071, 80],
    [1090, 590],
    [190, 571],
  ];
  const m = quadMatrix(w, h, corners)!;
  expect(m).toHaveLength(16);
  // (CSS matrix3d is column by column; a point (x, y, 0, 1) goes through it and is divided by w.)
  const through = (x: number, y: number) => {
    const px = m[0]! * x + m[4]! * y + m[12]!,
      py = m[1]! * x + m[5]! * y + m[13]!,
      pw = m[3]! * x + m[7]! * y + m[15]!;
    return [px / pw, py / pw];
  };
  const from = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ] as const;
  from.forEach(([x, y], i) => {
    const [px, py] = through(x, y);
    expect(px).toBeCloseTo(corners[i]![0], 3);
    expect(py).toBeCloseTo(corners[i]![1], 3);
  });
  // Four points that are no quad (three in a line) give nothing, rather than a wild matrix.
  expect(
    quadMatrix(w, h, [
      [0, 0],
      [100, 0],
      [200, 0],
      [0, 100],
    ]),
  ).toBeUndefined();
});

test('the desktop: a video opens the player; live mode needs one, and ends when the player is closed', () => {
  let s = reduceDesktop(startDesktop([1280, 720]), { type: 'open' });
  // No video yet: live mode does not start.
  expect(reduceDesktop(s, { type: 'live', on: true }).live).toBe(false);
  s = reduceDesktop(s, { type: 'video', id: 'aqz-KE-bpKQ' });
  expect(s.video).toBe('aqz-KE-bpKQ');
  expect(s.windows.some((w) => w.id === 'player')).toBe(true);
  // An id that is not one is refused.
  expect(reduceDesktop(s, { type: 'video', id: '<script>' }).video).toBe('aqz-KE-bpKQ');
  s = reduceDesktop(s, { type: 'live', on: true });
  expect(s.live).toBe(true);
  expect(reduceDesktop(s, { type: 'closeApp', id: 'player' }).live).toBe(false);
  expect(reduceDesktop(s, { type: 'close' }).live).toBe(false);
  expect(reduceDesktop(s, { type: 'live', on: false }).windows.some((w) => w.id === 'player')).toBe(true);
});

const seen = (extra: Partial<Seen> = {}): Seen => ({
  dt: 1 / 30,
  body: 'idle',
  phone: 'away',
  stage: { open: true },
  landed: false,
  events: [],
  knockAt: [0, 1, 2],
  ...extra,
});
const venue = { spot: { x: 0.4, z: 0.6, heading: Math.PI }, look: [0, 1.7, -0.9] as [number, number, number] };

test('the resident and a live: it leaves what it was at, goes to its place before the screen and moves with the music', () => {
  let state = startDirector(1);
  let orders = stepDirector(state, seen()).orders;
  // The live begins: whatever it was at, the phone is put down and it comes.
  for (let i = 0; i < 90; i++) {
    const out = stepDirector(state, seen({ live: { ...venue, energy: 0.9 } }));
    state = out.state;
    orders = out.orders;
  }
  expect(orders.activity).toBe('live');
  expect(orders.stand).toEqual(venue.spot);
  expect(orders.seat).toBeUndefined();
  expect(orders.look).toEqual(venue.look);
  // Loud for a while: it dances.
  for (let i = 0; i < 300; i++) {
    const out = stepDirector(state, seen({ live: { ...venue, energy: 0.9 } }));
    state = out.state;
    orders = out.orders;
  }
  expect(orders.music?.move).toBe('dance');
  expect(orders.says).toContain('踊');
  // The live ends: it goes back to a life of its own choosing.
  for (let i = 0; i < 30; i++) {
    const out = stepDirector(state, seen());
    state = out.state;
    orders = out.orders;
  }
  expect(orders.activity).not.toBe('live');
  expect(orders.music).toBeUndefined();
  expect(orders.stand).toBeUndefined();
});

/** Runs the director for `seconds`, the body doing at once what it is ordered to. */
function attend(state: ReturnType<typeof startDirector>, seconds: number, energy: number | undefined) {
  let orders = stepDirector(state, seen()).orders;
  const said = new Set<string>();
  for (let i = 0; i < seconds * 30; i++) {
    const body = orders.rest === 'lie' ? 'lie' : orders.rest === 'sit' ? 'sit' : 'idle';
    const out = stepDirector(state, seen({ body, ...(energy === undefined ? {} : { live: { ...venue, energy } }) }));
    state = out.state;
    orders = out.orders;
    said.add(orders.says);
  }
  return { state, orders, said };
}

test('worn out at a live it does not just stop: it lies down before the screen, watches on, and gets up rested', () => {
  let state = startDirector(1);
  state = attend(state, 5, 0.9).state;
  // Nearly spent, the music still loud.
  state = { ...state, mind: { ...state.mind, energy: 0.1 } };
  let out = attend(state, 3, 0.9);
  expect(out.orders.activity).toBe('live');
  expect(out.orders.rest).toBe('lie');
  // Lying, it is not sent to stand anywhere and is not asleep: its eyes stay on the screen.
  expect(out.orders.stand).toBeUndefined();
  expect(out.orders.asleep).toBe(false);
  expect(out.orders.look).toEqual(venue.look);
  expect(out.orders.says).toContain('寝転');
  // Lying mends it (it never runs dry), and rested it is back on its feet with the music.
  const before = out.state.mind.energy;
  out = attend(out.state, 20, 0.9);
  expect(out.state.mind.energy).toBeGreaterThan(before + 0.15);
  out = attend(out.state, 90, 0.9);
  expect(out.orders.rest).toBeUndefined();
  expect(out.orders.stand).toEqual(venue.spot);
  expect(out.orders.music?.move).toBe('dance');
  expect(out.state.mind.energy).toBeGreaterThan(0.4);
});

test('a whole long live: it is never left standing spent, and it both dances and rests', () => {
  const out = attend(startDirector(1), 900, 0.9);
  expect(out.state.mind.energy).toBeGreaterThan(0.05);
  expect([...out.said].some((line) => line.includes('踊'))).toBe(true);
  expect([...out.said].some((line) => line.includes('寝転'))).toBe(true);
});

test('a long quiet song is sat through; when it livens it is up again', () => {
  let out = attend(startDirector(1), 25, 0.1);
  expect(out.orders.rest).toBe('sit');
  expect(out.orders.look).toEqual(venue.look);
  expect(out.orders.says).toContain('座');
  out = attend(out.state, 6, 0.9);
  expect(out.orders.rest).toBeUndefined();
  expect(out.orders.stand).toEqual(venue.spot);
});

test('the live over and it worn out: it takes itself to bed and sleeps', () => {
  let state = attend(startDirector(1), 5, 0.9).state;
  state = { ...state, mind: { ...state.mind, energy: 0.16 } };
  const out = attend(state, 4, undefined);
  expect(out.orders.activity).toBe('nap');
  expect(out.orders.seat).toBe('bed');
});

test('where the light is in the picture: a bright thing on the right and low is found there', () => {
  const cells = new Uint8ClampedArray(GRID_W * GRID_H * 4);
  for (let i = 0; i < GRID_W * GRID_H; i++) cells.set([20, 20, 30, 255], i * 4);
  // A lamp in the lower right.
  for (const [x, y] of [
    [13, 6],
    [14, 6],
    [13, 7],
    [14, 7],
  ] as const)
    cells.set([255, 240, 200, 255], (y * GRID_W + x) * 4);
  const { focus } = readFrame(cells);
  expect(focus[0]).toBeGreaterThan(0.5);
  expect(focus[1]).toBeLessThan(-0.3);
  // An even picture has its light in the middle.
  const even = new Uint8ClampedArray(GRID_W * GRID_H * 4).fill(128);
  expect(Math.abs(readFrame(even).focus[0])).toBeLessThan(0.05);
  expect(Math.abs(readFrame(even).focus[1])).toBeLessThan(0.05);
  // The found place eases like the rest of the light: a cut does not make it jump.
  let light = startLight();
  for (let i = 0; i < 2; i++) light = easeLight(light, readFrame(cells), 1 / 60);
  expect(light.light.focus[0]).toBeGreaterThan(0);
  expect(light.light.focus[0]).toBeLessThan(focus[0]);
});

test('a live is a good time: the mind never picks it by itself, and a drop is a joy', () => {
  const mind = startMind(1);
  expect(scores(mind, { uiOpen: true, window: true, perch: true, ball: true }).live).toBe(0);
  expect(feel(mind, 'drop').joy).toBeGreaterThan(mind.joy);
});
