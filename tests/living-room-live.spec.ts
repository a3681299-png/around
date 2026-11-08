import { test, expect, type Page } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeContent } from '../scripts/playground/content';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion, waitForAdvertToEnd } from './helpers/youtube-live';
import { storeDesign } from './helpers/skin-verification';
import { layeringBuild, DEFAULT_LAYERING } from './helpers/layering-build';
import { DEFAULT_SPACE_LOOK } from '../src/design/space';
import { DEFAULT_SHOTS } from '../src/world/camera-shots';

/**
 * The living room on real YouTube (docs/living-room.md): Mirdo lives in the test room behind the
 * watch page (walks, sits, hides behind the desk), comes to the front while the room is hidden
 * and back when it opens; the room is flat at the top and opens at the comments and in the theater.
 * Explicit: WW_LIVE_LIVING=1, WW_ROOM_FILE=<packed room .glb>, WW_PLAYGROUND_MIRDO_ROOT=<the
 * private asset checkout>. Neither the room nor Mirdo is ever in the repository; pictures and the
 * recording go to .work/living-live (not committed). WW_SPACE_SCHEME=light, WW_SPACE_BRIGHT=1.
 */
const shots = path.resolve('.work/living-live');
const WATCH = 'https://www.youtube.com/watch?v=LC1a-DwUhls';

const frame = async (page: Page) =>
  JSON.parse((await page.locator('html').getAttribute('data-ww-room-frame')) ?? '{}') as {
    shot: string | null;
    camera: number[];
    resident: { activity: string; spot: string | null; body: boolean; away: string | null; roomSeen: number } | null;
  };

test('real YouTube: Mirdo lives in the room, the room opens from flat at the comments and in the theater', async () => {
  test.skip(
    process.env.WW_LIVE_LIVING !== '1' || !process.env.WW_ROOM_FILE || !process.env.WW_PLAYGROUND_MIRDO_ROOT,
    'Explicit real YouTube check (WW_LIVE_LIVING=1, WW_ROOM_FILE, WW_PLAYGROUND_MIRDO_ROOT).',
  );
  test.setTimeout(600000);
  await mkdir(shots, { recursive: true });
  const extensionPath = await layeringBuild(DEFAULT_LAYERING, { WW_SPACE_PROBE: '1' });
  const scheme = process.env.WW_SPACE_SCHEME === 'light' ? 'light' : 'dark';
  const bright = process.env.WW_SPACE_BRIGHT === '1';
  const tag = `${scheme}${bright ? '-bright' : ''}`;
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-living-live-')), false, {
    headed: true,
    width: 1600,
    height: 940,
    extensionPath,
    ...(process.env.WW_SPACE_VIDEO === '1' ? { videoDir: path.join(shots, `video-${tag}`) } : {}),
  });
  const log: string[] = [];
  const note = async (page: Page, label: string) => {
    const f = await frame(page);
    // The front drawing of the resident (shown only while it is in front).
    const front = await page.evaluate(() => {
      const hosts = [
        ...document.querySelectorAll(
          '#web-world-themes-decorations, #web-world-themes-page-decorations, #web-world-themes-video-decorations',
        ),
      ];
      for (const host of hosts) {
        const media = host.shadowRoot?.querySelector<HTMLElement>('.model-media');
        if (!media) continue;
        const node = media.closest<HTMLElement>('[data-image-id]');
        const r = node?.getBoundingClientRect();
        return {
          hidden: node?.hidden ?? null,
          renderer: media.dataset['renderer'] ?? null,
          rect: r ? [r.x, r.y, r.width, r.height].map(Math.round) : null,
        };
      }
      return null;
    });
    const line = `${label}: shot=${f.shot} camera=${JSON.stringify(f.camera)} resident=${JSON.stringify(f.resident)} front=${JSON.stringify(front)}`;
    log.push(line);
    console.log(`[living-live] ${line}`);
    return f;
  };
  const shoot = (page: Page, name: string) =>
    page.screenshot({ path: path.join(shots, `${tag}-${name}.png`), caret: 'initial' });
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
    // The extension's own errors (its content script logs to the page's console).
    page.on('console', (m) => {
      if (m.type() === 'error' && /Web World Themes|three|vrm/i.test(m.text()))
        log.push(`console: ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message.slice(0, 300)}`));
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await showArtwork(popup);
    const { panel } = await openEditor(popup, page).catch(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(3000);
      return openEditor(popup, page);
    });
    // The room and Mirdo go in through the real import and validation.
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel.locator('.model-file').setInputFiles(path.resolve(process.env.WW_ROOM_FILE!));
      if (
        await expect(panel.locator('.layer'))
          .toHaveCount(1, { timeout: 30000 })
          .then(
            () => true,
            () => false,
          )
      )
        break;
    }
    const content = path.resolve('.work/living-live/content');
    const { models } = writeContent(path.resolve('.'), content, process.env.WW_PLAYGROUND_MIRDO_ROOT);
    await panel.locator('.model-file').setInputFiles(
      path.join(
        content,
        models.find((n) => n.endsWith('.vrm'))!,
      ),
    );
    await expect(panel.locator('.layer')).toHaveCount(2, { timeout: 60000 });
    // Under their own names (Walk_Loop.vrma…), as a person imports them: the names say the clips.
    const manifest = JSON.parse(await readFile(path.join(content, 'manifest.json'), 'utf8')) as {
      assets: Record<string, { file: string; name: string }>;
    };
    const named = path.join(content, 'named');
    await mkdir(named, { recursive: true });
    const vrma = models.filter((n) => n.endsWith('.vrma'));
    const files = await Promise.all(
      vrma.map(async (file) => {
        const entry = Object.values(manifest.assets).find((a) => a.file === file)!;
        await copyFile(path.join(content, file), path.join(named, entry.name));
        return path.join(named, entry.name);
      }),
    );
    await panel.locator('.character-file').setInputFiles(files);
    await expect(panel.locator('.character-motions li')).toHaveCount(vrma.length, { timeout: 60000 });
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const saved = (await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    )) as { decorations: { id: string; assetId: string; source?: { format?: string } }[] } & Record<string, unknown>;
    expect(saved['schemaVersion']).toBe(18);
    const roomId = saved.decorations.find((l) => l.source?.format !== 'vrm')!.assetId;
    const resident = saved.decorations.find((l) => l.source?.format === 'vrm')!;
    const design = JSON.parse(await readFile(path.join(content, 'design.json'), 'utf8'));
    const home = design.decorations.find((l: { id: string }) => l.id === 'resident');
    const noon = Number(process.env.WW_SPACE_NOON ?? 0.12);
    await storeDesign(popup, {
      ...saved,
      decorations: [
        {
          ...resident,
          placement: home.placement,
          character: { ...(resident as never as { character: object }).character, ...{ autonomy: true } },
        },
      ],
      space: {
        ...DEFAULT_SPACE_LOOK,
        room: { assetId: roomId },
        lights: bright
          ? { sun_noon: 4, sun_night: 4, room_desk: 4, room_pendant: 4, screen: 4, screen_monitor: 4 }
          : { ...DEFAULT_SPACE_LOOK.lights, ...(noon > 0 ? { sun_noon: noon } : {}) },
        ...(bright ? { videoLight: 2 } : {}),
        camera: {
          ...DEFAULT_SPACE_LOOK.camera,
          shots: { top: DEFAULT_SHOTS.top, comments: DEFAULT_SHOTS.comments, theater: DEFAULT_SHOTS.theater },
          transition: DEFAULT_SHOTS.transition,
        },
        resident: { layerId: resident.id, front: 0.8 },
      },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await expect(page.locator('html')).toHaveAttribute('data-ww-room', 'ready', { timeout: 60000 });
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
      v.muted = true;
      void v.play();
    });
    await waitForAdvertToEnd(page).catch(() => undefined);
    await declinePromotion(page);
    await page.mouse.move(800, 470);
    await expect.poll(async () => (await frame(page)).resident?.body, { timeout: 60000 }).toBe(true);

    // 1. The top: the room far and flat; the character lives there (or has gone to the front).
    await page.waitForTimeout(2000);
    const top = await note(page, 'top');
    expect(top.shot).toBe('top');
    await shoot(page, '1-top');

    // 2. Down to the comments: the room opens (the shot changes over the transition).
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(400);
    await page
      .locator('ytd-comments#comments')
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    await page.mouse.wheel(0, 300);
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(450);
      await shoot(page, `2-opening-${i}`);
    }
    await expect.poll(async () => (await frame(page)).shot, { timeout: 10000 }).toBe('comments');
    // 3. Living at the comments: a few moments over 40 s.
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(5000);
      await note(page, `comments ${i}`);
      await shoot(page, `3-comments-${i}`);
    }
    const living = (await frame(page)).resident!;
    expect(living.away).toBe(resident.id);

    // 4. Back to the top for a while: the room hides behind the player and the list.
    await page.mouse.wheel(0, -3000);
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(3000);
      await note(page, `top again ${i}`);
      await shoot(page, `4-top-again-${i}`);
    }

    // 5. The theater: the room opens on both sides.
    await page.locator('#movie_player').hover();
    await page.keyboard.press('t');
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(3000);
      await note(page, `theater ${i}`);
      await shoot(page, `5-theater-${i}`);
    }
    await expect.poll(async () => (await frame(page)).shot, { timeout: 10000 }).toBe('theater');
    await page.keyboard.press('t');
    await page.waitForTimeout(2500);
    await note(page, 'theater left');
    await shoot(page, '6-after-theater');
  } finally {
    console.log(log.join('\n'));
    await context.close();
  }
});
