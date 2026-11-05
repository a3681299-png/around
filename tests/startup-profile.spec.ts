import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';

/**
 * Diagnosis only (AGENTS.md「性能の調査」): V8 CPU profiles of the extension's content script over
 * the first ~6 s after a reload of a real YouTube watch page, for two builds, alternated. The scene
 * is Codex's "no character" one (docs/playground-verification.md): one PNG layer on the player.
 *   WW_PROFILE_STARTUP=1 WW_PROFILE_BUILDS=before=<dir>,after=<dir> npm run test:e2e -- tests/startup-profile.spec.ts
 * Headless. The profile is diagnostic: its overhead makes it useless as a pass/fail number.
 */
const out = path.resolve('.work/startup-profile');
const URL_ = 'https://www.youtube.com/watch?v=LC1a-DwUhls';
type Node = {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  hitCount?: number;
  children?: number[];
};
type Profile = { nodes: Node[]; samples: number[]; timeDeltas: number[]; startTime: number; endTime: number };

/** Self time per extension function (ms), from one profile. */
function selfTimes(profile: Profile) {
  const interval = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
  const totals = new Map<string, number>();
  for (const node of profile.nodes) {
    const { url, functionName, lineNumber } = node.callFrame;
    if (!url.startsWith('chrome-extension://') || !node.hitCount) continue;
    const key = `${functionName || '(anonymous)'} ${url.replace(/^chrome-extension:\/\/[a-z]+\//, '')}:${lineNumber + 1}`;
    totals.set(key, (totals.get(key) ?? 0) + node.hitCount * interval);
  }
  return totals;
}

test('startup CPU profile of the content script, two builds alternated', async () => {
  test.skip(process.env.WW_PROFILE_STARTUP !== '1', 'Diagnosis only (WW_PROFILE_STARTUP=1).');
  test.setTimeout(1500000);
  const builds = Object.fromEntries(
    (process.env.WW_PROFILE_BUILDS ?? '').split(',').map((pair) => pair.split('=') as [string, string]),
  );
  expect(Object.keys(builds).length).toBe(2);
  await mkdir(out, { recursive: true });
  const rounds = Number(process.env.WW_PROFILE_ROUNDS ?? 2);
  const results: { round: number; build: string; extensionMs: number; top: [string, number][] }[] = [];
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? Object.keys(builds).reverse() : Object.keys(builds);
    for (const name of order) {
      const context = await launchExtension(await mkdtemp(path.join(tmpdir(), `ww-startup-${name}-`)), false, {
        extensionPath: builds[name]!,
      });
      try {
        const manager = await context.newPage();
        await manager.goto('chrome://extensions/');
        const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
        await item.waitFor();
        const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
        await manager.close();
        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${id}/popup/index.html`);
        const page: Page = await context.newPage();
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto(URL_, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#movie_player')).toBeVisible({ timeout: 45000 });
        await declinePromotion(page);
        const toggle = popup.getByRole('switch', { name: '作品を表示する' });
        await expect(toggle).toBeEnabled();
        await toggle.check();
        await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
        const { panel } = await openEditor(popup, page);
        await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
        await expect(panel.locator('.layer')).toHaveCount(1);
        await panel.locator('[data-image-prop="anchor"]').selectOption('video-player');
        await panel.locator('.save').click();
        await expect(panel.locator('.dirty')).toHaveText('保存済み');
        await closeEditorPages(page);
        // Warm once (caches, the asset), then profile a fresh start of the page.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        const cdp: CDPSession = await context.newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(6000);
        const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: Profile };
        await writeFile(path.join(out, `round-${round}-${name}.cpuprofile`), JSON.stringify(profile));
        const totals = selfTimes(profile);
        const extensionMs = [...totals.values()].reduce((a, b) => a + b, 0);
        const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
        results.push({ round, build: name, extensionMs, top });
        console.log(`STARTUP ${name} round ${round}: extension self ${extensionMs.toFixed(1)} ms`);
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(results, null, 2));
});
