import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createAssetReadService } from '../src/background/asset-read';
import { ASSET_READ_TTL_MS, AssetReadError } from '../src/assets/read-protocol';
import { installAssetReadAdapter } from '../src/assets/read-adapter';
import { clearAssetSources, loadAsset } from '../src/browser/asset-client';
import { inspectAsset } from '../src/assets/inspect';
import { parseVerifiedModelSource, verifiedModelBytes } from '../src/assets/verified-source';
import { vrmFixture } from './helpers/vrm-fixture';
import { ASSET_LIMITS } from '../src/assets/limits';

const id = `asset-${'a'.repeat(64)}`,
  foreign = `asset-${'b'.repeat(64)}`;
const frameURL = 'chrome-extension://extension/assets/read-frame.html';
const host = {
  id: 'extension',
  tab: { id: 12 },
  frameId: 0,
  documentId: 'youtube-a',
  origin: 'https://www.youtube.com',
  url: 'https://www.youtube.com/watch?v=test',
} as chrome.runtime.MessageSender;
const frame = { ...host, frameId: 7, documentId: 'frame-a', origin: 'chrome-extension://extension', url: frameURL };
function harness() {
  let now = 0,
    allowed = true,
    live = true;
  const service = createAssetReadService({
    extensionId: 'extension',
    frameURL,
    now: () => now,
    approved: async (asset, owner) => allowed && asset === id && owner.document === host.documentId,
    confirm: async (_owner, proof) => live && proof.id === id,
  });
  async function opened() {
    return (await service.handle({ action: 'open' }, frame)) as { challenge: string; generation: string };
  }
  async function issued() {
    const open = await opened(),
      grant = (await service.handle({ action: 'authorize', ...open, id }, host)) as { token: string };
    return { ...open, ...grant };
  }
  return {
    service,
    opened,
    issued,
    expire: () => {
      now += ASSET_READ_TTL_MS;
    },
    revoke: () => {
      allowed = false;
    },
    abandon: () => {
      live = false;
    },
  };
}

test('asset reads require an approved ID, matching native tab, document and frame; tickets are one use', async () => {
  const h = harness();
  try {
    const open = await h.opened();
    await expect(h.service.handle({ action: 'authorize', ...open, id: foreign }, host)).rejects.toThrow(/許可/);
    const grant = await h.issued();
    for (const sender of [
      { ...frame, tab: { ...host.tab!, id: 13 } },
      { ...frame, documentId: 'frame-b' },
      { ...frame, frameId: 8 },
      { ...frame, url: frameURL + '?fake' },
      { ...frame, id: 'foreign' },
    ])
      await expect(h.service.handle({ action: 'consume', ...grant }, sender)).rejects.toThrow();
    await expect(
      h.service.handle({ action: 'authorize', ...grant, id }, { ...host, documentId: 'youtube-b' }),
    ).rejects.toThrow();
    expect(await h.service.handle({ action: 'consume', ...grant }, frame)).toEqual({ id });
    await expect(h.service.handle({ action: 'consume', ...grant }, frame)).rejects.toThrow();
    expect(await h.service.handle({ action: 'deliver', ...grant }, frame)).toEqual({ allowed: true });
    await expect(h.service.handle({ action: 'deliver', ...grant }, frame)).rejects.toThrow();
    const next = await h.opened();
    await expect(
      h.service.handle({ action: 'authorize', ...next, id }, { ...host, tab: { ...host.tab!, id: 13 } }),
    ).rejects.toThrow();
  } finally {
    h.service.destroy();
  }
});

for (const sender of [
  { ...frame, frameId: 0 },
  { ...frame, documentId: '' },
  { ...frame, documentLifecycle: 'cached' as const },
  { ...frame, origin: 'null' },
  { ...frame, url: 'chrome-extension://extension/popup/index.html' },
])
  test(`only the live storage iframe can open a read challenge: ${JSON.stringify(sender)}`, async () => {
    const h = harness();
    try {
      await expect(h.service.handle({ action: 'open' }, sender)).rejects.toThrow();
    } finally {
      h.service.destroy();
    }
  });

for (const stop of ['expire', 'revoke', 'abandon', 'cancel', 'tab'] as const)
  test(`an in-flight read cannot deliver after ${stop}`, async () => {
    const h = harness();
    try {
      const grant = await h.issued();
      await h.service.handle({ action: 'consume', ...grant }, frame);
      if (stop === 'cancel') await h.service.handle({ action: 'cancel', ...grant }, host);
      else if (stop === 'tab') h.service.revokeTab(12);
      else h[stop]();
      await expect(h.service.handle({ action: 'deliver', ...grant }, frame)).rejects.toThrow();
    } finally {
      h.service.destroy();
    }
  });

test('expired, consumed and pre-restart authorizations cannot be revived; a fresh grant works', async () => {
  const h = harness(),
    restarted = harness();
  try {
    const grant = await h.issued();
    h.expire();
    await expect(h.service.handle({ action: 'consume', ...grant }, frame)).rejects.toThrow();
    await expect(restarted.service.handle({ action: 'consume', ...grant }, frame)).rejects.toMatchObject({
      code: 'restart',
    });
    const fresh = await restarted.issued();
    expect(await restarted.service.handle({ action: 'consume', ...fresh }, frame)).toEqual({ id });
  } finally {
    h.service.destroy();
    restarted.service.destroy();
  }
});

test('cancelling while approval is pending cannot recreate the capability', async () => {
  let resume: (value: boolean) => void = () => {};
  const service = createAssetReadService({
    extensionId: 'extension',
    frameURL,
    approved: () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
    confirm: async () => true,
  });
  try {
    const open = (await service.handle({ action: 'open' }, frame)) as { challenge: string; generation: string };
    const approving = service.handle({ action: 'authorize', ...open, id }, host);
    const rejected = expect(approving).rejects.toThrow();
    await service.handle({ action: 'cancel', ...open }, host);
    resume(true);
    await rejected;
    await expect(service.handle({ action: 'authorize', ...open, id }, host)).rejects.toThrow();
  } finally {
    service.destroy();
  }
});

const originalChrome = globalThis.chrome;
test.afterEach(() => {
  clearAssetSources();
  if (originalChrome) globalThis.chrome = originalChrome;
  else Reflect.deleteProperty(globalThis, 'chrome');
});

for (const kind of ['png', 'vrm'] as const)
  test(`binary ${kind} sources cross the shared inspector and retain the appropriate immutable source`, async () => {
    const bytes = kind === 'png' ? readFileSync('tests/fixtures/motion/petal.png') : vrmFixture(),
      info = inspectAsset(bytes),
      metadata = { ...info, id, name: 'fixture', byteLength: bytes.length };
    const uninstall = installAssetReadAdapter(async () => ({ metadata, buffer: Uint8Array.from(bytes).buffer }));
    try {
      const source = await loadAsset(id);
      expect(source.metadata).toEqual(metadata);
      if (kind === 'vrm') {
        expect(source.blob).toBeUndefined();
        expect(verifiedModelBytes(source.modelBuffer!)).toBeGreaterThan(0);
        expect(
          await parseVerifiedModelSource(source.modelBuffer!, {
            parseAsync: async (buffer) => new Uint8Array(buffer).slice(),
          }),
        ).toEqual(Uint8Array.from(bytes));
      } else {
        expect(source.modelBuffer).toBeUndefined();
        expect(new Uint8Array(await source.blob!.arrayBuffer())).toEqual(Uint8Array.from(bytes));
        expect(verifiedModelBytes(source.blob!)).toBeUndefined();
      }
    } finally {
      uninstall();
    }
  });

test('binary rejection never falls back around MIME/container validation or authorization', async () => {
  let calls = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => {
        calls++;
        return undefined;
      },
    },
  } as unknown as typeof chrome;
  const bytes = readFileSync('tests/fixtures/motion/petal.png');
  let uninstall = installAssetReadAdapter(async () => ({
    metadata: { ...inspectAsset(bytes), id, name: 'bad', mime: 'model/gltf-binary', byteLength: bytes.length },
    buffer: Uint8Array.from(bytes).buffer,
  }));
  try {
    await expect(loadAsset(id)).rejects.toThrow();
  } finally {
    uninstall();
    clearAssetSources();
  }
  uninstall = installAssetReadAdapter(async () => {
    throw new AssetReadError('denied', 'not approved');
  });
  try {
    await expect(loadAsset(id)).rejects.toThrow(/approved/);
    expect(calls).toBe(0);
  } finally {
    uninstall();
  }
});

test('unavailable binary storage uses the unchanged Base64 reader and the same final validation', async () => {
  const bytes = readFileSync('tests/fixtures/motion/petal.png'),
    metadata = { ...inspectAsset(bytes), id, name: 'fallback', byteLength: bytes.length };
  const requests: string[] = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message: { action: string }) => {
        requests.push(message.action);
        return { ok: true, value: { metadata, base64: bytes.toString('base64') } };
      },
    },
  } as unknown as typeof chrome;
  const uninstall = installAssetReadAdapter(async () => undefined);
  try {
    expect((await loadAsset(id)).metadata).toEqual(metadata);
    expect(requests).toEqual(['get']);
  } finally {
    uninstall();
  }
});

for (const invalid of ['broken-glb', 'oversized'] as const)
  test(`binary ${invalid} data cannot bypass the shared inspector`, async () => {
    const original = vrmFixture(),
      info = inspectAsset(original);
    const bytes = invalid === 'oversized' ? new Uint8Array(ASSET_LIMITS.modelBytes + 1) : Uint8Array.from(original);
    if (invalid === 'broken-glb') new DataView(bytes.buffer).setUint32(4, 1, true);
    const uninstall = installAssetReadAdapter(async () => ({
      metadata: {
        ...info,
        id,
        name: 'invalid',
        byteLength: bytes.length,
      },
      buffer: bytes.buffer,
    }));
    try {
      await expect(loadAsset(id)).rejects.toThrow();
    } finally {
      uninstall();
    }
  });
