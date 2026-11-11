// Takes the browser picture of the living room page for the art review, at the room's own camera.
//   WW_LIVING_TEST=1 WW_LIVING_OUT=.work/living-room-preview node scripts/build-living-room.mjs
//   PLAYWRIGHT_BROWSERS_PATH=<main checkout>/.work/browsers node scripts/living-room/capture.mjs <out.png> [width height]
// The window is real (GPU) but placed off screen, as tests/fixtures.ts does, so it never covers
// the desktop.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { createPlaygroundServer } from '../playground/serve.mjs';

const out = resolve(process.argv[2] ?? 'art/living-room/renders/web.png');
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 900);
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
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => globalThis.__wwLivingRoom && document.querySelector('#room[data-ready]'), null, {
    timeout: 60000,
  });
  await page.evaluate(() => globalThis.__wwLivingRoom.still());
  const view = process.env.WW_LIVING_VIEW;
  if (view) {
    const views = {
      desk: { at: [-1.15, 1.35, -2.55], scale: 0.36 },
      bed: { at: [2.05, 0.65, -1.3], scale: 0.32 },
    };
    if (!views[view]) throw new Error('WW_LIVING_VIEW must be desk or bed.');
    await page.evaluate(({ at, scale }) => globalThis.__wwLivingRoom.reviewCamera(at, scale), views[view]);
  }
  await page.waitForTimeout(1200); // the canvas fades in over 0.6 s
  await page.screenshot({ path: out });
  const facts = await page.evaluate(() => {
    const room = globalThis.__wwLivingRoom;
    return {
      spots: room.layout.spots.length,
      floorTriangles: room.layout.floor.length,
      unreachable: room.reach().filter((spot) => !spot.walkable || !spot.reachable),
      draws: room.draws(),
    };
  });
  console.log(JSON.stringify({ out, ...facts, errors }, null, 2));
} finally {
  await browser.close();
  server.close();
}
