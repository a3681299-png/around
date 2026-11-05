import { build } from 'esbuild';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor, closeEditorPages } from './helpers/editor';
import { exposeEditorControls } from './helpers/editor-workspace';
import { showArtwork } from './helpers/artwork';
import { layeringBuild } from './helpers/layering-build';

/**
 * Chunk 4 (docs/layering-plan.md): the player's character inside the player's own
 * stacking, directly after its media at the media's level. What the player paints over its picture
 * is then painted over the character by the browser; the guard checks only what it cannot prove.
 */
async function compositionCode() {
  const result = await build({
    stdin: {
      contents: `export {createCompositionReader} from './src/host/operation-composition';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'LayeringProbe',
  });
  return result.outputFiles[0]!.text;
}

test('paintsAbove proves paint order from stacking contexts alone, and nothing it cannot', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await compositionCode() });
  const result = await youtube.evaluate(() => {
    const host = document.createElement('div');
    // A player-like context: media at 10, bars at 59, a fading bar (opacity) at 24, a part at the
    // media's level after it, one before it, an unpositioned wrapper with a context inside, and a
    // control in plain flow and one positioned without a z-index.
    host.innerHTML = `
      <div id="p" style="position:relative;z-index:0;width:400px;height:200px">
        <div id="early" style="position:absolute;z-index:10"><button id="earlyButton">e</button></div>
        <div id="media" style="position:relative;z-index:10"></div>
        <div id="same" style="position:absolute;z-index:10"><button id="sameButton">s</button></div>
        <div id="bar" style="position:absolute;z-index:59"><button id="barButton">b</button></div>
        <div id="fade" style="position:absolute;z-index:24;opacity:.5"><span id="fadeText">f</span></div>
        <div id="wrap"><div id="inner" style="position:absolute;z-index:36"><a id="innerLink" href="#">i</a></div></div>
        <div id="flow"><button id="flowButton">n</button></div>
        <div id="auto" style="position:absolute"><button id="autoButton">a</button></div>
        <div id="low" style="position:absolute;z-index:3"><button id="lowButton">l</button></div>
      </div>
      <div id="outside" style="position:fixed;z-index:5"><button id="outsideButton">o</button></div>`;
    document.body.append(host);
    const reader = (window as any).LayeringProbe.createCompositionReader(document);
    const media = document.getElementById('media')!;
    const above = (id: string) => reader.paintsAbove(document.getElementById(id)!, media);
    const out = Object.fromEntries(
      [
        'earlyButton',
        'sameButton',
        'barButton',
        'fadeText',
        'innerLink',
        'flowButton',
        'autoButton',
        'lowButton',
        'outsideButton',
      ].map((id) => [id, above(id)]),
    );
    // The player as a whole against the fixed element outside: level 5 over the player's 0.
    const outsideOverPlayer = reader.paintsAbove(
      document.getElementById('outsideButton')!,
      document.getElementById('p')!,
    );
    host.remove();
    return { ...out, outsideOverPlayer };
  });
  expect(result).toEqual({
    // Same level, earlier in tree order: under the media.
    earlyButton: false,
    // Same level, later: over it (and over a plane inserted directly after the media).
    sameButton: true,
    barButton: true,
    fadeText: true,
    // An unpositioned wrapper does not make a context; the context inside it decides.
    innerLink: true,
    // Plain flow and positioned without z-index paint below any positive level: not proven.
    flowButton: false,
    autoButton: false,
    lowButton: false,
    // Outside the player's context, at a level above the player's: over the media too.
    outsideButton: true,
    outsideOverPlayer: true,
  });
});

/** Always the layering build, whichever the project's (these tests are about it). */
const layered = test.extend({ layering: [true, { scope: 'worker' }] });

/** The fixture's player made like YouTube's: its own stacking context, the media in a container at
 * level 10, the bars at 58 and 59. */
async function youtubeStacking(youtube: Page) {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.locator('#movie_player video').waitFor({ state: 'attached' });
  // The fixture's player is built like YouTube's (tests/fixtures/youtube.html): check it is.
  expect(
    await youtube.evaluate(() => {
      const player = document.querySelector<HTMLElement>('#movie_player')!;
      const z = (selector: string) => getComputedStyle(player.querySelector(selector)!).zIndex;
      return [
        getComputedStyle(player).zIndex,
        z('.html5-video-container'),
        z('.ytp-chrome-top'),
        z('.ytp-chrome-bottom'),
      ];
    }),
  ).toEqual(['0', '10', '58', '59']);
}

async function characterOverBar(popup: Page, youtube: Page) {
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    c.getContext('2d')!.fillRect(0, 0, 64, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'opaque.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await expect(youtube.locator('[data-image-id]').first()).toBeAttached();
  await editor.getByLabel('配置の基準').selectOption('video-player');
  await editor.getByLabel('画像の幅').fill('160');
  await editor.getByLabel('画像の高さ').fill('120');
  // The bottom-right corner, over the settings and fullscreen buttons.
  await editor.getByLabel('画像のX位置').fill('88');
  await editor.getByLabel('画像のY位置').fill('90');
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(youtube);
}

/** Frames, in the page, where the image is stopped by the guard (hidden). */
async function countStops(youtube: Page) {
  await youtube.evaluate(() => {
    const w = window as unknown as { wwFrames: number; wwStopped: number };
    w.wwFrames = w.wwStopped = 0;
    const tick = () => {
      const host = document.querySelector('#web-world-themes-video-decorations');
      const node = host?.shadowRoot?.querySelector('[data-image-id]');
      w.wwFrames++;
      if (!node || node.hasAttribute('data-safety-limited')) w.wwStopped++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () =>
    youtube.evaluate(() => {
      const w = window as unknown as { wwFrames: number; wwStopped: number };
      const out = { frames: w.wwFrames, stopped: w.wwStopped };
      w.wwFrames = w.wwStopped = 0;
      return out;
    });
}

layered(
  'the character under the bars stays drawn while they come and go and a menu opens; the bars stay on top and work',
  async ({ popup, youtube }) => {
    await youtubeStacking(youtube);
    await characterOverBar(popup, youtube);
    // Directly after the media, at its level.
    await expect
      .poll(() =>
        youtube.evaluate(() => {
          const host = document.querySelector<HTMLElement>('#web-world-themes-video-decorations');
          return Boolean(
            host?.shadowRoot?.querySelector('[data-image-id]') &&
            host.previousElementSibling?.classList.contains('html5-video-container') &&
            getComputedStyle(host).zIndex === '10',
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        youtube.evaluate(
          () =>
            !document
              .querySelector('#web-world-themes-video-decorations')
              ?.shadowRoot?.querySelector('[data-image-id]')
              ?.hasAttribute('data-safety-limited'),
        ),
      )
      .toBe(true);
    const stops = await countStops(youtube);
    await stops();
    // The bars hide and show (the player's class), and the settings menu opens over the picture.
    for (let i = 0; i < 4; i++) {
      await youtube.evaluate(() => document.querySelector('#movie_player')!.classList.toggle('ytp-autohide'));
      await youtube.waitForTimeout(150);
    }
    await youtube.evaluate(() => {
      const menu = document.createElement('div');
      menu.className = 'ytp-popup ytp-settings-menu';
      menu.style.cssText =
        'position:absolute;z-index:2300;right:12px;bottom:56px;width:180px;height:90px;background:#222';
      menu.innerHTML = '<div role="menuitem" tabindex="0">Quality</div>';
      document.querySelector('#movie_player')!.append(menu);
    });
    await youtube.waitForTimeout(400);
    const during = await stops();
    expect(during.frames).toBeGreaterThan(20);
    expect(during.stopped).toBe(0);
    // G1: what is under the bar's buttons is the button; a real click reaches it.
    const reach = await youtube.evaluate(() =>
      ['Play', 'YouTube settings', 'Fullscreen'].map((label) => {
        const b = document.querySelector<HTMLElement>(`#movie_player [aria-label="${label}"]`)!;
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit && (hit === b || b.contains(hit)));
      }),
    );
    expect(reach).toEqual([true, true, true]);
    await youtube.evaluate(() => {
      const b = document.querySelector('#movie_player [aria-label="Fullscreen"]')!;
      b.addEventListener('click', () => b.setAttribute('data-clicked', ''), { once: true });
    });
    await youtube.locator('#movie_player [aria-label="Fullscreen"]').click();
    await expect(youtube.locator('#movie_player [aria-label="Fullscreen"]')).toHaveAttribute('data-clicked', '');
  },
);

layered(
  'a player control not proven to paint over the character sends it the cut-out way while they meet',
  async ({ popup, youtube }) => {
    await youtubeStacking(youtube);
    await characterOverBar(popup, youtube);
    const way = () => planeWay(youtube);
    await expect.poll(way).toBe('beneath');
    // A button positioned without a z-index paints below the media's level: drawn under the
    // controls, the character would cover it. While they meet, the character is cut out as before
    // (the way out), and it goes back under the controls once the button is gone.
    await unprovenControl(youtube, { gap: -60 });
    await expect.poll(way).toBe('cut out');
    await youtube.evaluate(() => document.getElementById('unproven')!.remove());
    await expect.poll(way, { timeout: 5000 }).toBe('beneath');
  },
);

/** Which way the character is drawn: under the controls (after the media, at its level) or cut
 * out (the plane over the player's parts, its bands and overlays clipped). */
const planeWay = (youtube: Page) =>
  youtube.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#web-world-themes-video-decorations');
    if (!host?.shadowRoot?.querySelector('[data-image-id]')) return 'none';
    const before = host.previousElementSibling as HTMLElement | null;
    return before?.classList.contains('html5-video-container') &&
      getComputedStyle(host).zIndex === getComputedStyle(before).zIndex
      ? 'beneath'
      : 'cut out';
  });

/** An unproven control (positioned without a z-index, so below the plane's level) put beside the
 * character's box, `gap` px from its left edge (negative: overlapping), or in the player's
 * top-left corner (`far`). */
async function unprovenControl(youtube: Page, where: { gap: number } | 'far') {
  const box = (await youtube.locator('#web-world-themes-video-decorations [data-image-id]').boundingBox())!;
  const player = (await youtube.locator('#movie_player').boundingBox())!;
  await youtube.evaluate(
    ({ where, box, player }) => {
      document.getElementById('unproven')?.remove();
      const wrap = document.createElement('div');
      wrap.id = 'unproven';
      const left = where === 'far' ? 20 : box.x - player.x - where.gap - 30;
      const top = where === 'far' ? 70 : box.y - player.y + 10;
      wrap.innerHTML = `<button style="position:absolute;left:${left}px;top:${top}px;width:30px;height:24px">x</button>`;
      document.querySelector('#movie_player')!.append(wrap);
    },
    { where, box, player },
  );
}
/** Stopped frames while the player's own class changes (a read is pending each time). */
async function stoppedWhileBarsToggle(youtube: Page) {
  const stops = await countStops(youtube);
  await youtube.waitForTimeout(600);
  await stops();
  // The bars change as YouTube's do (a button comes and goes in them): each change is a layout
  // change, which keeps a read pending for a moment (the guard's HOLD in the cut-out way).
  for (let i = 0; i < 6; i++) {
    await youtube.evaluate(() => {
      const player = document.querySelector('#movie_player')!;
      player.classList.toggle('ytp-autohide');
      const extra = player.querySelector('#bar-extra');
      if (extra) extra.remove();
      else
        player
          .querySelector('.ytp-right-controls')!
          .insertAdjacentHTML('afterbegin', '<button class="ytp-button" id="bar-extra">+</button>');
    });
    await youtube.waitForTimeout(120);
  }
  await youtube.waitForTimeout(200);
  return stops();
}

layered(
  'an unproven control far from the character holds nothing; one beside it holds it while a read is pending',
  async ({ popup, youtube }) => {
    await youtubeStacking(youtube);
    await characterOverBar(popup, youtube);
    // Far (the player's other corner): the character is never stopped.
    await unprovenControl(youtube, 'far');
    const far = await stoppedWhileBarsToggle(youtube);
    expect(far.frames).toBeGreaterThan(20);
    expect(far.stopped).toBe(0);
    // Beside it (20 px away, not overlapping): held while each change is being read, as a control
    // near the pointer is in G1.2; drawn again in between.
    await unprovenControl(youtube, { gap: 20 });
    const near = await stoppedWhileBarsToggle(youtube);
    expect(near.stopped).toBeGreaterThan(0);
    expect(near.stopped).toBeLessThan(near.frames);
  },
);

/** The layering build with its stacking proof removed on purpose (WW_NO_STACKING_PROOF=1). */
const unproofed = test.extend({
  extensionPath: [
    async ({}, use) => use(await layeringBuild(true, { WW_NO_STACKING_PROOF: '1' })),
    { scope: 'worker' },
  ],
});

unproofed(
  'without the stacking proof, an unproven control under the character is left covered (the check is real)',
  async ({ popup, youtube }) => {
    await youtubeStacking(youtube);
    await characterOverBar(popup, youtube);
    await unprovenControl(youtube, { gap: -60 });
    // With the proof the character goes the cut-out way here (the test above); without it, it stays
    // under the controls over the button, and nothing holds it.
    await youtube.waitForTimeout(800);
    expect(await planeWay(youtube)).toBe('beneath');
    const result = await stoppedWhileBarsToggle(youtube);
    expect(result.frames).toBeGreaterThan(20);
    expect(result.stopped).toBe(0);
  },
);
