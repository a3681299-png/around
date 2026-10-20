import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { ASSET_MESSAGE } from '../src/assets/protocol';
import type { AssetMetadata } from '../src/assets/validation';

const png = { name: 'petal.png', mime: 'image/png', base64: readFileSync('tests/fixtures/motion/petal.png').toString('base64') };

test('worker reuses fully validated imports and rejects a changed MIME declaration', async ({ popup, context }) => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    let calls = 0; const decode = globalThis.createImageBitmap;
    globalThis.createImageBitmap = ((...args: unknown[]) => { calls++; return Reflect.apply(decode, globalThis, args); }) as typeof createImageBitmap;
    (globalThis as { testBitmapCalls?: () => number }).testBitmapCalls = () => calls;
  });
  const send = (file = png) => popup.evaluate((message) => chrome.runtime.sendMessage(message), { type: ASSET_MESSAGE, action: 'import', session: 'import-reuse', files: [file] });
  const first = await send(); expect(first).toMatchObject({ ok: true });
  expect(await worker.evaluate(() => (globalThis as { testBitmapCalls?: () => number }).testBitmapCalls?.())).toBe(1);
  expect(await send()).toMatchObject({ ok: true, value: first.value });
  expect(await send({ ...png, mime: '' })).toMatchObject({ ok: true, value: first.value });
  expect(await worker.evaluate(() => (globalThis as { testBitmapCalls?: () => number }).testBitmapCalls?.())).toBe(1);
  expect(await send({ ...png, mime: 'video/webm' })).toMatchObject({ ok: false });
  expect(await send()).toMatchObject({ ok: true, value: first.value });
  expect(await worker.evaluate(() => (globalThis as { testBitmapCalls?: () => number }).testBitmapCalls?.())).toBe(1);
});

test('worker accepts lease and release bursts larger than the former mutation queue cap', async ({ popup }) => {
  const imported = await popup.evaluate((message) => chrome.runtime.sendMessage(message), { type: ASSET_MESSAGE, action: 'import', session: 'burst-owner', files: [png] });
  expect(imported).toMatchObject({ ok: true }); const asset = (imported.value as AssetMetadata[])[0]!;
  const results = await popup.evaluate(async ({ type, id }) => Promise.all(Array.from({ length: 130 }, (_, i) => chrome.runtime.sendMessage({
    type, action: i % 2 ? 'release' : 'lease', session: `burst-${i}`, ids: [id],
  }))), { type: ASSET_MESSAGE, id: asset.id });
  expect(results).toHaveLength(130);
  results.forEach((result) => expect(result).toEqual({ ok: true }));
  expect(await popup.evaluate((message) => chrome.runtime.sendMessage(message), { type: ASSET_MESSAGE, action: 'lease', session: 'burst-owner', ids: [asset.id] })).toEqual({ ok: true });
});
