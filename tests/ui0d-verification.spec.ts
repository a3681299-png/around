import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { openEditor } from './helpers/editor';
import { createStudioStateDecoder } from '../src/studio/state-sync';
import type { StudioMessage } from '../src/studio/protocol';
import { launchExtension } from './fixtures';
import { sidePanelDriver } from './helpers/side-panel';

test('UI0-d in-video entry falls back to W when Chrome refuses S', async ({ popup, youtube }) => {
  const extensionContext = popup.context();
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: '作品を表示する', exact: true }).check();
  await popup.getByRole('switch', { name: '制作モード', exact: true }).check();
  const worker = extensionContext.serviceWorkers()[0] ?? (await extensionContext.waitForEvent('serviceworker'));
  await worker.evaluate(() => {
    chrome.sidePanel.open = async () => {
      throw new Error('UI0-d test: side panel unavailable');
    };
  });
  await youtube.bringToFront();
  const opened = extensionContext.waitForEvent('page');
  await youtube.getByRole('button', { name: 'Around の設定', exact: true }).click();
  const window = await opened;
  await expect(window).toHaveURL(/\/studio\/index\.html\?target=\d+/);
  await expect(window.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await expect(window.getByRole('dialog', { name: 'デザインエディター' })).toBeVisible();
  await expect(youtube.getByRole('dialog', { name: 'Around の設定' })).toBeHidden();
});

test('UI0-d rejects forged skin channels, slots, bytes and another target session without document or history changes', async ({
  context,
  popup,
  youtube,
  extensionId,
}, info) => {
  await showArtwork(popup);
  const { studio, panel } = await openEditor(popup, youtube);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator('[data-image-id]')).toHaveCount(1);
  const first = Number(new URL(studio.url()).searchParams.get('target'));
  await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
  const other = await context.newPage();
  await other.goto('https://www.youtube.com/watch?v=other');
  await other.bringToFront();
  const second = await popup.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
  );
  const decoders = [createStudioStateDecoder(), createStudioStateDecoder()];
  await studio.exposeFunction('ui0dDecode', (key: number, message: StudioMessage) =>
    message.type === 'state' || message.type === 'reply' ? decoders[key]!.accept(message)?.state : undefined,
  );
  const result = await studio.evaluate(
    async ({ first, second }) => {
      async function client(tab: number, owner: string, key: number) {
        const port = chrome.tabs.connect(tab, { name: 'around:studio-v1' });
        let serial = 0,
          state: any,
          queue = Promise.resolve();
        const pending = new Map<number, (value: any) => void>();
        port.onMessage.addListener((message: any) => {
          queue = queue.then(async () => {
            const next = await (globalThis as any).ui0dDecode(key, message);
            if (next) state = next;
            if (message.type === 'reply') {
              pending.get(message.id)?.({ ...message, state });
              pending.delete(message.id);
            }
          });
        });
        const send = (body: Record<string, unknown>) =>
          new Promise<any>((resolve) => {
            const id = ++serial;
            pending.set(id, resolve);
            port.postMessage({ id, ...body });
          });
        const attached = await send({ type: 'attach', owner });
        if (!attached.ok) throw Error(attached.error);
        return { send, port, get: () => state };
      }
      const a = await client(first, 'studio-ui0d-a', 0),
        b = await client(second, 'studio-ui0d-b', 1);
      for (const command of [
        { type: 'tool', tool: 'skin' },
        { type: 'select-target', target: 'video-card' },
      ]) {
        const state = a.get();
        const reply = await a.send({ type: 'command', session: state.sessionId, revision: state.revision, command });
        if (!reply.ok) throw Error(reply.error);
      }
      const state = a.get(),
        before = JSON.stringify(state.document),
        otherBefore = JSON.stringify(b.get().document);
      const asset = state.document.decorations[0].assetId;
      const base = {
        type: 'import-skin',
        session: state.sessionId,
        revision: state.revision,
        assets: [asset],
        slot: 'normal',
      };
      const attacks = [
        { ...base, slot: 'background' },
        { ...base, slot: 'normal;}body{display:none' },
        { ...base, assets: ['javascript:alert(1)'] },
        { ...base, assets: [{ data: 'image bytes' }] },
        { ...base, assets: undefined, files: [{ name: 'skin.png', mime: 'image/png', base64: 'AAAA' }] },
        { type: 'skin-page', session: state.sessionId, info: [{ selector: 'body', count: 999 }] },
        { type: 'skin-page', session: b.get().sessionId, info: [] },
        { ...base, session: b.get().sessionId },
        { ...base, assets: ['asset-' + '0'.repeat(64)] },
      ];
      const rows = [];
      for (const attack of attacks) {
        const reply = await a.send(attack);
        rows.push({
          ok: reply.ok,
          error: reply.error,
          unchanged: JSON.stringify(a.get().document) === before,
          revision: a.get().revision,
        });
      }
      const out = { rows, revision: state.revision, otherUnchanged: JSON.stringify(b.get().document) === otherBefore };
      a.port.disconnect();
      b.port.disconnect();
      return out;
    },
    { first, second },
  );
  expect(result.rows).toHaveLength(9);
  for (const row of result.rows) expect(row).toMatchObject({ ok: false, unchanged: true, revision: result.revision });
  expect(result.otherUnchanged).toBe(true);
  await info.attach('rejected-skin-requests', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('UI0-d native panel Undo and Redo each act once across both focus locations; quota failure, reconnect and reopen retain the draft', async ({}, info) => {
  test.setTimeout(120_000);
  const context = await launchExtension(await mkdtemp(path.resolve('.work/ui0dv-history-')), true, {
    headed: true,
    width: 1920,
    height: 1080,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host,
      popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await showArtwork(popup);
    await page.bringToFront();
    const tab = await popup.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
    );
    const open = () =>
      popup.evaluate(async (tabId) => {
        const reply = await chrome.runtime.sendMessage({ type: 'around:open-side-panel', tabId });
        if (!reply?.ok) throw Error(reply?.error);
      }, tab);
    await open();
    let panel = await sidePanelDriver(context, page, id, tab);
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status")?.dataset.connected'))
      .toBe('true');
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect(page.locator('[data-image-id]')).toHaveCount(1);
    const ui = 'document.querySelector("#around-creator").shadowRoot';
    const opacity = () => panel.text('.opacity-value');
    async function key(where: 'page' | 'panel', redo: boolean) {
      if (where === 'page') {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
      } else {
        await panel.evaluate(`document.activeElement?.blur();${ui}.activeElement?.blur()`);
        for (const type of ['keyDown', 'keyUp'])
          await panel.send('Input.dispatchKeyEvent', {
            type,
            key: 'z',
            code: 'KeyZ',
            windowsVirtualKeyCode: 90,
            modifiers: redo ? 10 : 2,
          });
      }
    }
    for (const focus of ['page', 'panel'] as const) {
      await panel.fill('[data-image-prop="opacity"]', '70');
      await expect.poll(opacity).toBe('70%');
      await panel.fill('[data-image-prop="opacity"]', '40');
      await expect.poll(opacity).toBe('40%');
      await key(focus, false);
      await expect.poll(opacity).toBe('70%');
      await key(focus, true);
      await expect.poll(opacity).toBe('40%');
      await key(focus, false);
      await expect.poll(opacity).toBe('70%');
    }
    await popup.evaluate(async () => {
      const used = await chrome.storage.local.getBytesInUse(null),
        key = 'ui0dQuota';
      await chrome.storage.local.set({ [key]: 'x'.repeat(chrome.storage.local.QUOTA_BYTES - used - key.length - 32) });
    });
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存できませんでした');
    await expect.poll(opacity).toBe('70%');
    // Connection controls are slotted from the extension document, outside the editor shadow root.
    await panel.evaluate('document.querySelector(".disconnect-target").click()');
    await expect(page.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
    await panel.evaluate('document.querySelector(".connect-target").click()');
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status")?.dataset.connected'))
      .toBe('true');
    await expect.poll(opacity).toBe('70%');
    await popup.evaluate(async () => chrome.storage.local.remove('ui0dQuota'));
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.fill('[data-image-prop="opacity"]', '60');
    await expect.poll(opacity).toBe('60%');
    await panel.detach();
    await popup.evaluate(async (tabId) => {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.sidePanel.setOptions({ tabId, enabled: true });
    }, tab);
    await expect(page.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
    await open();
    panel = await sidePanelDriver(context, page, id, tab);
    await expect.poll(opacity).toBe('60%');
    await panel.click('.undo');
    await expect.poll(opacity).toBe('70%');
    await panel.click('.redo');
    await expect.poll(opacity).toBe('60%');
    await info.attach('focus-and-recovery', {
      body: 'Both focus locations: Undo 40→70, Redo 70→40. Quota failure 70; reconnect 70; reopen 60; Undo 70; Redo 60.',
      contentType: 'text/plain',
    });
  } finally {
    await context.close();
  }
});
