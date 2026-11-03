import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { launchExtension } from '../../tests/fixtures';
import { openEditor } from '../../tests/helpers/editor';
import { declinePromotion, waitForAdvertToEnd, clearestPoint } from '../../tests/helpers/youtube-live';
import { defaultSignalRule } from '../../src/signals/keyframes';

test('same-frame new snapshot, focus-only snapshot and new paints invalidate reuse', async () => {
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g12v-cache-')));
  try {
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/');
    const code = await build({
      stdin: {
        contents: `export {createOperationGuardHost} from './src/host/operation-guard';`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: 'iife',
      globalName: 'CacheProbe',
      write: false,
      loader: { '.css': 'text' },
    });
    await page.addScriptTag({ content: code.outputFiles[0].text });
    const result = await page.evaluate(() => {
      const rect = (x: number) => ({
        left: x,
        top: 300,
        width: 50,
        height: 50,
      });
      const make = (focused: string) =>
        Object.freeze({
          generation: Object.freeze({ documentId: 2, geometry: 1 }),
          viewport: Object.freeze({ width: 1100, height: 760 }),
          supported: true,
          surfaces: Object.freeze(
            ['a', 'b'].map((id, i) =>
              Object.freeze({
                id,
                owner: 'native',
                generation: Object.freeze({ documentId: 2, geometry: 1 }),
                kind: 'click',
                shape: Object.freeze(rect(300 + i * 300)),
                protectedEnvelope: Object.freeze(rect(300 + i * 300)),
                availability: Object.freeze({
                  present: true,
                  visible: true,
                  disabled: false,
                  focused: id === focused,
                  editing: false,
                  dragging: false,
                  captured: false,
                }),
                policy: Object.freeze({
                  transform: 'fixed-plane',
                  occlusion: 'forbid',
                  input: 'native-only',
                }),
                compositionCapability: 'exclusion',
                scrolls: false,
              }),
            ),
          ),
        });
      let current = make('');
      const source = {
        capture: () => current,
        deferredFor: () => 0,
        subscribe: () => () => {},
        active() {},
        validate: () => true,
        videoSlot() {},
        overlaySlot() {},
        editorCentre() {},
        pageSlot() {},
        destroy() {},
      };
      const host = (window as any).CacheProbe.createOperationGuardHost(document, source, () => {});
      const paint = (id: string, x: number) => ({
        id,
        root: id,
        dynamic: true,
        opacity: 1,
        pointerEvents: false,
        composition: 'overlay',
        outset: 0,
        bounds: { left: x, top: 300, right: x + 40, bottom: 340 },
      });
      const paints = [paint('root-a', 300), paint('root-b', 600)];
      host.commit(paints);
      const t = performance.now();
      const empty = host.sample(t);
      current = make('a');
      const first = host.sample(t + 1);
      current = make('b');
      const second = host.sample(t + 2);
      host.commit([...paints, paint('root-new', 600)]);
      const third = host.sample(t + 3);
      host.destroy();
      return {
        empty: Object.keys(empty.approach?.layers ?? {}),
        first: Object.keys(first.approach?.layers ?? {}),
        second: Object.keys(second.approach?.layers ?? {}),
        third: Object.keys(third.approach?.layers ?? {}),
      };
    });
    expect(result.empty).toEqual([]);
    expect(result.first).toEqual(['root-a']);
    expect(result.second.sort()).toEqual(['root-a', 'root-b']);
    expect(result.third.sort()).toEqual(['root-a', 'root-b', 'root-new']);
    await writeFile('.work/g12v-evidence/frame-cache.json', JSON.stringify(result, null, 2));
  } finally {
    await context.close();
  }
});

test('real YouTube visual: near root yields, far root moves; wheel visibility sampled as frames', async () => {
  test.skip(process.env.G12V_VISUAL !== '1');
  test.setTimeout(180000);
  const label = process.env.G12V_LABEL ?? 'current';
  const shots = path.resolve(`docs/screenshots/g12-verification/${label}`);
  await mkdir(shots, { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g12v-visual-')), false);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
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
      g.strokeStyle = '#000000';
      g.lineWidth = 12;
      g.strokeRect(0, 0, 160, 120);
      g.fillStyle = '#000000';
      g.font = 'bold 24px sans-serif';
      g.fillText('G1.2', 38, 68);
      return c.toDataURL().split(',')[1];
    });
    await panel.locator('.file').setInputFiles({
      name: 'g12-visible-probe.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    await expect(panel.locator('.layer')).toHaveCount(1);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    const saved: any = await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    );
    await studio.close();
    const control = page
      .getByRole('button', {
        name: /^like this video along with|^他 .* 人と一緒に/,
      })
      .first();
    await expect(control).toBeVisible();
    const r = (await control.boundingBox())!;
    const near = { x: r.x + r.width / 2, y: r.y + r.height / 2 + 35 };
    const far = await clearestPoint(page, { left: 350, top: 840, right: 700, bottom: 980 }, 0);
    const positions = [near, far];
    // An atmosphere plane keeps the probes visible over the video. Normal screen-plane art is
    // correctly cut out of the player's full vertical control path, which would hide this demo.
    const decorations = positions.map((p, i) => ({
      ...saved.decorations[0],
      renderMode: 'atmosphere',
      id: `visual-${i}`,
      name: i ? 'far-moving' : 'near-yielding',
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
    await popup.evaluate((design) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': design }), {
      ...saved,
      decorations,
      signalRules,
    });
    await expect(page.locator('[data-image-id]')).toHaveCount(2);
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 3 });
    const state = () =>
      page
        .locator('#web-world-themes-decorations')
        .evaluate((n: HTMLElement) => JSON.parse(n.dataset.wwSafety ?? '{}'));
    await expect.poll(async () => (await state()).stopped, { timeout: 15000 }).toBe('');
    const timeline: any[] = [];
    await page.evaluate(() => {
      (window as any).g12VisualSamples = [];
    });
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(180);
      const sample = await page.evaluate(() =>
        [...document.querySelectorAll('[id^="web-world-themes-"][id$="decorations"]')].flatMap((h) =>
          [...(h.shadowRoot?.querySelectorAll<HTMLElement>('[data-image-id]') ?? [])].map((n) => ({
            id: n.dataset.imageId,
            x: n.getBoundingClientRect().x,
            y: n.getBoundingClientRect().y,
            visibility: getComputedStyle(n).visibility,
            transform: n.style.transform,
            safety: h.getAttribute('data-ww-safety'),
          })),
        ),
      );
      timeline.push(sample);
      await page.screenshot({ path: `${shots}/near-${i}.png` });
    }
    const held = [
      ...new Set(
        (await state()).issues.filter((i: any) => i.surfaceId === 'native.approach').map((i: any) => i.layerId),
      ),
    ];
    const pixels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[id^="web-world-themes-"][id$="decorations"]')].map((h) => ({
        host: h.id,
        style: h.style.cssText,
        opacity: getComputedStyle(h).opacity,
        visibility: getComputedStyle(h).visibility,
        html: h.shadowRoot?.innerHTML.slice(-5000),
        images: [...(h.shadowRoot?.querySelectorAll('img') ?? [])].map((n: HTMLImageElement) => ({
          complete: n.complete,
          width: n.naturalWidth,
          src: n.currentSrc.slice(0, 100),
          visibility: getComputedStyle(n).visibility,
        })),
      })),
    );
    // Sample every presented browser frame while real wheel input scrolls down and back.
    await page.mouse.move(700, 650);
    await page.evaluate(() => {
      const rows: any[] = ((window as any).g12WheelFrames = []);
      (window as any).g12WheelRecording = true;
      const sample = (t: number) => {
        const host = [...document.querySelectorAll<HTMLElement>('[id^="web-world-themes-"][id$="decorations"]')].find(
          (h) => h.shadowRoot?.querySelector('[data-image-id="visual-1"]'),
        );
        const n = host?.shadowRoot?.querySelector<HTMLElement>('[data-image-id="visual-1"]');
        if (n) {
          let visible = true;
          for (let e: Element | null = n; e; e = e.parentElement)
            visible &&= getComputedStyle(e).visibility !== 'hidden';
          visible &&= getComputedStyle(host!).visibility !== 'hidden';
          rows.push({
            t,
            scrollY,
            visible,
            safety: document.querySelector('#web-world-themes-decorations')?.getAttribute('data-ww-safety'),
            x: n.getBoundingClientRect().x,
            y: n.getBoundingClientRect().y,
          });
        }
        if ((window as any).g12WheelRecording) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const cdp = await context.newCDPSession(page);
    const captures: any[] = [];
    const writes: Promise<void>[] = [];
    let lastCapture = -Infinity;
    cdp.on('Page.screencastFrame', (event) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      const t = event.metadata.timestamp ?? 0;
      if (t - lastCapture < 0.07) return;
      lastCapture = t;
      const name = `continuous-${String(captures.length).padStart(3, '0')}.jpg`;
      captures.push({ name, timestamp: t });
      writes.push(writeFile(path.join(shots, name), Buffer.from(event.data, 'base64')));
    });
    await page.evaluate(() => {
      (window as any).g12WheelEvents = [];
      document.addEventListener(
        'wheel',
        (e) => {
          (window as any).g12WheelEvents.push({
            t: performance.now(),
            deltaY: e.deltaY,
          });
        },
        { capture: true, passive: true },
      );
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: 1440,
      maxHeight: 1000,
      everyNthFrame: 2,
    });
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, i < 12 ? 90 : -90);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${shots}/wheel-settled.png` });
    await cdp.send('Page.stopScreencast');
    await Promise.all(writes);
    await cdp.detach();
    const wheel = await page.evaluate(() => {
      (window as any).g12WheelRecording = false;
      return (window as any).g12WheelFrames;
    });
    const wheelEvents = await page.evaluate(() => (window as any).g12WheelEvents);
    await writeFile(
      `.work/g12v-evidence/visual-${label}.json`,
      JSON.stringify(
        {
          label,
          control: r,
          near,
          far,
          held,
          pixels,
          timeline,
          wheel,
          wheelEvents,
          captures,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
