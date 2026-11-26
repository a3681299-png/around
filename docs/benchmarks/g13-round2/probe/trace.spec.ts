// G1.3 round 0 probe (not a product test): real YouTube, two moving layers (Codex's G1.2 visual
// condition), real wheel input at ~90ms, every rAF's visibility, and the AROUND_GUARD_TRACE geometry log.
// Run with AROUND_TEST_EXTENSION_PATH=.work/g13r0-trace, G13_POINTER=codex|near|far, G13_LABEL=<name>.
import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from '../../tests/fixtures';
import { openEditor } from '../../tests/helpers/editor';
import { declinePromotion, waitForAdvertToEnd, clearestPoint } from '../../tests/helpers/youtube-live';
import { defaultSignalRule } from '../../src/signals/keyframes';

test('G1.3 round 0: wheel scroll visibility and geometry trace', async () => {
  test.setTimeout(240000);
  const label = process.env.G13_LABEL ?? 'trace',
    pointerMode = process.env.G13_POINTER ?? 'codex';
  const out = path.resolve('.work/g13r0-evidence');
  await mkdir(out, { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g13r0-profile-')), false);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
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
      .setInputFiles({ name: 'g13-probe.png', mimeType: 'image/png', buffer: Buffer.from(png!, 'base64') });
    await expect(panel.locator('.layer')).toHaveCount(1);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    const saved: any = await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    );
    await studio.close();
    // Two layers as in Codex's run: one high on the right (atmosphere, over anything), one normal
    // screen-plane layer in the clearest spot of the lower left.
    const far = await clearestPoint(page, { left: 350, top: 840, right: 700, bottom: 980 }, 0);
    const decorations = [
      { x: 1200, y: 300, mode: 'atmosphere' },
      { x: far.x, y: far.y, mode: undefined },
    ].map((p, i) => ({
      ...saved.decorations[0],
      ...(p.mode ? { renderMode: p.mode } : {}),
      id: `probe-${i}`,
      name: `probe ${i}`,
      placement: {
        anchor: { kind: 'viewport' },
        x: p.x / 1440,
        y: p.y / 1000,
        widthPx: 160,
        heightPx: 120,
        rotationDeg: 0,
      },
    }));
    const signalRules = decorations.map((layer) => ({
      ...defaultSignalRule(layer.id, 'position.x', {
        signal: 'user.idle.duration',
        axis: 'y',
        space: 'page',
        inputRange: [0, 30],
      }),
      keyframes: [
        { id: 'start', input: 0, value: 0, easing: 'linear' },
        { id: 'end', input: 1, value: 300, easing: 'linear' },
      ],
    }));
    await popup.evaluate((design) => chrome.storage.local.set({ 'around.design.youtube': design }), {
      ...saved,
      decorations,
      signalRules,
    });
    await expect(page.locator('[data-image-id]')).toHaveCount(2);
    // codex: (700,650) as in the G1.2 verification. near: the column below the player where links pass
    // (signal-timeline-live's D9 point). far: the right margin, clear of controls by 72px.
    const point =
      pointerMode === 'near'
        ? await page.evaluate(() => {
            const below = document.querySelector('ytd-watch-flexy #below')!.getBoundingClientRect();
            return { x: below.left + 20, y: innerHeight / 2 };
          })
        : pointerMode === 'far'
          ? await clearestPoint(page, { left: 1400, top: 200, right: 1436, bottom: 900 }, 0)
          : { x: 700, y: 650 };
    await page.mouse.move(point.x, point.y, { steps: 3 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.documentElement.removeAttribute('data-around-guard-geometry'));
    await page.evaluate(() => {
      const rows: any[] = ((window as any).g13Frames = []);
      (window as any).g13Recording = true;
      const sample = (t: number) => {
        const layers = [...document.querySelectorAll<HTMLElement>('[id^="around-"][id$="decorations"]')].flatMap((h) =>
          [...(h.shadowRoot?.querySelectorAll<HTMLElement>('[data-image-id]') ?? [])].map((n) => {
            let visible = getComputedStyle(h).visibility !== 'hidden';
            for (let e: Element | null = n; e; e = e.parentElement)
              visible &&= getComputedStyle(e).visibility !== 'hidden';
            return [n.dataset.imageId, visible];
          }),
        );
        rows.push({
          t,
          scrollY,
          layers: Object.fromEntries(layers),
          safety: JSON.parse(document.querySelector('#around-decorations')?.getAttribute('data-around-safety') ?? '{}')
            .stopped,
        });
        if ((window as any).g13Recording) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      (window as any).g13Wheel = [];
      document.addEventListener(
        'wheel',
        (e) => (window as any).g13Wheel.push({ t: performance.now(), deltaY: e.deltaY }),
        {
          capture: true,
          passive: true,
        },
      );
    });
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, i < 12 ? 90 : -90);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(1200);
    // G1.3 round 2: the comments loading. Wheel down to the comments and rest there while they
    // load; the frames keep being recorded. The span is kept for the flicker count.
    const commentsFrom = await page.evaluate(() => performance.now());
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(40);
      if (await page.evaluate(() => document.querySelectorAll('ytd-comment-thread-renderer').length > 5)) break;
    }
    await page.waitForTimeout(3000);
    const commentsTo = await page.evaluate(() => performance.now());
    const result = await page.evaluate(() => {
      (window as any).g13Recording = false;
      return {
        frames: (window as any).g13Frames,
        wheel: (window as any).g13Wheel,
        geometry: JSON.parse(document.documentElement.getAttribute('data-around-guard-geometry') ?? '[]'),
        approach: JSON.parse(document.documentElement.getAttribute('data-around-guard-approach') ?? 'null'),
      };
    });
    await page.screenshot({ path: path.join(out, `${label}-settled.png`) });
    // Visual check (G13_SHOTS=1): the same wheel again, a screenshot between steps. Slower input,
    // so these frames are for the eye only, not for the counts above.
    if (process.env.G13_SHOTS === '1')
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, i < 6 ? 180 : -180);
        await page.waitForTimeout(40);
        if (i % 2 === 1) await page.screenshot({ path: path.join(out, `${label}-wheel-${i}.png`) });
      }
    await writeFile(
      path.join(out, `${label}.json`),
      JSON.stringify({ label, pointerMode, point, far, comments: [commentsFrom, commentsTo], ...result }, null, 2),
    );
  } finally {
    await context.close();
  }
});
