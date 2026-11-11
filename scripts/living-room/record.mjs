// Records the character in the living room doing the approach (notice → walk → touch → back to
// standing) for the eye: a video, a picture per phase and a log of what the body did.
//   WW_LIVING_TEST=1 WW_LIVING_OUT=.work/living-room-preview WW_LIVING_CHARACTER=<vrm> WW_LIVING_MOTIONS=<dir> \
//     node scripts/build-living-room.mjs
//   PLAYWRIGHT_BROWSERS_PATH=<main checkout>/.work/browsers \
//     node scripts/living-room/record.mjs <out-dir> [x y z] [x y z …]
// Each x y z is a target in the room's metres, visited one after another (default: one in front of
// the desk). The window is real (GPU) but off screen, as tests/fixtures.ts places it. The output
// shows a local character: keep it out of the repository (docs/living-body.md).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPlaygroundServer } from '../playground/serve.mjs';

const out = resolve(process.argv[2] ?? '.work/living-body-record');
const numbers = process.argv.slice(3).map(Number);
const targets = [];
for (let i = 0; i + 2 < numbers.length; i += 3) targets.push(numbers.slice(i, i + 3));
if (!targets.length) targets.push([-0.9, 0.95, -0.55]);
const width = Number(process.env.WW_RECORD_WIDTH ?? 1280);
const height = Number(process.env.WW_RECORD_HEIGHT ?? 720);
mkdirSync(out, { recursive: true });
// The phase pictures of an earlier run would mix with this one's (they are numbered alike).
for (const file of readdirSync(out)) if (/^\d\d-t\d+-\w+\.png$/.test(file)) rmSync(join(out, file));
const server = createPlaygroundServer(resolve(process.env.WW_LIVING_OUT ?? '.work/living-room-preview'));
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
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: out, size: { width, height } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(
    () => globalThis.__wwLivingRoom?.resident && document.querySelector('#room[data-ready]'),
    null,
    {
      timeout: 90000,
    },
  );
  await page.evaluate(() => globalThis.__wwLivingRoom.still());
  // WW_RECORD_CLOSE=0.4 follows the character from nearer (to judge the feet and the hand).
  if (process.env.WW_RECORD_CLOSE)
    await page.evaluate((scale) => globalThis.__wwLivingRoom.closeUp(scale), Number(process.env.WW_RECORD_CLOSE));
  const sample = () =>
    page.evaluate(() => {
      const r = globalThis.__wwLivingRoom.resident;
      const s = r.state();
      return {
        t: s.t,
        phase: s.phase,
        x: s.mover.x,
        z: s.mover.z,
        heading: s.mover.heading,
        speed: s.mover.speed,
        ...r.facts(),
      };
    });
  const log = [];
  const shots = [];
  await page.waitForTimeout(2500); // standing first: breathing, the weight shifting
  let n = 0;
  for (const target of targets) {
    n++;
    await page.evaluate((t) => globalThis.__wwLivingRoom.resident.setTarget(t), target);
    let phase = '';
    const started = Date.now();
    let touched = false;
    while (Date.now() - started < 40000) {
      const s = await sample();
      log.push({ target: n, ...s });
      if (s.phase !== phase) {
        phase = s.phase;
        // A moment into the phase shows it better than its first frame.
        await page.waitForTimeout(phase === 'hold' ? 300 : 150);
        const file = `${String(shots.length).padStart(2, '0')}-t${n}-${phase}.png`;
        await page.screenshot({ path: join(out, file) });
        shots.push(file);
      }
      if (phase === 'hold') touched = true;
      if (touched && phase === 'idle') break;
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => globalThis.__wwLivingRoom.resident.setTarget(undefined));
  await page.waitForTimeout(800);
  const facts = await page.evaluate(() => ({
    facts: globalThis.__wwLivingRoom.resident.facts(),
    metrics: globalThis.__wwLivingRoom.resident.metrics(),
  }));
  await context.close();
  const video = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'approach.webm');
  if (video) renameSync(join(out, video), join(out, 'approach.webm'));
  const peak = Math.max(...log.map((s) => s.speed));
  const gaps = log.filter((s) => s.phase === 'hold' && s.reachGap !== undefined).map((s) => s.reachGap);
  const summary = {
    targets,
    ...facts,
    peakSpeed: peak,
    reachGapAtHold: gaps.length ? Math.max(...gaps) : null,
    phases: [...new Set(log.map((s) => `${s.target}:${s.phase}`))],
    shots,
    errors,
  };
  writeFileSync(join(out, 'log.json'), JSON.stringify(log));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  server.close();
}
