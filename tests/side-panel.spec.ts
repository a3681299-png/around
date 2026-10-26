import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchExtension } from './fixtures';
import { sidePanelDriver, nativeWindow } from './helpers/side-panel';
import { createTakeSampler, type SignalTake } from '../src/world/takes';
import type { DesignDocument } from '../src/design/types';
import { unpackCheckpoint } from '../src/studio/checkpoint-codec';
import { beginCanvasGesture } from './helpers/editor-workspace';

async function setup() {
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-panel-test-')), true, { headed: true });
  const manager = await context.newPage();
  await manager.goto('chrome://extensions/');
  const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
  await item.waitFor();
  const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
  await manager.close();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await page.bringToFront();
  await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
  return { context, page, popup, id, local: page.locator('#web-world-themes-creator') };
}

test('native Chrome panel uses the same draft, group masks, selection, history, anchors and saved artwork', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await mkdir('.work/verification', { recursive: true });
    await local
      .getByLabel('画像素材を追加')
      .setInputFiles(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
    await expect(local.locator('.layer')).toHaveCount(3);
    await local.locator('.select-all').click();
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.selected-count')).toBe('3個選択中');
    await expect(local).toHaveAttribute('data-page-toolbar', '');
    await expect(local).not.toBeVisible();
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
    await expect.poll(() => panel.evaluate('innerWidth')).toBeGreaterThan(250);
    await expect
      .poll(async () => {
        const values = await popup.evaluate(async () =>
          Object.entries(await chrome.storage.session.get(null))
            .filter(([key]) => key.startsWith('webWorldThemes.studio.session.'))
            .map(([, value]) => value as unknown),
        );
        return values.some((value) => unpackCheckpoint(value)?.draft.decorations.length === 3);
      })
      .toBe(true);
    // Isolated fixture only: reproduce a delayed empty recovery write. The live
    // page's lease must continue protecting bytes, even without a recovery pin.
    const recoveryTarget = await panel.evaluate<number>('Number(new URL(location.href).searchParams.get("target"))');
    const recoveryValue: unknown = await popup.evaluate(
      async (target) =>
        (await chrome.storage.session.get('webWorldThemes.studio.session.' + target))[
          'webWorldThemes.studio.session.' + target
        ],
      recoveryTarget,
    );
    const assetId = unpackCheckpoint(recoveryValue)!.draft.decorations[0]!.assetId;
    const retained = await panel.evaluate<boolean>(`(async()=>{
      const target=Number(new URL(location.href).searchParams.get('target'));
      const id=${JSON.stringify(assetId)};
      await chrome.runtime.sendMessage({type:'web-world-themes:assets',action:'lease',session:'session-studio-'+target+'-'+target,ownerTabId:target,ids:[]});
      return (await chrome.runtime.sendMessage({type:'web-world-themes:assets',action:'get',id})).ok;
    })()`);
    expect(retained).toBe(true);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1200);
    const width = await page.evaluate(() => innerWidth);
    for (const rowId of await panel.evaluate<string[]>(
      'Array.from(document.querySelector("#web-world-themes-creator").shadowRoot.querySelectorAll(".layer"),n=>n.dataset.layerId)',
    )) {
      await panel.click(`[data-layer-id="${rowId}"] [data-action="select"]`);
      await panel.fill('[data-image-prop="x"]', '70');
    }
    await panel.click('.select-all');
    await panel.click('.group-layers');
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelectorAll(".layer[data-kind=group]").length',
        ),
      )
      .toBe(1);
    await panel.click('[data-effect="enabled"]');
    await expect(page.locator('#web-world-themes-decorations .group-content')).toHaveCSS(
      'mask-image',
      /radial-gradient/,
    );
    await panel.screenshot('.work/verification/sidepanel-fixture.png');
    const groupX = await panel.evaluate(
      'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector("[data-image-prop=x]").value',
    );
    const first = page.locator('#web-world-themes-decorations [data-image-id]').first();
    const before = (await first.boundingBox())!;
    await beginCanvasGesture(first);
    await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 10, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x + 30, 0);
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector("[data-image-prop=x]").value',
        ),
      )
      .not.toBe(groupX);
    await panel.click('.undo');
    await expect
      .poll(async () => ({
        x: Math.round((await first.boundingBox())!.x),
        status: await panel.text('.status'),
        error: await panel.evaluate('document.querySelector(".connection-status").textContent'),
      }))
      .toMatchObject({ x: Math.round(before.x) });
    await panel.click('.redo');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await nativeWindow(panel.cdp, 1920);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(width);
    const stored = await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    );
    expect((stored as { schemaVersion: number }).schemaVersion).toBe(13);
    await page.reload();
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(page.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(3);
    await panel.click('.studio-menu-item > summary');
    await panel.clickAndLeave('[data-source="close"]');
    await expect(page.locator('[data-ww-editing]')).toHaveCount(0);
    await expect(local).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1750);
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('side panel and standalone hand off unsaved Undo and asset leases, while targets stay isolated', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.evaluate(`(() => {
      globalThis.__studioNativeTransfers = [];
      const post = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function(message, ...args) {
        const result = Reflect.apply(post, this, [message, ...args]);
        if (message?.type === 'web-world-themes:studio-assets-v1')
          __studioNativeTransfers.push(message.files.every(file => file.buffer.byteLength === 0));
        return result;
      };
    })()`);
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    expect(await panel.evaluate('__studioNativeTransfers')).toEqual([true]);
    await panel.fill('[data-image-prop="rotationDeg"]', '20');
    await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更');
    await expect.poll(() => panel.evaluate('document.querySelector(".recovery-status").textContent')).toBe('');
    await expect
      .poll(async () => ({
        retained: await popup.evaluate(async () =>
          Object.keys(await chrome.storage.session.get(null)).some((key) =>
            key.startsWith('webWorldThemes.studio.session.'),
          ),
        ),
        status: await panel.evaluate('document.querySelector(".recovery-status").textContent'),
        contexts: await panel.evaluate(
          'chrome.runtime.getContexts({}).then(xs=>xs.map(x=>({type:x.contextType,doc:x.documentId,tab:x.tabId})))',
        ),
      }))
      .toMatchObject({ retained: true, status: '' });
    await page.reload();
    await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更');
    await expect(page.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(1);
    const opened = context.waitForEvent('page');
    await panel.clickAndLeave('[aria-label="独立Studioへ切替"]');
    const standalone = await opened;
    await standalone.setViewportSize({ width: 1440, height: 900 });
    await expect(standalone.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    const shared = standalone.locator('#web-world-themes-creator');
    await expect(shared.locator('.dirty')).toHaveText('未保存の変更');
    await shared.locator('.undo').click();
    await expect(shared.locator('[data-image-prop="rotationDeg"]')).toHaveValue('0');
    await shared.locator('.redo').click();
    await expect(shared.locator('[data-image-prop="rotationDeg"]')).toHaveValue('20');
    await page.bringToFront();
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const next = await sidePanelDriver(context, page, id);
    await expect.poll(() => next.text('.dirty')).toBe('未保存の変更');
    await expect(standalone.locator('.connection-status')).toContainText('引き継ぎ');
    await expect(standalone.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
    await next.clickAndLeave('[aria-label="従来のインページStudioへ切替"]');
    await expect(local).toHaveAttribute('data-inpage', '');
    await expect(local.locator('.dirty')).toHaveText('未保存の変更');
    await local.locator('.undo').click();
    await expect(local.locator('[data-image-prop="rotationDeg"]')).toHaveValue('0');
    await local.locator('.discard').click();
    await expect(page.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(0);
    await popup.locator('#effect-strength').fill('0');
    await expect(local).toHaveCount(0);
    await expect(page.locator('#web-world-themes-decorations')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('tab-specific panels isolate drafts and recovery; floating tools yield to native video controls', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const first = await sidePanelDriver(context, page, id);
    await expect.poll(() => first.text('.dirty')).toBe('保存済み');
    await first.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => first.text('.selected-count')).toBe('1個選択中');
    await first.fill('.layer-name', '最初のタブ');
    const secondPage = await context.newPage();
    await secondPage.goto('https://www.youtube.com/watch?v=second');
    await secondPage.bringToFront();
    const target = await popup.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
    );
    // The native panel may already be visible on a newly enabled YouTube tab.
    // Open that tab directly, rather than racing an unrelated legacy close/open.
    await popup.evaluate(async (tabId) => {
      const result = await chrome.runtime.sendMessage({ type: 'web-world-themes:open-side-panel', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'Native panel did not open.');
    }, target);
    const secondLocal = secondPage.locator('#web-world-themes-creator');
    const second = await sidePanelDriver(context, secondPage, id, target);
    await expect.poll(() => second.text('.dirty')).toBe('保存済み');
    await second.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => second.text('.selected-count')).toBe('1個選択中');
    await second.fill('.layer-name', '次のタブ');
    await expect
      .poll(() =>
        popup.evaluate(
          async () =>
            Object.keys(await chrome.storage.session.get(null)).filter((key) =>
              key.startsWith('webWorldThemes.studio.session.'),
            ).length,
        ),
      )
      .toBe(2);
    await expect.poll(() => second.evaluate('document.querySelector(".recovery-status").textContent')).toBe('');
    await page.reload();
    await expect.poll(() => first.text('.dirty')).toBe('未保存の変更');
    await expect.poll(() => first.text('.layer-title')).toBe('最初のタブ');
    await expect.poll(() => second.text('.layer-title')).toBe('次のタブ');
    await secondPage.bringToFront();
    // Closing only Chrome's panel must reveal the page tools and retain the draft.
    await popup.evaluate(async (tabId) => {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }, target);
    await expect(secondLocal).toBeVisible();
    await expect(secondLocal.locator('.dirty')).toHaveText('未保存の変更');
    await secondPage.locator('#movie_player .ytp-chrome-bottom').evaluate((node: HTMLElement) => {
      node.style.cssText = 'position:fixed;bottom:32px;left:12px;width:500px;height:32px;';
    });
    await expect(secondLocal).toHaveAttribute('data-native-overlap', '');
    await expect(secondLocal).not.toBeVisible();
    await secondPage
      .locator('#movie_player .ytp-chrome-bottom')
      .evaluate((node: HTMLElement) => node.removeAttribute('style'));
    await expect(secondLocal).not.toHaveAttribute('data-native-overlap', '');
    await expect(secondLocal).toBeVisible();
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    for (const targetPage of [page, secondPage]) {
      await expect(targetPage.locator('[data-ww-editing]')).toHaveCount(0);
      await expect(targetPage.locator('#web-world-themes-decorations')).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

test('the real action popup launches its active YouTube tab in the official panel', async () => {
  test.setTimeout(60_000);
  const { context, page, popup, id, local } = await setup();
  try {
    test.skip(
      Number.parseInt(context.browser()?.version() ?? '0') < 127,
      'Only native popup automation uses the Chrome 127+ test API.',
    );
    await local.getByRole('button', { name: '編集を終了', exact: true }).click();
    await page.bringToFront();
    await popup.evaluate(() => chrome.action.openPopup());
    const action = await sidePanelDriver(context, page, id, undefined, 'popup/index.html');
    await expect
      .poll(() => action.evaluate('document.querySelector("#creator-studio-sidepanel")?.disabled'))
      .toBe(false);
    const contexts = await action.evaluate<string[]>(
      'chrome.runtime.getContexts({}).then(xs=>xs.filter(x=>x.documentUrl===location.href).map(x=>x.contextType))',
    );
    expect(contexts).toContain('POPUP');
    await action.evaluate('document.querySelector("#creator-studio-sidepanel").click()');
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(local).toHaveAttribute('data-page-toolbar', '');
    await expect(local).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1200);
  } finally {
    await context.close();
  }
});

test('panel tools replace floating tools; responsive inspectors and empty controls stay compact without losing edits', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await mkdir('.work/verification', { recursive: true });
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(local).not.toBeVisible();
    const ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
    const measure = () =>
      panel.evaluate<{
        wide: boolean;
        orientation: string;
        properties: { x: number; y: number; right: number; bottom: number };
        layers: { x: number; y: number; right: number; bottom: number };
        numbers: number[];
        appearance: string;
        track: number;
        empty: boolean;
        close: number;
        separators: number;
        icons: { name: string; title: string; paths: string }[];
      }>(`(()=>{
      const root=${ui}, host=root.host;
      const rect=s=>{const r=root.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};
      const slider=root.querySelector('[data-image-prop=opacity]');
      return {wide:host.hasAttribute('data-inspectors-wide'),orientation:root.querySelector('.inspector-divider').getAttribute('aria-orientation'),properties:rect('.inspector-pane'),layers:rect('.layers-pane'),numbers:Array.from(root.querySelectorAll('.transform-section input[type=number]')).filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().width),appearance:getComputedStyle(slider).appearance,track:Number(getComputedStyle(slider).opacity),empty:root.querySelector('.image-properties').hasAttribute('data-empty'),close:root.querySelector('.menu-end .close')?.getClientRects().length??0,separators:root.querySelectorAll('.toolbar > .toolbar-separator').length,icons:Array.from(root.querySelectorAll('.menu-end .surface-actions button')).map(n=>({name:n.getAttribute('aria-label'),title:n.title,paths:n.querySelector('svg').innerHTML}))};
    })()`);
    // Emulate the panel WebContents width, not the native Chrome divider. This
    // tests responsive UI independently of the website's real viewport/layout.
    for (const width of [360, 940]) {
      await panel.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await expect.poll(() => panel.evaluate('innerWidth')).toBe(width);
      await expect.poll(async () => (await measure()).wide).toBe(width >= 720);
      const info = await measure();
      await panel.screenshot(`.work/verification/sidepanel-ux-empty-${width}.png`);
      expect(
        info.numbers.every((number) => number > 40 && number <= 104),
        JSON.stringify({ width, info }),
      ).toBe(true);
      expect(info.close).toBe(0);
      expect(info.separators).toBe(2);
      expect(info.empty).toBe(true);
      expect(info.appearance).toBe('none');
      expect(info.track).toBeLessThan(0.4);
      expect(info.icons.map((icon) => icon.title)).toEqual(info.icons.map((icon) => icon.name));
      expect(info.icons[0]!.paths).not.toBe(info.icons[1]!.paths);
      expect(info.orientation).toBe(width >= 720 ? 'vertical' : 'horizontal');
      if (width >= 720) {
        expect(info.layers.x).toBeGreaterThanOrEqual(info.properties.right);
        expect(info.layers.y).toBe(info.properties.y);
      } else expect(info.layers.y).toBeGreaterThanOrEqual(info.properties.bottom);
    }
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.fill('[data-image-prop="opacity"]', '70');
    await expect.poll(() => panel.text('.opacity-value')).toBe('70%');
    expect((await measure()).empty).toBe(false);
    expect((await measure()).appearance).not.toBe('none');
    await panel.click('.layer [data-action="lock"]');
    expect((await measure()).appearance).not.toBe('none');
    await panel.click('.layer [data-action="lock"]');
    await panel.click('.undo');
    await panel.click('.undo');
    await panel.evaluate(
      `${ui}.querySelector('.inspector-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
    );
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.inspector-divider').getAttribute('aria-valuenow')`))
      .toBe('55');
    await expect
      .poll(() =>
        popup.evaluate(
          async () =>
            (
              (await chrome.storage.local.get('webWorldThemes.studio.sidepanel.v1'))[
                'webWorldThemes.studio.sidepanel.v1'
              ] as { wideRatio?: number } | undefined
            )?.wideRatio,
        ),
      )
      .toBe(0.55);
    await panel.screenshot('.work/verification/sidepanel-ux-selected-wide.png');
    await panel.send('Emulation.clearDeviceMetricsOverride');
    const target = await panel.evaluate<number>('Number(new URL(location.href).searchParams.get("target"))');
    await expect
      .poll(async () => {
        const value: unknown = await popup.evaluate(
          async (tabId) =>
            (await chrome.storage.session.get('webWorldThemes.studio.session.' + tabId))[
              'webWorldThemes.studio.session.' + tabId
            ],
          target,
        );
        return unpackCheckpoint(value)?.draft.decorations[0]?.opacity;
      })
      .toBe(0.7);
    await popup.evaluate(async (tabId) => {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.sidePanel.setOptions({ tabId, enabled: true });
    }, target);
    await expect(local).toBeVisible();
    await expect(local.locator('.dirty')).toHaveText('未保存の変更');
    await expect(page.locator('[data-ww-editing]')).toHaveCount(1);
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const reopened = await sidePanelDriver(context, page, id);
    await expect(local).not.toBeVisible();
    await expect.poll(() => reopened.text('.opacity-value')).toBe('70%');
    await reopened.click('.undo');
    await expect.poll(() => reopened.text('.opacity-value')).toBe('100%');
    await reopened.click('.redo');
    await expect.poll(() => reopened.text('.opacity-value')).toBe('70%');
    await reopened.click('.save');
    await expect.poll(() => reopened.text('.dirty')).toBe('保存済み');
    await page.reload();
    await expect
      .poll(() => reopened.evaluate('document.querySelector(".connection-status").dataset.connected'))
      .toBe('true');
    await expect.poll(() => reopened.text('.opacity-value')).toBe('70%');
    await expect(local).not.toBeVisible();
    await expect.poll(() => reopened.text('.selected-count')).toBe('1個選択中');
    await expect.poll(() => reopened.evaluate(`${ui}.querySelector('.clear-selection').disabled`)).toBe(false);
    await reopened.click('.clear-selection');
    await expect
      .poll(async () => await reopened.evaluate(`${ui}.querySelector('.image-properties').hasAttribute('data-empty')`))
      .toBe(true);
    await expect.poll(() => reopened.text('.opacity-value')).toBe('—');
  } finally {
    await context.close();
  }
});

test('the official panel edits scroll keyframes through the shared Core and retains saved rules', async () => {
  const { context, page, popup, id, local } = await setup();
  try {
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.click('.timeline-toggle');
    await panel.click('.timeline-connect');
    await panel.click('[data-key-id="key-middle"]');
    await panel.fill('.timeline-key-value', '70');
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".timeline-key-value").value',
        ),
      )
      .toBe('70');
    await panel.click('.undo');
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".timeline-key-value").value',
        ),
      )
      .toBe('100');
    await panel.click('.redo');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(local).not.toBeVisible();
    await panel.screenshot('.work/verification/signal-stage2-sidepanel.png');
    const saved = await popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'] as {
          signalRules: { keyframes: { value: number }[] }[];
        },
    );
    expect(saved.signalRules[0]!.keyframes[1]!.value).toBe(0.7);
    await page.reload();
    await expect.poll(() => panel.text('.opacity-value')).toBe('スクロールに接続');
  } finally {
    await context.close();
  }
});

test('timeline keeps layer controls reachable in narrow and wide native panels', async ({}, info) => {
  const { context, page, popup, id, local } = await setup();
  try {
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.click('.timeline-toggle');
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".timeline-connect").disabled',
        ),
      )
      .toBe(false);
    await panel.click('.timeline-connect');
    for (const { width, wide } of [
      { width: 360, wide: false },
      { width: 940, wide: true },
    ]) {
      await panel.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // CDP acknowledges the viewport before Chrome dispatches window.resize.
      // Wait for the responsive layout before measuring the real pointer target.
      await expect
        .poll(() =>
          panel.evaluate('document.querySelector("#web-world-themes-creator").hasAttribute("data-inspectors-wide")'),
        )
        .toBe(wide);
      const ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
      const rowHeight = await panel.evaluate<number>(
        `Math.ceil(${ui}.querySelector('.layer').getBoundingClientRect().height)`,
      );
      await expect
        .poll(() => panel.evaluate(`${ui}.querySelector('.layers').clientHeight`))
        .toBeGreaterThanOrEqual(rowHeight);
      const lock = `${ui}.querySelector('.layer [data-action="lock"]')`;
      await panel.evaluate(`${lock}.scrollIntoView({block:'nearest'})`);
      // Use real pointer input, rather than DOM click(), to verify hit testing.
      const measure = () =>
        panel.evaluate<{ x: number; y: number; reachable: boolean }>(
          `(()=>{const node=${lock},rect=node.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;return {x,y,reachable:!node.disabled&&node.contains(${ui}.elementFromPoint(x,y))}})()`,
        );
      await expect.poll(async () => (await measure()).reachable).toBe(true);
      const point = await measure();
      await panel.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await panel.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await expect.poll(() => panel.evaluate(`${ui}.querySelector('.timeline-key').disabled`)).toBe(true);
      await panel.screenshot(info.outputPath(`timeline-sidepanel-${width}.png`));
      await panel.click('.layer [data-action="lock"]');
    }
    await expect(local).not.toBeVisible();
    await expect(popup.getByRole('switch', { name: 'Theme ON / OFF' })).toBeChecked();
  } finally {
    await context.close();
  }
});

test('official panel records raw signals, plays/seeks without live input, and restores independent saved takes', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await page.evaluate(() => {
      document.body.style.minHeight = '6000px';
    });
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.click('.timeline-toggle');
    await panel.click('.timeline-connect');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.click('.take-record');
    const ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".signal-timeline").hasAttribute("data-recording")',
        ),
      )
      .toBe(true);
    for (const progress of [0, 0.5, 1, 0.5, 0]) {
      await page.evaluate((value) => {
        const root = document.scrollingElement!;
        scrollTo(0, Math.round((root.scrollHeight - root.clientHeight) * value));
      }, progress);
      await page.waitForTimeout(90);
    }
    await page.locator('ytd-masthead input').first().fill('PRIVATE_TIMELINE_FORM_SECRET');
    await panel.click('.take-stop');
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.click('.take-store');
    await expect.poll(() => panel.text('.take-saved')).toBe('テイク保存済み');
    const library = await panel.evaluate<{ id: string }[]>(
      'chrome.runtime.sendMessage({type:"web-world-themes:signal-takes",action:"list",siteId:"youtube"}).then(r=>r.value)',
    );
    expect(library).toHaveLength(1);
    const take = await panel.evaluate<SignalTake>(
      `chrome.runtime.sendMessage({type:"web-world-themes:signal-takes",action:"get",siteId:"youtube",id:${JSON.stringify(library[0]!.id)}}).then(r=>r.value)`,
    );
    expect(take.inputs.length).toBeGreaterThan(5);
    expect(take.inputs.every((input) => input.signals.scroll && input.viewport.width > 0)).toBe(true);
    expect(JSON.stringify(take)).not.toMatch(
      /PRIVATE_TIMELINE_FORM_SECRET|asset-|decorations|signalRules|https?:|cookie|authorization/,
    );
    const design = await popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
    expect(design).not.toHaveProperty('takes');
    // End the real native text edit before checking an unrestricted playback
    // preview. G1 intentionally keeps the authored base while it is focused.
    await page.locator('ytd-masthead input').first().fill('');
    await page
      .locator('ytd-masthead input')
      .first()
      .evaluate((input: HTMLInputElement) => input.blur());
    await page.mouse.move((await page.evaluate(() => innerWidth)) - 90, 450);
    await expect
      .poll(() =>
        page
          .locator('#web-world-themes-decorations')
          .evaluate((host: HTMLElement) =>
            JSON.parse(host.dataset.wwSafety!).issues.some(
              (i: { surfaceId: string }) => i.surfaceId === 'native.approach',
            ),
          ),
      )
      .toBe(false);
    await expect.poll(() => panel.evaluate(`${ui}.querySelectorAll('.take-ghost').length`)).toBeGreaterThan(3);
    expect(await panel.evaluate(`${ui}.querySelectorAll('.take-projection').length`)).toBe(1);
    await panel.evaluate(
      `${ui}.querySelector('.take-ghost[data-ghost-key="key-middle"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    );
    expect(await panel.evaluate(`${ui}.querySelector('.timeline-view').value`)).toBe('signal');
    expect(await panel.evaluate(`${ui}.querySelector('.timeline-key[data-selected]').dataset.keyId`)).toBe(
      'key-middle',
    );
    expect(await panel.text('.dirty')).toBe('保存済み');
    await panel.fill('.timeline-view', 'take');
    const sample = take.inputs.find(
      (input) =>
        input.signals.scroll &&
        input.signals.scroll.y / input.signals.scroll.maxY > 0.4 &&
        input.signals.scroll.y / input.signals.scroll.maxY < 0.6,
    )!;
    expect(sample).toBeDefined();
    const position = sample.timeMs - take.inputs[0]!.timeMs,
      expected = createTakeSampler(design, take).at(position).frame.layout.layers[0]!.layer.opacity;
    await panel.fill('.take-position', String(position / 1000));
    const media = page.locator('#web-world-themes-decorations .media');
    await expect.poll(() => media.evaluate((node: HTMLElement) => Number(node.style.opacity))).toBeCloseTo(expected, 5);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(80);
    await expect.poll(() => media.evaluate((node: HTMLElement) => Number(node.style.opacity))).toBeCloseTo(expected, 5);
    await panel.fill('.take-rate', '-1');
    await panel.click('.take-play');
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.take-position').valueAsNumber`))
      .toBeLessThan(position / 1000);
    await panel.click('.take-play');
    await panel.click('.take-live');
    await expect.poll(() => panel.text('.take-source')).toBe('LIVE');
    await expect(media).toHaveCSS('opacity', '0');
    await panel.screenshot('.work/verification/signal-stage3-take.png');
    await page.reload();
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status").dataset.connected'))
      .toBe('true');
    await expect.poll(() => panel.evaluate(`${ui}.querySelector('.take-library-select').options.length`)).toBe(2);
    await panel.fill('.take-library-select', take.id);
    await expect.poll(() => panel.text('.take-saved')).toBe('テイク保存済み');
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.click('.take-live');
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    await expect(page.locator('#web-world-themes-decorations')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
