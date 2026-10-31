import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createStudioTransferService, type StudioTransferEvent } from '../src/background/studio-transfer';
import { createStudioUploader } from '../src/assets/studio-upload';
import { ASSET_LIMITS } from '../src/assets/limits';
import {
  STUDIO_ASSET_TRANSFER,
  STUDIO_TRANSFER_AUTHORIZE,
  STUDIO_TRANSFER_CONFIRM,
  STUDIO_TRANSFER_STATUS,
  type StudioTransferRequest,
} from '../src/assets/studio-transfer-protocol';
import type { AssetMetadata } from '../src/assets/validation';

const url = 'chrome-extension://extension/studio/index.html?target=12';
const session = 'studio-upload-test';
const sender = { id: 'extension', url, documentId: 'document-a', frameId: 0 };
const values = { session, ownerTabId: 5, sizes: [4] };
const metadata: AssetMetadata = {
  id: `asset-${'a'.repeat(64)}`,
  name: 'test',
  byteLength: 4,
  mime: 'image/png',
  width: 1,
  height: 1,
};

function workerHarness(
  options: {
    now?: () => number;
    enqueue?: <T>(action: () => Promise<T>) => Promise<T>;
    sidePanelDocument?: (url: string) => Promise<string | undefined>;
  } = {},
) {
  let writes = 0;
  const service = createStudioTransferService({
    ...options,
    studioURL: url.split('?')[0]!,
    extensionId: 'extension',
    sidePanelDocument: options.sidePanelDocument ?? (async () => undefined),
    client: async (id) => ({ id, url, frameType: 'top-level' }),
    owner: async (message) => ({ session: message['session'] as string, tabId: 5, documentId: 'studio:5' }),
    enqueue: options.enqueue ?? ((action) => action()),
    importBatch: async (_input, _lease, bytes) => {
      writes++;
      expect(bytes.map((b) => b.length)).toEqual([4]);
      return [metadata];
    },
  });
  function receive(grant: { token: string; generation: string }, patch: Record<string, unknown> = {}, sourceURL = url) {
    const replies: Record<string, any>[] = [],
      tasks: Promise<unknown>[] = [];
    const request = {
      type: STUDIO_ASSET_TRANSFER,
      ...grant,
      session,
      request: crypto.randomUUID(),
      files: [{ name: 'test', mime: 'image/png', buffer: new ArrayBuffer(4) }],
      ...patch,
    };
    service.receive({
      data: request,
      source: { id: 'native-client', url: sourceURL, frameType: 'top-level' },
      ports: [
        { postMessage: (value: Record<string, unknown>) => replies.push(value), close() {} } as unknown as MessagePort,
      ],
      waitUntil: (task) => tasks.push(task),
    } satisfies StudioTransferEvent);
    return { request, replies, finish: () => Promise.all(tasks) };
  }
  return { service, receive, writes: () => writes };
}

for (const badSender of [
  { ...sender, url: 'chrome-extension://extension/popup/index.html' },
  { ...sender, frameId: 1 },
  { id: sender.id, url, frameId: 0 },
  { ...sender, id: 'another-extension' },
])
  test(`transfer grants reject untrusted Runtime sender ${JSON.stringify(badSender)}`, async () => {
    const h = workerHarness();
    await expect(h.service.authorize(values, badSender)).rejects.toThrow(/エディター/);
    expect(h.writes()).toBe(0);
  });

test('native side-panel Runtime metadata comes from the live Chrome context and cannot survive document replacement', async () => {
  const panelSender = { id: sender.id, url: url + '&surface=sidepanel' };
  let document = 'panel-original';
  const h = workerHarness({
    sidePanelDocument: async (sourceURL) => (sourceURL === panelSender.url ? document : undefined),
  });
  const grant = await h.service.authorize(values, panelSender);
  expect(await h.service.status({ ...values, token: grant.token }, panelSender)).toMatchObject({ active: true });
  document = 'panel-replacement';
  expect(await h.service.status({ ...values, token: grant.token }, panelSender)).toMatchObject({ active: false });
  h.service.revoke(session);
  expect(h.writes()).toBe(0);
});

test('a claimed side-panel URL without a unique live Chrome context cannot authorize a transfer', async () => {
  await expect(
    workerHarness().service.authorize(values, { id: sender.id, url: url + '&surface=sidepanel' }),
  ).rejects.toThrow(/ドキュメント/);
});

for (const sizes of [
  [],
  Array(9).fill(1),
  [0],
  [-1],
  [1.5],
  [ASSET_LIMITS.modelBytes + 1],
  [20 * 1024 * 1024, 20 * 1024 * 1024],
])
  test(`worker transfer manifest bounds ${JSON.stringify(sizes)}`, async () => {
    await expect(workerHarness().service.authorize({ ...values, sizes }, sender)).rejects.toThrow();
  });

test('native buffers require the original Runtime document to confirm the private challenge', async () => {
  const h = workerHarness(),
    grant = await h.service.authorize(values, sender),
    received = h.receive(grant);
  await expect.poll(() => received.replies[0]?.type).toBe('challenge');
  const confirmation = {
    ...values,
    ...grant,
    request: received.request.request,
    challenge: received.replies[0]!.challenge,
  };
  await expect(h.service.confirm(confirmation, { ...sender, documentId: 'document-b' })).rejects.toThrow(/確認元/);
  expect(h.writes()).toBe(0);
  await h.service.confirm(confirmation, sender);
  await received.finish();
  expect(h.writes()).toBe(1);
  expect(received.replies.at(-1)).toMatchObject({ type: 'done', assets: [metadata] });
});

test('another page cannot consume a Studio grant; mismatched buffer sizes cannot enter the importer', async () => {
  const h = workerHarness(),
    grant = await h.service.authorize(values, sender);
  expect(h.receive(grant, {}, 'chrome-extension://extension/popup/index.html').replies[0]).toMatchObject({
    type: 'error',
    code: 'unauthorized',
  });
  expect(h.receive(grant, { files: [{ buffer: new ArrayBuffer(5) }] }).replies[0]).toMatchObject({
    type: 'error',
    code: 'invalid',
  });
  expect(h.writes()).toBe(0);
  h.service.revoke(session);
});

test('revoking an upload rejects a late native event and a queued confirmation cannot revive it', async () => {
  const h = workerHarness(),
    grant = await h.service.authorize(values, sender),
    received = h.receive(grant);
  await expect.poll(() => received.replies[0]?.type).toBe('challenge');
  h.service.revoke(session);
  await received.finish();
  expect(
    await h.service.confirm(
      { ...values, ...grant, request: received.request.request, challenge: received.replies[0]!.challenge },
      sender,
    ),
  ).toMatchObject({ accepted: false });
  expect(h.receive(grant).replies[0]).toMatchObject({ type: 'error', code: 'cancelled' });
  expect(h.writes()).toBe(0);
});

test('a restarted worker rejects an old grant as restart instead of storing unauthenticated buffers', async () => {
  const original = workerHarness(),
    grant = await original.service.authorize(values, sender),
    next = workerHarness();
  expect(next.receive(grant).replies[0]).toMatchObject({ type: 'error', code: 'restart' });
  expect(next.writes()).toBe(0);
});

test('expired grants cannot be confirmed and their retained buffers are released', async () => {
  let now = 0;
  const h = workerHarness({ now: () => now }),
    grant = await h.service.authorize(values, sender),
    received = h.receive(grant);
  await expect.poll(() => received.replies[0]?.type).toBe('challenge');
  now = 60001;
  expect(
    await h.service.confirm(
      { ...values, ...grant, request: received.request.request, challenge: received.replies[0]!.challenge },
      sender,
    ),
  ).toMatchObject({ accepted: false });
  await received.finish();
  expect(h.writes()).toBe(0);
});

test('a confirmed import queued behind cancellation cannot recreate its revoked lease', async () => {
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const h = workerHarness({
    enqueue: async (action) => {
      await gate;
      return action();
    },
  });
  const grant = await h.service.authorize(values, sender),
    received = h.receive(grant);
  await expect.poll(() => received.replies[0]?.type).toBe('challenge');
  expect(
    await h.service.confirm(
      { ...values, ...grant, request: received.request.request, challenge: received.replies[0]!.challenge },
      sender,
    ),
  ).toMatchObject({ accepted: true });
  h.service.revoke(session);
  resume();
  await received.finish();
  expect(h.writes()).toBe(0);
});

function uploaderHarness(
  options: {
    restarts?: number;
    unavailable?: boolean;
    postError?: boolean;
    invalid?: boolean;
    pending?: boolean;
    silent?: boolean;
  } = {},
) {
  let generation = 'worker-0',
    attempts = 0,
    reads = 0,
    fallbacks = 0;
  const stored = new Map<string, AssetMetadata>(),
    buffers: ArrayBuffer[] = [],
    serverPorts: MessagePort[] = [];
  const messages = new Map<string, { request: StudioTransferRequest; port: MessagePort }>();
  const worker: Pick<ServiceWorker, 'postMessage'> = {
    postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      if (options.postError) throw new DOMException('unsupported transfer', 'DataCloneError');
      const list = Array.isArray(transfer) ? transfer : (transfer?.transfer ?? []);
      const input = message as StudioTransferRequest;
      buffers.push(...input.files.map((file) => file.buffer));
      const received = structuredClone({ request: input, port: list.at(-1) }, { transfer: list }) as {
        request: StudioTransferRequest;
        port: MessagePort;
      };
      messages.set(input.request, received);
      serverPorts.push(received.port);
      attempts++;
      if (!options.silent)
        received.port.postMessage({ type: 'challenge', request: input.request, generation, challenge: 'private' });
    },
  };
  const upload = createStudioUploader({
    worker: async () => (options.unavailable ? undefined : worker),
    channel: () => new MessageChannel(),
    heartbeatMs: 5,
    timeoutMs: options.silent ? 30 : 1000,
    read: async (file) => {
      reads++;
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
    fallback: async (files) => {
      fallbacks++;
      expect(files).toHaveLength(1);
      return [metadata];
    },
    async rpc<T>(action: string, message: Record<string, unknown>): Promise<T> {
      if (action === STUDIO_TRANSFER_AUTHORIZE) return { token: crypto.randomUUID(), generation } as T;
      if (action === STUDIO_TRANSFER_STATUS) return { generation, active: true } as T;
      expect(action).toBe(STUDIO_TRANSFER_CONFIRM);
      const received = messages.get(message['request'] as string)!;
      const previous = generation;
      if (!options.pending) {
        if (options.invalid)
          received.port.postMessage({
            type: 'error',
            request: received.request.request,
            generation,
            code: 'invalid',
            error: 'rejected by validator',
          });
        else {
          const id =
            'asset-' + createHash('sha256').update(new Uint8Array(received.request.files[0]!.buffer)).digest('hex');
          const asset = { ...metadata, id };
          stored.set(id, asset);
          if (attempts <= (options.restarts ?? 0)) generation = 'worker-' + attempts;
          else
            received.port.postMessage({ type: 'done', request: received.request.request, generation, assets: [asset] });
        }
      }
      return { generation: previous, accepted: true } as T;
    },
  });
  return {
    upload,
    buffers,
    stored,
    reads: () => reads,
    fallbacks: () => fallbacks,
    attempts: () => attempts,
    close: () => serverPorts.forEach((port) => port.close()),
  };
}

test('a lost saved reply rereads the same File, detaches each new buffer and remains idempotent', async () => {
  const h = uploaderHarness({ restarts: 2 });
  try {
    const result = await h.upload(
      [new File(['original'], 'test.png', { type: 'image/png' })],
      session,
      new AbortController().signal,
      5,
    );
    expect(h.reads()).toBe(3);
    expect(h.attempts()).toBe(3);
    expect(h.stored.size).toBe(1);
    expect(h.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(result[0]!.id).toBe([...h.stored.keys()][0]);
    expect(h.fallbacks()).toBe(0);
  } finally {
    h.close();
  }
});

test('restarts stop after three attempts instead of retrying forever or hiding failure in fallback', async () => {
  const h = uploaderHarness({ restarts: 10 });
  try {
    await expect(
      h.upload([new File(['original'], 'test.png')], session, new AbortController().signal, 5),
    ).rejects.toThrow(/繰り返し再起動/);
    expect(h.reads()).toBe(3);
    expect(h.attempts()).toBe(3);
    expect(h.fallbacks()).toBe(0);
  } finally {
    h.close();
  }
});

for (const option of [{ unavailable: true }, { postError: true }, { silent: true }])
  test(`unsupported binary transport retains the legacy importer ${JSON.stringify(option)}`, async () => {
    const h = uploaderHarness(option);
    try {
      expect(await h.upload([new File(['source'], 'test.png')], session, new AbortController().signal, 5)).toEqual([
        metadata,
      ]);
      expect(h.fallbacks()).toBe(1);
    } finally {
      h.close();
    }
  });

test('worker validation failure never triggers another attempt or the legacy fallback', async () => {
  const h = uploaderHarness({ invalid: true });
  try {
    await expect(h.upload([new File(['bad'], 'test.png')], session, new AbortController().signal, 5)).rejects.toThrow(
      /validator/,
    );
    expect(h.attempts()).toBe(1);
    expect(h.fallbacks()).toBe(0);
  } finally {
    h.close();
  }
});

test('abort drops an in-flight transfer without rereading the File or falling back', async () => {
  const h = uploaderHarness({ pending: true }),
    controller = new AbortController();
  try {
    const result = h.upload([new File(['source'], 'test.png')], session, controller.signal, 5);
    const rejected = expect(result).rejects.toThrow();
    await expect.poll(h.attempts).toBe(1);
    controller.abort();
    await rejected;
    expect(h.reads()).toBe(1);
    expect(h.fallbacks()).toBe(0);
  } finally {
    h.close();
  }
});
