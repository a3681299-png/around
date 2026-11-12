import { test, expect, chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createPlaygroundServer } from '../scripts/playground/serve.mjs';

/**
 * The living room with a local character (docs/living-body.md): it is eager about a thing behind
 * it, darts to it, touches it and, answered, cheers. What a viewer would see is checked on the
 * real page, frame by frame: the feet do not slide or get dragged, nothing in the body jumps, the
 * hand gets to the thing, the cheer leaves the floor with the arms above the head and comes back
 * to standing as it stood; and the same at 30 frames a second.
 *
 * The character is never in the repository: WW_LIVING_CHARACTER (a .vrm) and WW_LIVING_MOTIONS (a
 * folder of .vrma) name it. Explicit: WW_LIVE_LIVING_BODY=1. Headed off screen (a real GPU).
 */
interface Frame {
  t: number;
  phase: string;
  speed: number;
  slide: number;
  ground: number;
  feet: { down: boolean; stepping: boolean; held: number }[];
  joints: Record<'hips' | 'head' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot', [number, number, number]>;
}
const built = path.resolve('.work/living-body-e2e');
const hook = <T>(page: Page, body: string) =>
  page.evaluate(`(() => { const room = globalThis.__wwLivingRoom; ${body} })()`) as Promise<T>;

async function perform(page: Page, frameRate: number) {
  await page.reload();
  await page.waitForFunction(
    'globalThis.__wwLivingRoom?.resident && document.querySelector("#room[data-ready]")',
    null,
    {
      timeout: 90000,
    },
  );
  await hook(
    page,
    // (The everyday life, docs/living-life.md, is stopped: this measures the approach alone, from
    // standing, as before it existed.)
    `room.still(); room.frameRate(${frameRate}); room.resident.live(false); room.resident.setMood('interest'); room.resident.trace();`,
  );
  await page.waitForTimeout(800);
  await hook(page, 'room.resident.setTarget([-0.9, 0.95, -0.55]);');
  const phase = () => hook<string>(page, 'return room.resident.state().phase;');
  await expect.poll(phase, { timeout: 15000, intervals: [30] }).toBe('hold');
  const gap = await hook<number>(page, 'return room.resident.facts().reachGap;');
  await page.waitForTimeout(350);
  await hook(page, 'room.resident.cheer();');
  await expect.poll(phase, { timeout: 5000, intervals: [30] }).toBe('cheer');
  await expect.poll(phase, { timeout: 8000, intervals: [50] }).toBe('idle');
  await page.waitForTimeout(400);
  return { gap, frames: await hook<Frame[]>(page, 'return room.resident.trace();') };
}

test('the living room: an eager dart, a touch and a cheer hold up frame by frame, at any frame rate', async () => {
  test.skip(
    process.env.WW_LIVE_LIVING_BODY !== '1' || !process.env.WW_LIVING_CHARACTER || !process.env.WW_LIVING_MOTIONS,
    'Explicit: WW_LIVE_LIVING_BODY=1 with WW_LIVING_CHARACTER and WW_LIVING_MOTIONS.',
  );
  test.setTimeout(240000);
  execFileSync(process.execPath, ['scripts/build-living-room.mjs'], {
    env: { ...process.env, WW_LIVING_TEST: '1', WW_LIVING_OUT: '.work/living-body-e2e' },
    stdio: 'inherit',
  });
  const server = createPlaygroundServer(built);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: false,
    // The same off-screen window as tests/fixtures.ts: real GPU, never over the desktop.
    args: [
      '--window-position=-4000,0',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    for (const frameRate of [0, 30]) {
      const { gap, frames } = await perform(page, frameRate);
      const label = `at ${frameRate || 'the display'} fps`;
      const order = frames.map((f) => f.phase).filter((phase, i, all) => phase !== all[i - 1]);
      expect(order.join(' '), label).toBe('idle notice windup pivot walk settle reach hold cheer idle');
      // The slower display really was slower (the check is of what it is meant to be).
      const step = (frames[frames.length - 1]!.t - frames[0]!.t) / (frames.length - 1);
      if (frameRate) expect(step, label).toBeGreaterThan(0.028);
      // The feet. Planted ones stay put over the whole performance (the pins hold); and what a
      // viewer sees whatever holds them: toes on the floor do not travel over it (a run's feet
      // are not pinned, so this is the check of the run).
      expect(frames[frames.length - 1]!.slide - frames[0]!.slide, `${label}: pinned feet slid`).toBeLessThan(0.06);
      // (About a hand's width in all, most of it the run's one stride on the floor; it was over a
      // metre when the stop let the feet glide.)
      expect(frames[frames.length - 1]!.ground - frames[0]!.ground, `${label}: feet on the floor slid`).toBeLessThan(
        0.2,
      );
      // Nothing jumps: from one frame to the next the hips move no further than their fastest
      // real move (a dart, a jump) allows.
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1]!.joints.hips,
          b = frames[i]!.joints.hips;
        const moved = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        expect(moved, `${label}: the hips jumped at ${frames[i]!.t.toFixed(2)}s (${frames[i]!.phase})`).toBeLessThan(
          (frames[i]!.t - frames[i - 1]!.t) * 4.5 + 0.004,
        );
      }
      // It ran (well over a walk's pace) and stopped.
      expect(Math.max(...frames.map((f) => f.speed)), label).toBeGreaterThan(1.2);
      // The hand got to the thing.
      expect(gap, `${label}: the hand's distance from the thing`).toBeLessThan(0.05);
      // The cheer as a silhouette: well off the floor, both hands above the head at the top, a
      // deep sinking before it, and standing where and as it stood afterwards.
      const cheer = frames.filter((f) => f.phase === 'cheer');
      const standing = cheer[0]!.joints.hips[1];
      const top = cheer.reduce((best, f) => (f.joints.hips[1] > best.joints.hips[1] ? f : best));
      expect(top.joints.hips[1] - standing, `${label}: the jump's height`).toBeGreaterThan(0.2);
      expect(top.joints.leftHand[1], `${label}: left hand over the head`).toBeGreaterThan(top.joints.head[1]);
      expect(top.joints.rightHand[1], `${label}: right hand over the head`).toBeGreaterThan(top.joints.head[1]);
      expect(top.joints.leftFoot[1], `${label}: feet off the floor`).toBeGreaterThan(
        cheer[0]!.joints.leftFoot[1] + 0.12,
      );
      const lowest = Math.min(...cheer.filter((f) => f.t < top.t).map((f) => f.joints.hips[1]));
      expect(standing - lowest, `${label}: the sinking before the jump`).toBeGreaterThan(0.07);
      const end = frames[frames.length - 1]!;
      expect(Math.abs(end.joints.hips[1] - standing), label).toBeLessThan(0.03);
      expect(
        Math.hypot(end.joints.hips[0] - cheer[0]!.joints.hips[0], end.joints.hips[2] - cheer[0]!.joints.hips[2]),
      ).toBeLessThan(0.05);
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.close();
  }
});
