// Records the same scenes of the character in the living room from one build, cut to the same
// length from the same starting moment, so two builds (before and after a change to the body) can
// be put side by side:
//   PLAYWRIGHT_BROWSERS_PATH=<main checkout>/.work/browsers \
//     node scripts/living-room/compare.mjs <built page dir> <out dir> [scene …]
//   node scripts/living-room/compare.mjs --join <before dir> <after dir> <out dir>
// Scenes: start, notice, turns, stop, joy, bed (default: all). Each scene is a fresh page, a fixed
// list of timed calls on the page's test hook, and a fixed length. Calls a build does not have are
// skipped, so an older build records the same scene without the newer behaviour.
// WW_COMPARE_CLOSE=0 records from the room's own camera (what a visitor sees) instead of each
// scene's close-up; any other number is the close-up's distance for every scene.
// The window is real (GPU) but off screen, as tests/fixtures.ts places it. The output shows a
// local character: keep it out of the repository (docs/living-body.md).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPlaygroundServer } from '../playground/serve.mjs';

const WIDTH = 960,
  HEIGHT = 720;
// [seconds from the scene's start, call]. `r` is the resident, `room` the page's hook.
const SCENES = {
  // Standing, then a thing appears ahead and to the side: how the walk begins.
  start: { seconds: 8, close: 0.5, steps: [[1.5, (r) => r.setTarget([1.1, 0.9, 1.1])]] },
  // A thing appears behind: noticing, turning round (about 135°), going to it.
  notice: { seconds: 10, close: 0.55, mood: 'interest', steps: [[1.5, (r) => r.setTarget([-0.9, 0.95, -0.55])]] },
  // A quarter turn, then a half turn.
  turns: {
    seconds: 16,
    close: 0.6,
    steps: [
      [1, (r) => r.setTarget([1.3, 0.9, 0.4])],
      [8.5, (r) => r.setTarget([-1.2, 0.9, 0.4])],
    ],
  },
  // The end of a quick approach, from near: braking, then the touch.
  stop: { seconds: 9, close: 0.38, mood: 'interest', steps: [[1, (r) => r.setTarget([0.2, 1.0, -1.25])]] },
  // The touch answered (the thing was clicked): joy.
  joy: {
    seconds: 11,
    close: 0.42,
    mood: 'interest',
    steps: [
      [1, (r) => r.setTarget([0.9, 0.9, 0.9])],
      [6.2, (r) => r.cheer?.()],
    ],
  },
  // Sitting down on the bed, staying, standing up.
  bed: {
    seconds: 18,
    close: 0.5,
    steps: [
      [0.5, (r) => r.sit('sit_bed')],
      [12.5, (r) => r.sit(undefined)],
    ],
  },
};

const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

if (process.argv[2] === '--join') {
  const [before, after, out] = process.argv.slice(3).map((p) => resolve(p));
  mkdirSync(out, { recursive: true });
  for (const name of Object.keys(SCENES)) {
    const a = join(before, `${name}.webm`),
      b = join(after, `${name}.webm`);
    if (!existsSync(a) || !existsSync(b)) continue;
    // Side by side, and a strip of frames at the same moments (before above, after below).
    ffmpeg([
      '-i',
      a,
      '-i',
      b,
      '-filter_complex',
      'hstack=2',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '2M',
      join(out, `${name}.webm`),
    ]);
    const every = SCENES[name].seconds / 12;
    ffmpeg([
      '-i',
      a,
      '-i',
      b,
      '-filter_complex',
      `[0]fps=1/${every},scale=320:-1,tile=12x1[x];[1]fps=1/${every},scale=320:-1,tile=12x1[y];[x][y]vstack=2`,
      '-frames:v',
      '1',
      join(out, `${name}.png`),
    ]);
    console.log(`joined ${name}`);
  }
  process.exit(0);
}

const built = resolve(process.argv[2] ?? '.work/living-room-preview');
const out = resolve(process.argv[3] ?? '.work/living-body-compare');
const wanted = process.argv.slice(4);
const names = wanted.length ? wanted : Object.keys(SCENES);
mkdirSync(out, { recursive: true });
const server = createPlaygroundServer(built);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();
const browser = await chromium.launch({
  channel: 'chromium',
  headless: false,
  args: [
    '--window-position=-4000,0',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const summary = {};
try {
  for (const name of names) {
    const scene = SCENES[name];
    if (!scene) throw new Error(`Unknown scene: ${name}`);
    const work = join(out, `.${name}`);
    rmSync(work, { recursive: true, force: true });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      recordVideo: { dir: work, size: { width: WIDTH, height: HEIGHT } },
    });
    const created = Date.now();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(
      () => globalThis.__wwLivingRoom?.resident && document.querySelector('#room[data-ready]'),
      null,
      { timeout: 90000 },
    );
    await page.evaluate(
      ([close, mood]) => {
        const room = globalThis.__wwLivingRoom;
        room.still();
        room.closeUp(close);
        if (mood) room.resident.setMood?.(mood);
      },
      [
        process.env.WW_COMPARE_CLOSE === undefined ? scene.close : Number(process.env.WW_COMPARE_CLOSE),
        scene.mood ?? null,
      ],
    );
    await page.waitForTimeout(1500); // the canvas has faded in, the body has settled
    const began = Date.now();
    const log = [];
    const steps = [...scene.steps];
    while (Date.now() - began < scene.seconds * 1000) {
      const t = (Date.now() - began) / 1000;
      while (steps.length && steps[0][0] <= t)
        await page.evaluate(`(${steps.shift()[1]})(globalThis.__wwLivingRoom.resident)`);
      const s = await page.evaluate(() => {
        const r = globalThis.__wwLivingRoom.resident;
        const state = r.state();
        const f = r.facts();
        return {
          phase: state.phase,
          x: state.mover.x,
          z: state.mover.z,
          heading: state.mover.heading,
          speed: state.mover.speed,
          slide: f.slide,
          steps: f.steps,
        };
      });
      log.push({ t, ...s });
      await page.waitForTimeout(40);
    }
    await context.close();
    const video = readdirSync(work).find((f) => f.endsWith('.webm'));
    // The recording starts when the page is created: cut from the scene's start, to its length.
    ffmpeg([
      '-ss',
      String((began - created) / 1000),
      '-i',
      join(work, video),
      '-t',
      String(scene.seconds),
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '2M',
      join(out, `${name}.webm`),
    ]);
    rmSync(work, { recursive: true, force: true });
    writeFileSync(join(out, `${name}.json`), JSON.stringify(log));
    const last = log[log.length - 1];
    summary[name] = {
      phases: [...new Set(log.map((s) => s.phase))],
      peakSpeed: Math.max(...log.map((s) => s.speed)),
      slide: last.slide,
      steps: last.steps,
      errors,
    };
    console.log(name, JSON.stringify(summary[name]));
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  server.close();
}
