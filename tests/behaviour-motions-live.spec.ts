import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { storeDesign } from './helpers/skin-verification';
import { writeContent } from '../scripts/playground/content';
import type { DesignDocument, ModelDecoration } from '../src/design/types';

/**
 * A local artwork on real YouTube: a person's own VRM and motion files (never in the repository:
 * AROUND_CHARACTER_VRM is the .vrm, AROUND_CHARACTER_MOTIONS the folder of .vrma), sitting at the
 * player's corner with the autonomy on and a motion assigned to each behaviour
 * (docs/autonomy-plan.md, the motion assignment). Headless; explicit: AROUND_LIVE_BEHAVIOUR_MOTIONS=1.
 * Pictures and the stored artwork stay in .work (they show that model).
 */
const shots = path.resolve('.work/behaviour-motions-live');
const media = (page: Page) =>
  page.locator(':is(#around-decorations, #around-video-decorations, #around-page-decorations) .model-media');
// The proposal's table, for the behaviours the autonomy has (motion file name, part, speed).
const ASSIGN = {
  rest: { motion: 'idle', from: 0, to: 10.66, speed: 1 },
  flee: { motion: 'jump', from: 0.6, to: 1.9, speed: 1.5 },
  approach: { motion: 'walk', from: 0, to: 0.96, speed: 0.5 },
  return: { motion: 'run', from: 0, to: 0.73, speed: 1 },
} as const;

test('real YouTube: a local character plays its assigned motion for each behaviour', async () => {
  test.skip(
    process.env.AROUND_LIVE_BEHAVIOUR_MOTIONS !== '1' ||
      !process.env.AROUND_CHARACTER_VRM ||
      !process.env.AROUND_CHARACTER_MOTIONS,
    'Explicit: AROUND_LIVE_BEHAVIOUR_MOTIONS=1 with AROUND_CHARACTER_VRM and AROUND_CHARACTER_MOTIONS.',
  );
  test.setTimeout(300000);
  await mkdir(shots, { recursive: true });
  const folder = process.env.AROUND_CHARACTER_MOTIONS!;
  const files = (await readdir(folder)).filter((f) => Object.values(ASSIGN).some((a) => f === `${a.motion}.vrma`));
  expect(files).toHaveLength(4);
  // Only the corner placement is taken from the Playground's resident.
  const { design: playground } = (() => {
    const content = path.resolve('.work/behaviour-motions-live/content');
    writeContent(path.resolve('.'), content);
    return { design: path.join(content, 'design.json') };
  })();
  const resident = (JSON.parse(await readFile(playground, 'utf8')) as DesignDocument).decorations.find(
    (layer) => layer.id === 'resident',
  )!;
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-behaviour-live-')), false);
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    for (let i = 0; i < 60 && (await page.locator('#movie_player.ad-showing').count()); i++)
      await page.waitForTimeout(500);
    await showArtwork(popup);
    const { panel } = await openEditor(popup, page);
    await panel.locator('.model-file').setInputFiles(process.env.AROUND_CHARACTER_VRM!);
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 60000 });
    await panel.locator('.character-file').setInputFiles(files.map((f) => path.join(folder, f)));
    await expect(panel.locator('.character-motions li')).toHaveCount(4, { timeout: 60000 });
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const saved = (await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    )) as DesignDocument;
    const layer = saved.decorations[0] as ModelDecoration;
    const ids = layer.character!.motions.map((m) => m.id);
    const design: DesignDocument = {
      ...saved,
      decorations: [
        {
          ...layer,
          placement: { ...resident.placement },
          model: { ...layer.model, clip: ids.indexOf('idle'), playing: true, loop: true },
          character: {
            ...layer.character!,
            autonomy: true,
            personality: { shyness: 0.6, curiosity: 0.6, sleepiness: 0.5 },
            behaviourMotions: ASSIGN,
          },
        },
      ],
    };
    await storeDesign(popup, design);
    // The artwork as stored, without its assets (a record for the person, kept in .work).
    await writeFile(path.join(shots, 'design.json'), JSON.stringify(design.decorations[0], null, 2));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
      v.muted = true;
      void v.play().catch(() => undefined);
    });
    const away = { x: 8, y: 8 };
    await page.mouse.move(away.x, away.y);
    await page.waitForTimeout(6000);
    const frame = () =>
      media(page).evaluate((e: HTMLElement) => {
        const f = JSON.parse(e.dataset.modelFrame!);
        return {
          clip: f.clip as number | null,
          timeMs: f.timeMs as number,
          behaviour: f.body?.autonomy?.behaviour,
          // Held by the guard (hidden; this frame is then the last one drawn).
          limited: Boolean(e.closest('[data-image-id]')?.hasAttribute('data-safety-limited')),
        };
      });
    const shoot = async (name: string) => {
      await expect
        .poll(() => media(page).evaluate((e) => !e.closest('[data-image-id]')?.hasAttribute('data-safety-limited')), {
          timeout: 5000,
        })
        .toBe(true)
        .catch(() => undefined);
      const clip = (await page.locator('#movie_player').boundingBox())!;
      await page.screenshot({ path: path.join(shots, `${name}.png`), clip });
    };
    const box = async () => (await page.locator('[data-image-id]').first().boundingBox())!;
    const report: Record<string, unknown> = {};
    const at = await box().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    // Behaviours last a moment, and the guard can hold the drawing (and so the frame read here)
    // while the player's bars come and go: wait for the behaviour within a window.
    const during = async (behaviour: string, timeout: number) => {
      let seen = await frame();
      for (const end = Date.now() + timeout; seen.behaviour !== behaviour && Date.now() < end;) {
        await page.waitForTimeout(40);
        seen = await frame();
      }
      return seen;
    };
    const rest = await frame();
    report['rest'] = rest;
    await shoot('rest');
    // A rush from the left: it flees, playing the jump's part at 1.5×.
    await page.mouse.move(at.x - 700, at.y);
    await page.waitForTimeout(250);
    await page.mouse.move(at.x - 70, at.y, { steps: 4 });
    const fleeing = await during('flee', 1500);
    report['flee'] = fleeing;
    await shoot('flee');
    report['fleeShot'] = { box: await box(), ...(await frame()) };
    await page.waitForTimeout(900);
    report['fleeLater'] = { box: await box(), ...(await frame()) };
    await shoot('flee-later');
    // Away: it comes home running (1.4 s after the pointer left, for well under a second).
    await page.mouse.move(away.x, away.y, { steps: 3 });
    const returning = await during('return', 4000);
    report['return'] = returning;
    await shoot('return');
    await page.waitForTimeout(8000);
    // A slow creep: it walks closer.
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(away.x + ((at.x - 500 - away.x) * i) / 30, away.y + ((at.y - away.y) * i) / 30);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(4000);
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(at.x - 500 + i * 7, at.y);
      await page.waitForTimeout(60);
    }
    const approaching = await during('approach', 5000);
    report['approach'] = approaching;
    await shoot('approach');
    console.log('BEHAVIOUR MOTIONS LIVE ' + JSON.stringify({ ids, report }));
    // Each behaviour seen plays its assigned motion, inside its part.
    for (const f of [rest, fleeing, returning, approaching]) {
      const entry = ASSIGN[f.behaviour as keyof typeof ASSIGN];
      if (!entry) continue;
      expect(f.clip, f.behaviour).toBe(ids.indexOf(entry.motion));
      expect(f.timeMs).toBeGreaterThanOrEqual(entry.from * 1000 - 1);
      expect(f.timeMs).toBeLessThanOrEqual(entry.to * 1000 + 1);
    }
    expect(rest.behaviour).toBe('rest');
    expect(fleeing.behaviour).toBe('flee');
    // The return and the approach are reached in most runs, but the guard can hold the drawing
    // (and the world with it) for many seconds on real YouTube (docs/autonomy-plan.md, chunk 3
    // findings): a run that never reached them says so here instead of passing silently.
    for (const [name, f] of [
      ['return', returning],
      ['approach', approaching],
    ] as const)
      if (f.behaviour !== name)
        test.info().annotations.push({
          type: 'not reached',
          description: `${name}: last drawn behaviour ${f.behaviour}, held by the guard: ${f.limited}`,
        });
  } finally {
    await context.close();
  }
});
