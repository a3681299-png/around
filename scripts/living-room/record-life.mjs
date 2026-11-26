// Records the resident's everyday life (docs/living-life.md): the day's script from the desk to
// the bed and back, with the phone. A video, a picture each time the step or the phone's phase
// changes, and a log of both with the chair's give and the load of each second.
//   AROUND_LIVING_TEST=1 AROUND_LIVING_OUT=.work/living-room-preview AROUND_LIVING_CHARACTER=<vrm> AROUND_LIVING_MOTIONS=<dir> \
//     node scripts/build-living-room.mjs
//   PLAYWRIGHT_BROWSERS_PATH=<main checkout>/.work/browsers \
//     node scripts/living-room/record-life.mjs <out-dir> [seconds]
// AROUND_RECORD_CLOSE=0.45 follows the character from nearer; AROUND_RECORD_VIDEO=0 skips the video.
// The window is real (GPU) but off screen, as tests/fixtures.ts places it. The output shows a
// local character: keep it out of the repository (docs/living-body.md).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPlaygroundServer } from '../playground/serve.mjs';

const out = resolve(process.argv[2] ?? '.work/living-life-record');
const seconds = Number(process.argv[3] ?? 150);
const width = Number(process.env.AROUND_RECORD_WIDTH ?? 1280);
const height = Number(process.env.AROUND_RECORD_HEIGHT ?? 720);
const video = process.env.AROUND_RECORD_VIDEO !== '0';
mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) if (/^\d\d\d-.*\.png$/.test(file)) rmSync(join(out, file));
const server = createPlaygroundServer(resolve(process.env.AROUND_LIVING_OUT ?? '.work/living-room-preview'));
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
    ...(video ? { recordVideo: { dir: out, size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(
    () => globalThis.__aroundLivingRoom?.resident && document.querySelector('#room[data-ready]'),
    null,
    { timeout: 90000 },
  );
  await page.evaluate(() => globalThis.__aroundLivingRoom.still());
  if (process.env.AROUND_RECORD_CLOSE)
    await page.evaluate(
      (scale) => globalThis.__aroundLivingRoom.closeUp(scale),
      Number(process.env.AROUND_RECORD_CLOSE),
    );
  await page.evaluate(() => globalThis.__aroundLivingRoom.timing());
  const log = [];
  let shot = 0,
    last = '';
  const start = Date.now();
  let second = 0;
  while (Date.now() - start < seconds * 1000) {
    const now = await page.evaluate(() => globalThis.__aroundLivingRoom.resident.life());
    const key = `${now.step}|${now.phone}|${now.body}`;
    const t = (Date.now() - start) / 1000;
    if (key !== last) {
      last = key;
      const name = `${String(shot++).padStart(3, '0')}-t${Math.round(t)}-${now.step.replace(/\W+/g, '_')}-${now.phone}-${now.body}.png`;
      // A moment into the new phase, where it reads.
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(out, name), caret: 'initial' });
      log.push({ t, ...now, shot: name });
    }
    if (t >= second + 1) {
      second = Math.floor(t);
      const load = await page.evaluate(() => globalThis.__aroundLivingRoom.timing());
      log.push({ t, load });
    }
    await page.waitForTimeout(120);
  }
  writeFileSync(join(out, 'life-log.json'), JSON.stringify({ errors, log }, null, 1));
  await context.close();
  if (video) {
    const recorded = readdirSync(out).find((f) => f.endsWith('.webm') && !f.startsWith('life'));
    if (recorded) renameSync(join(out, recorded), join(out, 'life.webm'));
  }
  console.log(JSON.stringify({ out, shots: shot, errors }, null, 1));
} finally {
  await browser.close();
  server.close();
}
