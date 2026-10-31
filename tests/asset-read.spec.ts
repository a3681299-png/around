import { test, expect } from './fixtures';
import type { Page, BrowserContext } from '@playwright/test';
import { isolate, open } from './helpers/world-host';
import { exposeEditorControls } from './helpers/editor-workspace';
import { ASSET_READ_MESSAGE, ASSET_READ_PORT, ASSET_READ_FRAME } from '../src/assets/read-protocol';
import { defaultModelSettings } from '../src/models/types';
import type { AssetMetadata } from '../src/assets/validation';
import type { DesignDocument } from '../src/design/types';
import { vrmFixture } from './helpers/vrm-fixture';

async function observe(page: Page, extension: string) {
  const runtime = await isolate(page, extension);
  await runtime.evaluate(`(() => {
    const send = chrome.runtime.sendMessage;
    globalThis.__assetReads = [];
    chrome.runtime.sendMessage = async (...args) => {
      const message = args[0], response = await Reflect.apply(send, chrome.runtime, args);
      if (message.type === ${JSON.stringify(ASSET_READ_MESSAGE)} || ['get','get-part'].includes(message.action))
        globalThis.__assetReads.push({ action: message.action, ok: response?.ok, code: response?.code, generation: message.generation });
      return response;
    };
  })()`);
  return runtime;
}
async function frame(context: BrowserContext) {
  await expect
    .poll(() =>
      context
        .pages()
        .flatMap((p) => p.frames())
        .some((f) => f.url().endsWith(ASSET_READ_FRAME)),
    )
    .toBe(true);
  return context
    .pages()
    .flatMap((p) => p.frames())
    .find((f) => f.url().endsWith(ASSET_READ_FRAME))!;
}
async function auditFrame(context: BrowserContext, gate = false) {
  await context.addInitScript(
    ({ path, gate }) => {
      if (!location.pathname.endsWith(path)) return;
      (globalThis as any).__readTransfers = [];
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (message, ...args) {
        const size = message?.source?.buffer?.byteLength;
        const result = Reflect.apply(post, this, [message, ...args]);
        if (message?.type === 'source')
          (globalThis as any).__readTransfers.push({ bytes: size, detached: message.source.buffer.byteLength === 0 });
        return result;
      };
      if (gate) {
        const read = Blob.prototype.arrayBuffer;
        let first = true;
        Blob.prototype.arrayBuffer = async function () {
          if (first) {
            first = false;
            (globalThis as any).__readEntered = true;
            await new Promise<void>((resolve) => {
              (globalThis as any).__resumeRead = resolve;
            });
          }
          const result = await read.call(this);
          (globalThis as any).__readCompleted = true;
          return result;
        };
      }
    },
    { path: ASSET_READ_FRAME, gate },
  );
}

test('official binary reads detach the original, reject page-forged ports and expose only the HTML', async ({
  context,
  popup,
  youtube,
  extensionId,
}) => {
  await auditFrame(context);
  const dialog = await open(popup, youtube),
    runtime = await observe(youtube, extensionId);
  await dialog.getByLabel('画像素材を追加').setInputFiles('tests/fixtures/motion/petal.png');
  await expect(youtube.locator('.media[data-playback="still"] img')).toBeVisible();
  const storage = await frame(context);
  expect(await storage.evaluate(() => (globalThis as any).__readTransfers)).toEqual([
    { bytes: expect.any(Number), detached: true },
  ]);
  const calls = await runtime.evaluate<{ action: string; ok: boolean }[]>('globalThis.__assetReads');
  expect(calls.filter((c) => c.action === 'authorize' && c.ok)).toHaveLength(1);
  expect(calls.some((c) => c.action === 'get' || c.action === 'get-part')).toBe(false);
  const forged = await youtube.evaluate(
    async ({ type }) => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-ww-asset-reader]')!,
        channel = new MessageChannel();
      return new Promise((resolve) => {
        channel.port1.onmessage = (event) => {
          if (event.data.type === 'challenge') channel.port1.postMessage({ type: 'read', token: 'page-forged' });
          else {
            channel.port1.close();
            resolve(event.data);
          }
        };
        frame.contentWindow!.postMessage(
          { type, id: 'asset-' + 'a'.repeat(64), token: 'page-forged' },
          new URL(frame.src).origin,
          [channel.port2],
        );
      });
    },
    { type: ASSET_READ_PORT },
  );
  expect(forged).toMatchObject({ type: 'error', code: 'denied' });
  expect(await storage.evaluate(() => (globalThis as any).__readTransfers)).toHaveLength(1);
  const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).toEqual(['storage', 'sidePanel']);
  expect(manifest.web_accessible_resources!.flatMap((r) => (typeof r === 'string' ? [r] : r.resources))).toEqual([
    'assets/fonts/PixelMplus12-Regular.woff2',
    ASSET_READ_FRAME,
  ]);
});

test('a real frame grant cannot be authorized by a different tab or for an unapproved material', async ({
  context,
  popup,
  youtube,
  extensionId,
}) => {
  const dialog = await open(popup, youtube),
    runtime = await observe(youtube, extensionId);
  await dialog.getByLabel('画像素材を追加').setInputFiles('tests/fixtures/motion/petal.png');
  await expect(youtube.locator('.media[data-playback="still"]')).toHaveCount(1);
  await dialog.locator('.save').click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
  const saved = (await popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  )) as DesignDocument;
  const foreign = (await popup.evaluate(
    async (base64) =>
      (
        await chrome.runtime.sendMessage({
          type: 'web-world-themes:assets',
          action: 'import',
          session: 'c3-unapproved',
          files: [{ name: 'unapproved', mime: '', base64 }],
        })
      ).value[0].id,
    vrmFixture().toString('base64'),
  )) as string;
  const storage = await frame(context);
  const challenge = await storage.evaluate(
    async (type) => (await chrome.runtime.sendMessage({ type, action: 'open' })).value,
    ASSET_READ_MESSAGE,
  );
  const other = await context.newPage();
  await other.goto('https://www.youtube.com/');
  const otherRuntime = await isolate(other, extensionId);
  const request = { type: ASSET_READ_MESSAGE, action: 'authorize', ...challenge, id: saved.decorations[0]!.assetId };
  expect(await otherRuntime.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`)).toMatchObject({
    ok: false,
    code: 'denied',
  });
  expect(
    await runtime.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ ...request, id: foreign })})`),
  ).toMatchObject({
    ok: false,
    code: 'denied',
  });
});

test('Worker termination during IDB reading reauthorizes the same request without a chunk fallback', async ({
  context,
  popup,
  youtube,
  extensionId,
}) => {
  await auditFrame(context, true);
  const dialog = await open(popup, youtube),
    runtime = await observe(youtube, extensionId);
  await dialog.getByLabel('画像素材を追加').setInputFiles('tests/fixtures/motion/petal.png');
  const storage = await frame(context);
  await expect.poll(() => storage.evaluate(() => (globalThis as any).__readEntered)).toBe(true);
  const cdp = await context.newCDPSession(youtube);
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const worker = targetInfos.find(
      (t: { type: string; url: string }) =>
        t.type === 'service_worker' && t.url === `chrome-extension://${extensionId}/background/index.js`,
    )!;
    expect(worker).toBeTruthy();
    await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  } finally {
    await cdp.detach();
  }
  await storage.evaluate(() => (globalThis as any).__resumeRead());
  await expect(youtube.locator('.media[data-playback="still"] img')).toBeVisible();
  const calls =
    await runtime.evaluate<{ action: string; ok: boolean; generation?: string }[]>('globalThis.__assetReads');
  const authorizations = calls.filter((c) => c.action === 'authorize' && c.ok);
  expect(authorizations).toHaveLength(2);
  expect(authorizations[0]!.generation).not.toBe(authorizations[1]!.generation);
  expect(calls.some((c) => c.action === 'get' || c.action === 'get-part')).toBe(false);
  expect(await storage.evaluate(() => (globalThis as any).__readTransfers)).toHaveLength(1);
});

test('missing binary support keeps real chunk requests and still renders a small VRM', async ({
  popup,
  youtube,
  extensionId,
}) => {
  const dialog = await open(popup, youtube),
    runtime = await observe(youtube, extensionId);
  await runtime.evaluate(`(() => {
    globalThis.MessageChannel = undefined;
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async (...args) => {
      const reply = await Reflect.apply(send, chrome.runtime, args);
      // Request chunk delivery for the small fixture, avoiding a large/GPU-dependent avatar in CI.
      if (args[0].action === 'get' && reply?.ok) { reply.value.chunked = true; delete reply.value.base64; }
      return reply;
    };
  })()`);
  await dialog.locator('.model-file').setInputFiles({ name: 'test.vrm', mimeType: '', buffer: vrmFixture() });
  await expect(youtube.locator('.model-media')).toHaveAttribute('data-renderer', 'three');
  const calls = await runtime.evaluate<{ action: string }[]>('globalThis.__assetReads');
  expect(calls.some((c) => c.action === 'authorize')).toBe(false);
  expect(calls.some((c) => c.action === 'get-part')).toBe(true);
});

test('ending a display during the original read revokes the capability and cannot send a late buffer', async ({
  context,
  popup,
  youtube,
  extensionId,
}) => {
  await auditFrame(context, true);
  const dialog = await open(popup, youtube),
    runtime = await observe(youtube, extensionId);
  await dialog.locator('.model-file').setInputFiles({ name: 'test.vrm', mimeType: '', buffer: vrmFixture() });
  const storage = await frame(context);
  await expect.poll(() => storage.evaluate(() => (globalThis as any).__readEntered)).toBe(true);
  await popup.getByRole('switch', { name: 'テーマを使う' }).uncheck();
  await expect(youtube.locator('.model-media')).toHaveCount(0);
  await expect
    .poll(async () =>
      (await runtime.evaluate<{ action: string }[]>('globalThis.__assetReads')).some((c) => c.action === 'cancel'),
    )
    .toBe(true);
  await storage.evaluate(() => (globalThis as any).__resumeRead());
  // Hidden storage frames do not receive RAFs. Wait for the actual read continuation instead.
  await expect.poll(() => storage.evaluate(() => (globalThis as any).__readCompleted)).toBe(true);
  expect(await storage.evaluate(() => (globalThis as any).__readTransfers)).toEqual([]);
});

test('fullscreen leaves the storage frame in place and reads new originals before and after exit', async ({
  context,
  popup,
  youtube,
  extensionId,
}) => {
  await auditFrame(context);
  const dialog = await open(popup, youtube),
    runtime = await observe(youtube, extensionId);
  await dialog.getByLabel('画像素材を追加').setInputFiles('tests/fixtures/motion/petal.png');
  await expect(youtube.locator('.media[data-playback="still"]')).toHaveCount(1);
  const storage = await frame(context);
  await storage.evaluate(() => {
    (globalThis as any).__storageDocument = crypto.randomUUID();
  });
  const document = await storage.evaluate(() => (globalThis as any).__storageDocument);
  await exposeEditorControls(dialog);
  await dialog.locator('.save').click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
  await dialog.locator('.close').click();
  await youtube.locator('#navigate').click();
  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => youtube.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  expect(
    await youtube
      .locator('[data-ww-asset-reader]')
      .evaluate(
        (node) => node.parentElement === document.documentElement && !document.fullscreenElement!.contains(node),
      ),
  ).toBe(true);
  async function addModel(label: string) {
    const bytes = vrmFixture((json) => {
      json.asset.generator = label;
    });
    const metadata = (await popup.evaluate(
      async (base64) =>
        (
          await chrome.runtime.sendMessage({
            type: 'web-world-themes:assets',
            action: 'import',
            session: 'c3-test-models',
            files: [{ name: 'fixture', mime: '', base64 }],
          })
        ).value[0],
      bytes.toString('base64'),
    )) as AssetMetadata;
    const doc = (await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    )) as DesignDocument;
    doc.decorations = [
      ...doc.decorations.filter((layer) => layer.kind !== 'model3d'),
      {
        kind: 'model3d',
        id: 'image-fullscreen-model',
        name: 'fixture',
        assetId: metadata.id,
        placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 200, heightPx: 200, rotationDeg: 0 },
        opacity: 1,
        zIndex: 1,
        visible: true,
        locked: false,
        source: metadata.model!,
        model: defaultModelSettings(metadata.model!),
      },
    ];
    await popup.evaluate((value) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': value }), doc);
    await expect(youtube.locator('.model-media')).toHaveAttribute('data-renderer', 'three');
  }
  await addModel('inside-fullscreen');
  await youtube.evaluate(() => document.exitFullscreen());
  await expect.poll(() => youtube.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  expect(await storage.evaluate(() => (globalThis as any).__storageDocument)).toBe(document);
  await addModel('after-fullscreen');
  expect(
    (await runtime.evaluate<{ action: string; ok: boolean }[]>('globalThis.__assetReads')).filter(
      (c) => c.action === 'authorize' && c.ok,
    ).length,
  ).toBeGreaterThan(1);
});
