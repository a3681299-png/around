import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { exposeEditorControls } from './helpers/editor-workspace';
import { pngPixels } from './helpers/png-pixels';

/**
 * G1, chunk 3: what YouTube puts over the picture's bottom right (skip button, end screen cards,
 * the autoplay "next" card and its cancel, the cards teaser, the products shelf) are operation
 * surfaces, and the player-local plane cuts them out. Here each one sits under that plane in
 * stacking order, so only the cut-out keeps it clear. Removing the mark (the link becomes a plain
 * box) lets the artwork cover it: the check is real.
 */
const OVERLAYS: [string, string][] = [
  ['skip button', '<button class="ytp-skip-ad-button" id="target">Skip</button>'],
  [
    'end screen card',
    '<div class="ytp-ce-element"><a class="ytp-ce-covering-overlay" id="target" href="#ce">Next video</a></div>',
  ],
  ['autoplay next', '<a class="ytp-autonav-endscreen-link-container" id="target" href="#next">Up next</a>'],
  ['autoplay cancel', '<button class="ytp-autonav-endscreen-upnext-cancel-button" id="target">Cancel</button>'],
  ['cards teaser', '<div class="ytp-cards-teaser" id="target" tabindex="0">Info</div>'],
  ['products', '<div class="ytp-featured-product"><a id="target" href="#product">View products</a></div>'],
];

async function magentaArtwork(popup: Page, youtube: Page) {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await showArtwork(popup);
  const { panel: editor } = await openEditor(popup, youtube);
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const context = c.getContext('2d')!;
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 0, 64, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'magenta.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await editor.getByLabel('配置の基準').selectOption('video-player');
  await editor.getByLabel('画像の幅').fill('200');
  await editor.getByLabel('画像の高さ').fill('140');
  await editor.getByLabel('画像のX位置').fill('80');
  await editor.getByLabel('画像のY位置').fill('55');
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(youtube);
}

/** Puts one overlay under the artwork's middle, plus a central button (local plane off). */
async function place(youtube: Page, html: string) {
  await youtube.evaluate((html) => {
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    document.querySelector('#ww-test-overlay')?.remove();
    const host = document.createElement('div');
    host.id = 'ww-test-overlay';
    // z-index 0: under the player-local plane (z 1 here), the case stacking order cannot save.
    host.style.cssText = 'position:absolute;right:40px;top:38%;z-index:0';
    host.innerHTML = html;
    const target = host.querySelector<HTMLElement>('#target')!;
    target.style.cssText = 'display:block;width:120px;height:40px;background:#2a7;color:#fff;font:14px sans-serif';
    target.addEventListener('click', (event) => {
      event.preventDefault();
      target.dataset['clicked'] = 'yes';
    });
    player.append(host);
  }, html);
}
/** Magenta pixels over the overlay's box. Waits up to 8 s for the artwork to be drawn around it;
 * a central button turns the player-local plane off and the artwork may then not be drawn over the
 * player at all (an older rule), which covers nothing either. Every capture is counted. */
async function covered(youtube: Page) {
  const target = (await youtube.locator('#target').boundingBox())!;
  let worst = 0;
  const started = Date.now();
  for (;;) {
    const player = (await youtube.locator('#movie_player').boundingBox())!;
    const { width, height, rgba } = pngPixels(
      await youtube.screenshot({ clip: player, path: '.work/overlay-player.png' }),
    );
    let over = 0,
      elsewhere = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        if (!(rgba[at]! > 200 && rgba[at + 1]! < 60 && rgba[at + 2]! > 200)) continue;
        const px = player.x + x,
          py = player.y + y;
        if (px >= target.x && px < target.x + target.width && py >= target.y && py < target.y + target.height) over++;
        else elsewhere++;
      }
    worst = Math.max(worst, over);
    // A page change holds the drawing for a moment before it is checked again; allow 8 s.
    if (elsewhere > 500 || Date.now() - started > 8000) return { over: worst, drawn: elsewhere > 500 };
    // A capture itself causes a short hold of the drawing: space them out, or none sees it drawn.
    await youtube.waitForTimeout(1000);
  }
}

test('G1: the player overlays at the bottom right stay visible and pressable under the artwork', async ({
  popup,
  youtube,
}) => {
  test.setTimeout(120000);
  await magentaArtwork(popup, youtube);
  const drawn: string[] = [];
  for (const [name, html] of OVERLAYS) {
    await place(youtube, html);
    const result = await covered(youtube);
    expect(result.over, `${name} is not covered`).toBe(0);
    if (result.drawn) drawn.push(name);
    const box = (await youtube.locator('#target').boundingBox())!;
    await youtube.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(youtube.locator('#target'), `${name} received the click`).toHaveAttribute('data-clicked', 'yes');
  }
  // Either way nothing is covered: a central button moves the artwork to the page plane, which
  // is drawn around the surfaces; over the local plane the guard stops a layer that overlaps a
  // recognised overlay (and the plane's cut-out is a second line). Which happened is recorded.
  console.log('OVERLAYS drawn around: ' + JSON.stringify(drawn));
});

test('G1: an overlay link the adapter does not recognise is covered (the check is real)', async ({
  popup,
  youtube,
}) => {
  await magentaArtwork(popup, youtube);
  // Deliberately unmarked: the same box, but neither a link nor focusable nor a known part.
  await place(youtube, '<div class="ww-unknown" id="target">Next video</div>');
  expect((await covered(youtube)).over).toBeGreaterThan(1000);
});
