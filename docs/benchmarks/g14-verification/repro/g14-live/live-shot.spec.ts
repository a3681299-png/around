// Scratch (not committed): one real-YouTube screenshot with an opaque pointer-follow layer over the
// player's control bar, left idle for 2s so only the G1.4 recheck reads the page.
import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from '../../tests/fixtures';
import { openEditor } from '../../tests/helpers/editor';
import { declinePromotion, waitForAdvertToEnd } from '../../tests/helpers/youtube-live';
import { defaultSignalRule } from '../../src/signals/keyframes';
import { build } from 'esbuild';

test('G1.4 live shot', async () => {
  test.setTimeout(240000);
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g14-live/profile-')), false);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube', { timeout: 30000 });
    await page.waitForTimeout(1000);
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    const pause = page.getByRole('button', { name: /^Pause|^一時停止/ }).first();
    if (await pause.isVisible()) await pause.click();
    const { studio, panel } = await openEditor(popup, page);
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 120;
      const g = c.getContext('2d')!;
      g.fillStyle = '#00dfff';
      g.fillRect(0, 0, 160, 120);
      return c.toDataURL().split(',')[1];
    });
    await panel
      .locator('.file')
      .setInputFiles({ name: 'g14.png', mimeType: 'image/png', buffer: Buffer.from(png!, 'base64') });
    await expect(panel.locator('.layer')).toHaveCount(1);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    const saved: any = await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    );
    await studio.close();
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.ytp-chrome-bottom')!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
    });
    const innerSize = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const follow = defaultSignalRule('g14', 'position.x', {
      signal: 'pointer.x',
      axis: 'x',
      space: 'viewport',
      inputRange: [0, 1],
    });
    follow.keyframes[0]!.value = 0;
    follow.keyframes[1]!.value = 40;
    await popup.evaluate((design) => chrome.storage.local.set({ 'around.design.youtube': design }), {
      ...saved,
      decorations: [
        // One over the picture (drawn whole), one across the like/share row (cut around the buttons).
        ...[
          { id: 'g14', x: 300, y: 300, w: 220, h: 160 },
          { id: 'g14-row', x: 860, y: 700, w: 360, h: 90 },
        ].map((p) => ({
          ...saved.decorations[0],
          id: p.id,
          name: p.id,
          placement: {
            anchor: { kind: 'viewport' },
            x: p.x / innerSize.w,
            y: p.y / innerSize.h,
            widthPx: p.w,
            heightPx: p.h,
            rotationDeg: 0,
          },
        })),
      ],
      signalRules: [follow],
    });
    await expect(page.locator('[data-image-id]')).toHaveCount(2);
    await page.mouse.move(1300, 950, { steps: 3 });
    // YouTube's comment/control discovery can still be changing after load. A safety stop during
    // that churn is a different reason for invisibility; compare the settled compositor itself.
    const stopped = () =>
      page
        .locator('#around-decorations')
        .evaluate((node) => JSON.parse((node as HTMLElement).dataset.aroundSafety ?? '{}').stopped ?? '');
    await expect.poll(stopped, { timeout: 45000 }).toBe('');
    const noInputSince = await page.evaluate(() => performance.now());
    await page.waitForTimeout(Number(process.env.G14_IDLE_MS ?? 3000));
    await expect.poll(stopped, { timeout: 45000 }).toBe('');
    const state: any = await page.evaluate(() => ({
      at: performance.now(),
      hidden: document.hidden,
      geometry: JSON.parse(document.documentElement.getAttribute('data-around-guard-geometry') ?? '[]'),
      rechecks: JSON.parse(document.documentElement.getAttribute('data-around-g14-rechecks') ?? '[]'),
      clip: document
        .querySelector<HTMLElement>('#around-decorations')
        ?.style.getPropertyValue('--around-decoration-clip'),
      safety: document.querySelector('#around-decorations')?.getAttribute('data-around-safety'),
      layers: [...document.querySelectorAll<HTMLElement>('[id$="decorations"]')].flatMap((host) =>
        [...(host.shadowRoot?.querySelectorAll<HTMLElement>('[data-image-id]') ?? [])].map((node) => ({
          host: host.id,
          id: node.dataset.imageId,
          rect: node.getBoundingClientRect().toJSON(),
          visibility: getComputedStyle(node).visibility,
          opacity: getComputedStyle(node).opacity,
          clip: getComputedStyle(host).clipPath,
          nodeClip: getComputedStyle(node).clipPath,
        })),
      ),
      player: document.querySelector('#movie_player')!.getBoundingClientRect().toJSON(),
    }));
    state.noInputSince = noInputSince;
    const cdp = await context.newCDPSession(page);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const label = process.env.G14_LABEL ?? 'after';
    await writeFile(path.resolve(`.work/g14-live/${label}-idle.png`), Buffer.from(shot.data, 'base64'));
    const bundle = await build({
      stdin: {
        contents: "export {youtubeOperations} from './src/sites/youtube-operations';",
        resolveDir: path.resolve(process.env.G14_SOURCE_ROOT ?? '.'),
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'G14Native',
      dropLabels: ['AROUND_GUARD_TRACE', 'AROUND_TEST_PAGE_CHANGE'],
    });
    const expression =
      bundle.outputFiles[0]!.text +
      `;(()=>{
      const source=window.G14Native.youtubeOperations(document);const snapshot=source.capture({fresh:true});source.destroy();
      return snapshot;
    })()`;
    // DevTools evaluates diagnostic code without changing YouTube's Trusted Types policy or DOM.
    const evaluated = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
    state.native = evaluated.result.value;
    state.browser = context.browser()?.version();
    state.label = label;
    await writeFile(path.resolve(`.work/g14-live/${label}-state.json`), JSON.stringify(state, null, 2));
    await cdp.detach();
  } finally {
    await context.close();
  }
});
