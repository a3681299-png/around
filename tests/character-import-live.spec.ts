import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion, waitForAdvertToEnd } from './helpers/youtube-live';
import type { DesignDocument, ModelDecoration } from '../src/design/types';

/**
 * Reading is enough (docs/product-design-snapshot.md, "読み込むだけで、感情に応じて動く"): a person's
 * VRM and a folder of .vrma (never in the repository: WW_CHARACTER_VRM, WW_CHARACTER_MOTIONS) are
 * read through the editor with nothing set by hand. On real YouTube the character is then seen while
 * watching (at its home, the player's corner), sits on the edge at rest, plays the motion the import
 * assigned to each behaviour as the autonomy switches, and does not flicker with the pointer on it.
 * Headed off screen (a real GPU, the look a person sees). Explicit: WW_LIVE_CHARACTER_IMPORT=1.
 * Pictures and records stay in .work/character-import-live (they show the person's model).
 */
const out = path.resolve('.work/character-import-live');
const media = (page: Page) =>
  page.locator(
    ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations) .model-media',
  );
const wrapper = (page: Page) => media(page).locator('xpath=ancestor::*[@data-image-id][1]');

test('real YouTube: a character read with its motions is seen, sits at home and moves by itself', async () => {
  test.skip(
    process.env.WW_LIVE_CHARACTER_IMPORT !== '1' || !process.env.WW_CHARACTER_VRM || !process.env.WW_CHARACTER_MOTIONS,
    'Explicit: WW_LIVE_CHARACTER_IMPORT=1 with WW_CHARACTER_VRM and WW_CHARACTER_MOTIONS.',
  );
  test.setTimeout(420000);
  await mkdir(out, { recursive: true });
  const folder = process.env.WW_CHARACTER_MOTIONS!;
  const files = (await readdir(folder)).filter((f) => f.endsWith('.vrma')).map((f) => path.join(folder, f));
  expect(files.length).toBeGreaterThan(0);
  const profile = await mkdtemp(path.resolve('.work/p-'));
  const context = await launchExtension(profile, false, { headed: true, width: 1280, height: 860 });
  const report: Record<string, unknown> = {};
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
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
    await waitForAdvertToEnd(page);
    await showArtwork(popup);
    const { panel } = await openEditor(popup, page);
    const started = Date.now();
    await panel.locator('.model-file').setInputFiles(process.env.WW_CHARACTER_VRM!);
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 60000 });
    await panel.locator('.character-file').setInputFiles(files);
    await expect(panel.locator('.character-motions li')).toHaveCount(files.length, { timeout: 90000 });
    report['importMs'] = Date.now() - started;
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const saved = (await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    )) as DesignDocument;
    const layer = saved.decorations[0] as ModelDecoration;
    const ids = layer.character!.motions.map((m) => m.id);
    const assigned = layer.character!.behaviourMotions ?? {};
    report['placement'] = layer.placement;
    report['roles'] = layer.character!.motions.map((m) => [m.id, m.role, m.loop]);
    report['assigned'] = assigned;
    // Nothing was set by hand: the home, the autonomy and the behaviours come from the import.
    expect(layer.placement.anchor).toEqual({ kind: 'surface', target: 'video-player' });
    expect(layer.character!.autonomy).toBe(true);
    expect(Object.keys(assigned).sort()).toEqual(['approach', 'doze', 'flee', 'rest', 'return']);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
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
          behaviour: f.body?.autonomy?.behaviour as string | undefined,
          seat: Boolean(f.body?.pose?.seat ?? f.pose?.seat),
          limited: Boolean(e.closest('[data-image-id]')?.hasAttribute('data-safety-limited')),
        };
      });
    const box = async () => (await wrapper(page).boundingBox())!;
    // Seen: what is on the screen over the character's box changes when the character is hidden.
    const seen = async (name: string) => {
      const b = await box();
      const clip = { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.width, height: b.height };
      const shown = await page.screenshot({ path: path.join(out, `${name}.png`), clip });
      await wrapper(page).evaluate((e: HTMLElement) => (e.style.visibility = 'hidden'));
      await page.waitForTimeout(120);
      const hidden = await page.screenshot({ clip });
      await wrapper(page).evaluate((e: HTMLElement) => (e.style.visibility = ''));
      let differ = 0;
      for (let i = 0; i < Math.min(shown.length, hidden.length); i += 16) if (shown[i] !== hidden[i]) differ++;
      return differ;
    };
    const during = async (behaviour: string, timeout: number) => {
      let f = await frame();
      for (const end = Date.now() + timeout; f.behaviour !== behaviour && Date.now() < end;) {
        await page.waitForTimeout(40);
        f = await frame();
      }
      return f;
    };
    // Rest at home: seen, sitting on the edge, playing the rest motion.
    const rest = await during('rest', 4000);
    report['rest'] = rest;
    report['restSeen'] = await seen('rest');
    await page.screenshot({ path: path.join(out, 'watching.png') });
    // A rush from the left: it flees.
    const at = await box().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    await page.mouse.move(at.x - 700, at.y);
    await page.waitForTimeout(250);
    await page.mouse.move(at.x - 70, at.y, { steps: 4 });
    const flee = await during('flee', 1500);
    report['flee'] = flee;
    await page.screenshot({ path: path.join(out, 'flee.png') });
    // Away: it goes home.
    await page.mouse.move(away.x, away.y, { steps: 3 });
    const back = await during('return', 4000);
    report['return'] = back;
    await page.screenshot({ path: path.join(out, 'return.png') });
    await during('rest', 10000);
    // The pointer on the character: no frame held, nothing hidden (the flicker).
    const home = await box();
    await page.evaluate(() => {
      const w = window as unknown as { wwHeld: number; wwFrames: number; wwStop: boolean };
      w.wwHeld = w.wwFrames = 0;
      w.wwStop = false;
      const tick = () => {
        const m = document.querySelector('[id^="web-world-themes"]')
          ? [...document.querySelectorAll('[id^="web-world-themes"]')]
              .map((h) => h.shadowRoot?.querySelector('.model-media')?.closest('[data-image-id]'))
              .find(Boolean)
          : undefined;
        w.wwFrames++;
        if (!m || m.hasAttribute('data-safety-limited')) w.wwHeld++;
        if (!w.wwStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const cx = home.x + home.width / 2,
      cy = home.y + home.height / 2;
    await page.mouse.move(cx, cy, { steps: 8 });
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(cx + Math.sin(i / 4) * home.width * 0.2, cy);
      await page.waitForTimeout(60);
    }
    report['pointerOnCharacter'] = await page.evaluate(() => {
      const w = window as unknown as { wwHeld: number; wwFrames: number; wwStop: boolean };
      w.wwStop = true;
      return { frames: w.wwFrames, held: w.wwHeld };
    });
    await page.screenshot({ path: path.join(out, 'pointer-on.png') });
    console.log('CHARACTER IMPORT LIVE ' + JSON.stringify({ ids, report }));
    await writeFile(path.join(out, 'report.json'), JSON.stringify({ ids, report }, null, 1));

    expect(rest.behaviour).toBe('rest');
    expect(rest.clip).toBe(ids.indexOf(assigned.rest!.motion));
    expect(report['restSeen'] as number, 'the character is seen while watching').toBeGreaterThan(50);
    expect(flee.behaviour).toBe('flee');
    expect(flee.clip).toBe(ids.indexOf(assigned.flee!.motion));
    const pointer = report['pointerOnCharacter'] as { frames: number; held: number };
    expect(pointer.frames).toBeGreaterThan(60);
    expect(pointer.held, 'frames held with the pointer on the character').toBe(0);
    if (back.behaviour !== 'return')
      test.info().annotations.push({ type: 'not reached', description: `return: last ${back.behaviour}` });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
