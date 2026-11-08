import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';
import { openEditor, closeEditorPages } from './helpers/editor';
import { showArtwork } from './helpers/artwork';
import { layeringBuild } from './helpers/layering-build';
import { roomFixture } from './helpers/room-fixture';
import { DEFAULT_SPACE_LOOK } from '../src/design/space';
import { PLATE_TEXT, READABLE_CONTRAST, contrast, luminance } from '../src/world/space';

/**
 * The readability's way out (docs/depth-foundation.md): a build that knows none of YouTube's text
 * parts (WW_SPACE_BREAK=names, standing in for YouTube renaming them) still has a plate under
 * every visible run of text, dense enough for 4.5:1, because the columns with bare text get one
 * large plate each. Without the way out these points sit on the bare room and the test fails.
 */
const test = base.extend<object, { extensionPath: string }>({
  extensionPath: [
    async ({}, use) => use(await layeringBuild(true, { WW_SPACE_PROBE: '1', WW_SPACE_BREAK: 'names', WW_DEV: '1' })),
    { scope: 'worker' },
  ],
});
const key = 'webWorldThemes.design.youtube';

async function showRoom(popup: Page, youtube: Page) {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.locator('#movie_player video').waitFor({ state: 'attached' });
  await showArtwork(popup);
  const { panel } = await openEditor(popup, youtube);
  await panel.locator('.model-file').setInputFiles({ name: 'room.glb', mimeType: '', buffer: roomFixture() });
  await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(youtube);
  const saved = (await popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key)) as {
    decorations: { assetId: string }[];
  } & Record<string, unknown>;
  // The brightest room the artwork can ask for: the readability's worst case.
  await popup.evaluate(async ([k, design]) => chrome.storage.local.set({ [k]: design }), [
    key,
    {
      ...saved,
      decorations: [],
      space: {
        ...DEFAULT_SPACE_LOOK,
        room: { assetId: saved.decorations[0]!.assetId },
        lights: { sun_night: 4, room_desk: 4, room_pendant: 4, screen: 4, screen_monitor: 4 },
        videoLight: 2,
      },
    },
  ] as const);
  await youtube.reload();
  await youtube.locator('#movie_player video').waitFor({ state: 'attached' });
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-room', 'ready', { timeout: 30000 });
}

/** Points behind every visible run of text outside the player and the pictures (CSS px). */
const textPoints = (youtube: Page) =>
  youtube.evaluate(() => {
    const pts: [number, number][] = [];
    const range = document.createRange();
    // Text on a part painted opaque of its own reads against that part, not the room.
    const opaque = (e: Element | null) => {
      for (let n = e; n && n.localName !== 'ytd-app'; n = n.parentElement) {
        const c =
          getComputedStyle(n)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [];
        if (c.length === 3 || (c.length === 4 && c[3]! >= 0.95)) return true;
      }
      return false;
    };
    const walker = document.createTreeWalker(document.querySelector('ytd-app')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement!;
      if (
        !n.nodeValue?.trim() ||
        parent.closest('#movie_player, img, [hidden], script, style') ||
        !parent.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
        opaque(parent)
      )
        continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 4 || r.height < 6 || r.bottom < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        for (let y = r.top + 2; y < Math.min(r.bottom, innerHeight) - 2; y += 6)
          for (let x = Math.max(0, r.left) + 1; x < Math.min(r.right, innerWidth) - 1; x += 12) pts.push([x, y]);
      }
    }
    return pts.slice(0, 4000);
  });

async function roomPixels(page: Page, points: [number, number][]) {
  await page.evaluate((p) => {
    delete document.documentElement.dataset['wwRoomPixels'];
    document.documentElement.dataset['wwRoomSample'] = JSON.stringify(p);
  }, points);
  await expect(page.locator('html')).toHaveAttribute('data-ww-room-pixels', /\[/, { timeout: 10000 });
  return JSON.parse((await page.locator('html').getAttribute('data-ww-room-pixels'))!) as number[][];
}

test('without the part names, every visible text still has a plate under it and reads at 4.5:1', async ({
  popup,
  youtube,
}) => {
  const fallbackLogs: string[] = [];
  youtube.on('console', (message) => {
    if (message.text().includes('読みやすさの逃げ道')) fallbackLogs.push(message.text());
  });
  await showRoom(popup, youtube);
  const frame = async () => JSON.parse((await youtube.locator('html').getAttribute('data-ww-room-frame'))!);
  // A still page reads its parts once a second: two reads, so a walk has finished.
  await youtube.waitForTimeout(2500);
  for (const scroll of [0, 600]) {
    await youtube.mouse.wheel(0, scroll);
    await youtube.waitForTimeout(1500);
    const points = await textPoints(youtube);
    expect(points.length).toBeGreaterThan(50);
    const boxes = (await frame()).boxes as number[][];
    // Every point is on a plate...
    const bare = points.filter(([x, y]) => !boxes.some(([l, t, r, b]) => x >= l! && x <= r! && y >= t! && y <= b!));
    if (bare.length)
      console.log(
        `[room-fallback] plates ${JSON.stringify(boxes)} fallback ${JSON.stringify((await frame()).fallback)} bare at`,
        await youtube.evaluate(
          (ps) =>
            ps.map(([x, y]) => {
              const e = document.elementFromPoint(x, y);
              return `${Math.round(x)},${Math.round(y)} ${e?.localName}#${e?.id}.${e?.className}`.slice(0, 90);
            }),
          bare.filter((_, i) => i % Math.ceil(bare.length / 12) === 0),
        ),
      );
    expect(bare, `text with no plate under it (scroll ${scroll})`).toEqual([]);
    // ...and the plate, over the brightest room, keeps the text readable.
    const scheme = (await frame()).scheme as 'dark' | 'light';
    const ratios = (await roomPixels(youtube, points)).map(([r, g, b]) =>
      contrast(PLATE_TEXT[scheme].text, luminance(r!, g!, b!)),
    );
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
  }
  // It was the way out that did it (no known part is left in this build).
  expect((await frame()).fallback.length).toBeGreaterThan(0);
  // A development build says so on the console (so a YouTube change that silently drops the
  // small plates is noticed), naming the columns it plated; nothing is sent anywhere.
  expect(fallbackLogs.length).toBeGreaterThan(0);
  expect(fallbackLogs[0]).toMatch(/読みやすさの逃げ道.*列 [1-9]\d* 本: \S+/);
});

test('the normal build has no fallback log at all', async () => {
  const bundle = await readFile(path.join(await layeringBuild(true), 'content/index.js'), 'utf8');
  expect(bundle).not.toContain('読みやすさの逃げ道');
});
