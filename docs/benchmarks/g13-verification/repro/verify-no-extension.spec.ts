import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { declinePromotion, waitForAdvertToEnd, clearestPoint } from '../../tests/helpers/youtube-live';

test('independent no-extension scroll frame reference', async () => {
  test.setTimeout(300000);
  const results = [];
  await mkdir('.work/g13-evidence', { recursive: true });
  for (let run = 0; run < 3; run++) {
    const profile = await mkdtemp(path.resolve('.work/g13-no-extension-'));
    const context = await chromium.launchPersistentContext(profile, {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : { channel: 'chromium' }),
      headless: true,
      viewport: { width: 1920, height: 1080 },
    });
    try {
      const page = await context.newPage();
      await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
      await waitForAdvertToEnd(page);
      await declinePromotion(page);
      await page.evaluate(async () => {
        const video = document.querySelector<HTMLVideoElement>('video');
        if (!video) throw new Error('No video to measure');
        video.muted = true;
        await video.play();
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const video = document.querySelector<HTMLVideoElement>('video');
            return Boolean(video && !video.paused && video.currentTime > 0);
          }),
        )
        .toBe(true);
      await page.waitForTimeout(6000);
      const phases: Record<string, unknown> = {};
      const far = await clearestPoint(page, { left: 240, top: 10, right: 1600, bottom: 46 }, 0);
      for (const name of ['scrollFar', 'scrollNear']) {
        await page.evaluate(() => scrollTo(0, 0));
        const point =
          name === 'scrollFar'
            ? far
            : await page.evaluate(() => {
                const below = document.querySelector('ytd-watch-flexy #below')!.getBoundingClientRect();
                return { x: below.left + 20, y: innerHeight / 2 };
              });
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(1000);
        await page.evaluate(() => {
          const v = document.querySelector('video');
          const q = v?.getVideoPlaybackQuality();
          (window as any).g13FrameReference = {
            times: [],
            active: true,
            before:
              v && q
                ? {
                    total: q.totalVideoFrames,
                    dropped: q.droppedVideoFrames,
                    currentTime: v.currentTime,
                    paused: v.paused,
                    ad: Boolean(document.querySelector('.ad-showing')),
                  }
                : null,
          };
          const sample = (t: number) => {
            const data = (window as any).g13FrameReference;
            data.times.push(t);
            if (data.active) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        for (let i = 0; i < 32; i++) {
          await page.mouse.wheel(0, i < 16 ? 90 : -90);
          await page.waitForTimeout(70);
        }
        phases[name] = await page.evaluate(() => {
          const data = (window as any).g13FrameReference;
          data.active = false;
          const v = document.querySelector('video');
          const q = v?.getVideoPlaybackQuality();
          return {
            times: data.times,
            before: data.before,
            after:
              v && q
                ? {
                    total: q.totalVideoFrames,
                    dropped: q.droppedVideoFrames,
                    currentTime: v.currentTime,
                    paused: v.paused,
                    ad: Boolean(document.querySelector('.ad-showing')),
                  }
                : null,
          };
        });
      }
      results.push({ run, browser: context.browser()?.version(), phases });
      await writeFile('.work/g13-evidence/no-extension-playing.json', JSON.stringify(results, null, 2));
    } finally {
      await context.close();
    }
  }
  await writeFile('.work/g13-evidence/no-extension-playing.json', JSON.stringify(results, null, 2));
});
