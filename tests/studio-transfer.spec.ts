import { test, expect } from './fixtures';
import type { Page, BrowserContext } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { modelFixture } from './helpers/model-fixture';
import { vrmFixture } from './helpers/vrm-fixture';
import { inspectAsset } from '../src/assets/inspect';
import { ASSET_LIMITS } from '../src/assets/limits';
import { observeImports, uploadLeases, assetRows, type StudioImportProbe } from './helpers/studio-import';
import {
  STUDIO_ASSET_TRANSFER,
  STUDIO_TRANSFER_AUTHORIZE,
  STUDIO_TRANSFER_CONFIRM,
} from '../src/assets/studio-transfer-protocol';

async function openStudio(context: BrowserContext, popup: Page, youtube: Page) {
  // check() reads the state before it waits; until settings load the popup shows a disabled,
  // unchecked placeholder (then ON), so a check() started early would turn it OFF.
  const showArtwork = popup.getByRole('switch', { name: '作品を表示する' });
  await expect(showArtwork).toBeEnabled();
  await showArtwork.check();
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  await youtube.bringToFront();
  const opened = context.waitForEvent('page');
  await popup.locator('#creator-editor-window').evaluate((button: HTMLButtonElement) => button.click());
  const studio = await opened;
  await studio.setViewportSize({ width: 1440, height: 1000 });
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  return { studio, panel: studio.locator('#around-creator') };
}
async function authorize(studio: Page, sizes: number[]) {
  const session = 'studio-upload-' + crypto.randomUUID();
  const result = await studio.evaluate(
    async ({ session, sizes, action }) => {
      const ownerTabId = (await chrome.tabs.getCurrent())!.id!;
      return {
        ownerTabId,
        response: await chrome.runtime.sendMessage({
          type: 'around:assets',
          action,
          session,
          ownerTabId,
          sizes,
        }),
      };
    },
    { session, sizes, action: STUDIO_TRANSFER_AUTHORIZE },
  );
  return { session, ...result };
}
async function release(studio: Page, session: string) {
  const result = await studio.evaluate(
    (session) => chrome.runtime.sendMessage({ type: 'around:assets', action: 'release', session }),
    session,
  );
  expect(result.ok).toBe(true);
}
async function rawTransfer(
  page: Page,
  upload: Awaited<ReturnType<typeof authorize>>,
  bytes: Buffer,
  mime: string,
  length = bytes.length,
) {
  return page.evaluate(
    async (args) => {
      const buffer = new Uint8Array(args.length);
      buffer.set(args.bytes);
      const registration = await navigator.serviceWorker.getRegistration(),
        channel = new MessageChannel();
      const request = crypto.randomUUID();
      return new Promise<Record<string, any>>((resolve, reject) => {
        const timer = setTimeout(() => {
          channel.port1.close();
          reject(new Error('Native test reply missing'));
        }, 5000);
        const finish = (value: Record<string, any>) => {
          clearTimeout(timer);
          channel.port1.close();
          resolve(value);
        };
        channel.port1.onmessage = (event) => {
          const value = event.data;
          if (value.type === 'challenge') {
            void chrome.runtime
              .sendMessage({
                type: 'around:assets',
                action: args.confirm,
                session: args.session,
                ownerTabId: args.ownerTabId,
                token: args.grant.token,
                request,
                challenge: value.challenge,
              })
              .then(
                (response) => {
                  if (!response.ok) finish({ type: 'rpc-error', error: response.error });
                },
                (error) => finish({ type: 'rpc-error', error: String(error) }),
              );
          } else finish(value);
        };
        registration!.active!.postMessage(
          {
            type: args.type,
            ...args.grant,
            session: args.session,
            request,
            files: [{ name: 'original', mime: args.mime, buffer: buffer.buffer }],
          },
          [buffer.buffer, channel.port2],
        );
      });
    },
    {
      grant: upload.response.value,
      session: upload.session,
      ownerTabId: upload.ownerTabId,
      bytes: [...bytes],
      mime,
      length,
      type: STUDIO_ASSET_TRANSFER,
      confirm: STUDIO_TRANSFER_CONFIRM,
    },
  );
}
function breakPng(bytes: Buffer) {
  const broken = Buffer.from(bytes);
  for (let at = 8; at + 12 <= broken.length;) {
    const size = broken.readUInt32BE(at);
    if (broken.toString('ascii', at + 4, at + 8) === 'IDAT') broken.fill(0, at + 8, at + 8 + size);
    at += size + 12;
  }
  return broken;
}
function brokenTexture() {
  const bytes = vrmFixture(),
    jsonSize = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const view = json.bufferViews[json.images[0].bufferView],
    start = 28 + jsonSize + (view.byteOffset || 0);
  breakPng(bytes.subarray(start, start + view.byteLength)).copy(bytes, start);
  return bytes;
}

for (const kind of [
  'broken GLB',
  'PNG declared as model',
  'undecodable PNG',
  'undecodable model texture',
  'oversized PNG',
] as const)
  test(`binary worker rejects ${kind} through the shared validator`, async ({ context, popup, youtube }) => {
    const { studio } = await openStudio(context, popup, youtube),
      png = await readFile('tests/fixtures/motion/petal.png');
    const bytes =
      kind === 'broken GLB'
        ? modelFixture().subarray(0, -4)
        : kind === 'undecodable model texture'
          ? brokenTexture()
          : kind === 'undecodable PNG'
            ? breakPng(png)
            : png;
    const mime =
      kind === 'broken GLB' || kind === 'undecodable model texture' || kind === 'PNG declared as model'
        ? 'model/gltf-binary'
        : 'image/png';
    const length = kind === 'oversized PNG' ? ASSET_LIMITS.fileBytes + 1 : bytes.length;
    if (kind === 'undecodable PNG' || kind === 'undecodable model texture')
      expect(() => inspectAsset(bytes, mime)).not.toThrow();
    const upload = await authorize(studio, [length]);
    expect(upload.response.ok).toBe(true);
    const result = await rawTransfer(studio, upload, bytes, mime, length);
    expect(result).toMatchObject({ type: 'error', code: 'invalid' });
    expect(await assetRows(popup)).toEqual([]);
    await release(studio, upload.session);
  });

test('non-Studio pages cannot authorize or consume a Studio binary grant; owner and manifest bounds remain checked', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio } = await openStudio(context, popup, youtube),
    bytes = await readFile('tests/fixtures/motion/petal.png');
  const upload = await authorize(studio, [bytes.length]);
  expect(upload.response.ok).toBe(true);
  const outside = await popup.evaluate(
    ({ session, ownerTabId, action, size }) =>
      chrome.runtime.sendMessage({ type: 'around:assets', action, session, ownerTabId, sizes: [size] }),
    { session: upload.session, ownerTabId: upload.ownerTabId, action: STUDIO_TRANSFER_AUTHORIZE, size: bytes.length },
  );
  expect(outside.ok).toBe(false);
  expect(await rawTransfer(popup, upload, bytes, 'image/png')).toMatchObject({ type: 'error', code: 'unauthorized' });
  const tooLarge = await authorize(studio, [ASSET_LIMITS.modelBytes + 1]);
  expect(tooLarge.response.ok).toBe(false);
  const tooMany = await authorize(studio, Array(ASSET_LIMITS.batchCount + 1).fill(1));
  expect(tooMany.response.ok).toBe(false);
  const wrongOwner = await studio.evaluate(
    ({ session, ownerTabId, action, size }) =>
      chrome.runtime.sendMessage({ type: 'around:assets', action, session, ownerTabId, sizes: [size] }),
    {
      session: 'studio-upload-' + crypto.randomUUID(),
      ownerTabId: upload.ownerTabId + 10000,
      action: STUDIO_TRANSFER_AUTHORIZE,
      size: bytes.length,
    },
  );
  expect(wrongOwner.ok).toBe(false);
  expect(await assetRows(popup)).toEqual([]);
  await release(studio, upload.session);
});

test('a binary message arriving after release cannot recreate the upload lease', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio } = await openStudio(context, popup, youtube),
    bytes = await readFile('tests/fixtures/motion/petal.png');
  const upload = await authorize(studio, [bytes.length]);
  expect(upload.response.ok).toBe(true);
  await release(studio, upload.session);
  expect(await rawTransfer(studio, upload, bytes, 'image/png')).toMatchObject({ type: 'error', code: 'cancelled' });
  expect(await assetRows(popup)).toEqual([]);
});

async function stopWorker(context: BrowserContext, studio: Page) {
  const cdp = await context.newCDPSession(studio);
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const studioURL = new URL(studio.url()),
      workerURL = `${studioURL.protocol}//${studioURL.host}/background/index.js`;
    const owned = targetInfos.find(
      (target: { type: string; url: string }) => target.type === 'service_worker' && target.url === workerURL,
    );
    expect(owned).toBeTruthy();
    await cdp.send('Target.closeTarget', { targetId: owned!.targetId });
  } finally {
    await cdp.detach();
  }
}
for (const stage of ['before save', 'after save before reply'] as const)
  test(`Studio rereads the File after Worker stops ${stage} and stores one asset`, async ({
    context,
    popup,
    youtube,
  }) => {
    const { studio, panel } = await openStudio(context, popup, youtube);
    await observeImports(studio, stage === 'after save before reply');
    const worker = context.serviceWorkers().find((worker) => worker.url().endsWith('/background/index.js'))!;
    if (stage === 'before save')
      await worker.evaluate(() => {
        crypto.subtle.digest = function () {
          (globalThis as any).__studioHashEntered = true;
          return new Promise<ArrayBuffer>(() => {});
        };
      });
    await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    if (stage === 'before save') {
      await expect.poll(() => worker.evaluate(() => (globalThis as any).__studioHashEntered)).toBe(true);
      expect(await assetRows(popup)).toEqual([]);
    } else {
      await expect.poll(() => studio.evaluate(() => (globalThis as any).__studioImportProbe.stored)).toBe(true);
      expect(await uploadLeases(popup)).toHaveLength(1);
    }
    await stopWorker(context, studio);
    await expect(youtube.locator('#around-decorations [data-image-id]')).toHaveCount(1);
    await expect.poll(() => uploadLeases(popup)).toEqual([]);
    const probe = await studio.evaluate(() => (globalThis as any).__studioImportProbe as StudioImportProbe);
    expect(probe.fileReads).toBe(2);
    expect(probe.nativeTransfers).toHaveLength(2);
    expect(probe.nativeTransfers.every((transfer) => transfer.detached)).toBe(true);
    expect(probe.uploads.map((request) => request.action)).not.toContain('import');
    const rows = await assetRows(popup),
      bytes = await readFile('tests/fixtures/motion/petal.png');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('asset-' + createHash('sha256').update(bytes).digest('hex'));
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
  });

test('Studio uses the existing JSON importer when native transfer is unavailable', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio, panel } = await openStudio(context, popup, youtube);
  await observeImports(studio);
  await studio.evaluate(() =>
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined }),
  );
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator('#around-decorations [data-image-id]')).toHaveCount(1);
  await expect.poll(() => uploadLeases(popup)).toEqual([]);
  const probe = await studio.evaluate(() => (globalThis as any).__studioImportProbe as StudioImportProbe);
  expect(probe.nativeTransfers).toEqual([]);
  expect(probe.uploads.map((request) => request.action)).toContain('import');
  expect(probe.portImports[0]!.type).toBe('import-assets');
});

function paddedVrm() {
  const raw = vrmFixture(),
    size = 33 * 1024 * 1024,
    json = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString());
  const bin = raw.subarray(28 + raw.readUInt32LE(12));
  json.buffers[0].byteLength = size;
  const text = Buffer.from(JSON.stringify(json)),
    header = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 32)]),
    result = Buffer.alloc(28 + header.length + size);
  result.writeUInt32LE(0x46546c67);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(header.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  header.copy(result, 20);
  result.writeUInt32LE(size, 20 + header.length);
  result.writeUInt32LE(0x004e4942, 24 + header.length);
  bin.copy(result, 28 + header.length);
  return result;
}
test('large fallback still stores through bounded chunks and releases on interruption without rendering', async ({
  context,
  popup,
  youtube,
}, info) => {
  const { studio, panel } = await openStudio(context, popup, youtube);
  await observeImports(studio, true);
  await studio.evaluate(() =>
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined }),
  );
  const file = info.outputPath('padded.vrm');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, paddedVrm());
  await panel.locator('.model-file').setInputFiles(file);
  await expect.poll(() => studio.evaluate(() => (globalThis as any).__studioImportProbe.stored)).toBe(true);
  const rows = await assetRows(popup);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.byteLength).toBeGreaterThan(ASSET_LIMITS.fileBytes);
  const probe = await studio.evaluate(() => (globalThis as any).__studioImportProbe as StudioImportProbe);
  expect(probe.nativeTransfers).toEqual([]);
  expect(probe.uploads.map((request) => request.action)).toContain('upload-start');
  expect(probe.uploads.filter((request) => request.action === 'upload-part')).toHaveLength(
    Math.ceil(rows[0]!.byteLength / ASSET_LIMITS.chunkBytes),
  );
  await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect.poll(() => uploadLeases(popup)).toEqual([]);
  await studio.evaluate(() => (globalThis as any).__studioImportProbe.resume());
  await expect(youtube.locator('#around-decorations .model-media')).toHaveCount(0);
});
