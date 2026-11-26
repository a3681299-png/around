import { test, expect } from '@playwright/test';
import { createStudioClient } from '../src/browser/studio-client';
import { createEditorSession } from '../src/editor-core/session';
import type { EditorCheckpoint } from '../src/editor-core/types';
import { createStudioStateEncoder } from '../src/studio/state-sync';
import type { StudioMessage, StudioRequest } from '../src/studio/protocol';
import type { StudioConnectionState } from '../src/studio/connection';

const originalChrome = globalThis.chrome;
test.afterEach(() => {
  if (originalChrome) globalThis.chrome = originalChrome;
  else Reflect.deleteProperty(globalThis, 'chrome');
});

function fakePort() {
  const messages = new Set<(message: StudioMessage) => void>(),
    disconnects = new Set<() => void>();
  const requests: StudioRequest[] = [];
  let disconnected = false;
  const port = {
    onMessage: { addListener: (listener: (message: StudioMessage) => void) => messages.add(listener) },
    onDisconnect: { addListener: (listener: () => void) => disconnects.add(listener) },
    postMessage(request: StudioRequest) {
      if (disconnected) throw new Error('disconnected port');
      requests.push(request);
    },
    disconnect() {
      // Chrome does not dispatch onDisconnect on the initiating end of a port.
      disconnected = true;
    },
  } as unknown as chrome.runtime.Port;
  return {
    port,
    requests,
    disconnected: () => disconnected,
    send(message: StudioMessage) {
      const wire = JSON.parse(JSON.stringify(message)) as StudioMessage;
      messages.forEach((listener) => listener(wire));
    },
    remoteDisconnect: () => disconnects.forEach((listener) => listener()),
  };
}

test('Studio retries an attach made before the first settings result and connects when settings arrive', async () => {
  let serial = 0;
  const editor = createEditorSession({
    siteId: 'youtube',
    baseThemeId: 'retro',
    targets: [],
    makeId: () => `session-${++serial}`,
    validate() {},
    geometry: {
      frameFor: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
      samples: () => [],
      importFrame: () => ({ width: 1920, height: 1080, origin: { x: 960, y: 540 } }),
    },
    storage: {
      read: async () => undefined,
      watch(accept) {
        accept(undefined);
        return () => {};
      },
      retain: async () => {},
      release: async () => {},
      validate: async () => {},
      save: async () => {},
      import: async () => [],
      cancelImport() {},
    },
  });
  const ports: ReturnType<typeof fakePort>[] = [];
  globalThis.chrome = {
    tabs: {
      connect() {
        const next = fakePort();
        ports.push(next);
        return next.port;
      },
      onRemoved: { addListener() {}, removeListener() {} },
    },
  } as unknown as typeof chrome;
  const updates: StudioConnectionState[] = [];
  const client = createStudioClient(
    (value) => updates.push(value),
    () => {},
  );
  try {
    // The host port is installed before watchSettings delivers its initial async read.
    const initial = client.select(12);
    const first = ports[0]!;
    const opening = editor.open();
    expect(opening.ok).toBe(false);
    first.send({ type: 'reply', id: first.requests[0]!.id, ok: false, error: opening.error! });
    await initial;
    expect(client.isConnected).toBe(false);
    editor.setEnabled(true);
    await expect.poll(() => ports.length).toBe(2);
    expect(editor.open().ok).toBe(true);
    const next = ports[1]!;
    next.send({
      type: 'reply',
      id: next.requests[0]!.id,
      ok: true,
      ...createStudioStateEncoder().encode(editor.snapshot(), editor.checkpoint()),
    });
    await expect.poll(() => client.isConnected).toBe(true);
    expect(client.state).toMatchObject({ enabled: true, active: true });
    expect(updates.at(-1)).toMatchObject({ connected: true, message: '接続中' });
    editor.setEnabled(false);
    next.send({ type: 'state', ...createStudioStateEncoder().encode(editor.snapshot(), editor.checkpoint()) });
    await expect
      .poll(() => updates.at(-1)?.message)
      .toBe('「作品を表示する」がOFFです。ONにしてから接続してください。');
    expect(editor.open()).toMatchObject({ ok: false, error: /「作品を表示する」がOFF/ });
    expect(editor.snapshot().active).toBe(false);
  } finally {
    client.destroy();
    editor.destroy();
  }
});

for (const fault of ['missing', 'duplicate'] as const)
  test(`Studio rejects pending requests on a ${fault} delta and reconnects with a complete current base`, async () => {
    let serial = 0;
    const editor = createEditorSession({
      siteId: 'youtube',
      baseThemeId: 'retro',
      targets: [{ id: 'video-card', surface: 'video-card', label: '動画カード' }],
      makeId: () => `session-${++serial}`,
      validate() {},
      geometry: {
        frameFor: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
        samples: () => [],
        importFrame: () => ({ width: 1920, height: 1080, origin: { x: 960, y: 540 } }),
      },
      storage: {
        read: async () => undefined,
        watch(accept) {
          accept(undefined);
          return () => {};
        },
        retain: async () => {},
        release: async () => {},
        validate: async () => {},
        save: async () => {},
        import: async () => [],
        cancelImport() {},
      },
    });
    editor.setEnabled(true);
    expect(editor.open().ok).toBe(true);
    const ports: ReturnType<typeof fakePort>[] = [];
    globalThis.chrome = {
      tabs: {
        connect() {
          const next = fakePort();
          ports.push(next);
          return next.port;
        },
        onRemoved: { addListener() {}, removeListener() {} },
      },
    } as unknown as typeof chrome;
    const updates: StudioConnectionState[] = [],
      checkpoints: (EditorCheckpoint | undefined)[] = [];
    const client = createStudioClient(
      (value) => updates.push(value),
      (_target, checkpoint) => checkpoints.push(checkpoint),
    );
    try {
      const initial = client.select(12),
        first = ports[0]!,
        encoder = createStudioStateEncoder();
      first.send({
        type: 'reply',
        id: first.requests[0]!.id,
        ok: true,
        ...encoder.encode(editor.snapshot(), editor.checkpoint()),
      });
      await initial;
      expect(client.isConnected).toBe(true);
      await editor.execute({ type: 'snap', value: true });
      const earlier = { type: 'state' as const, ...encoder.encode(editor.snapshot(), editor.checkpoint()) };
      if (fault === 'duplicate') first.send(earlier);
      await editor.execute({ type: 'tool', tool: 'browse' });
      const later = { type: 'state' as const, ...encoder.encode(editor.snapshot(), editor.checkpoint()) };
      const before = client.state,
        thumbnails = [client.thumbnail('image-a'), client.thumbnail('image-b')];
      let settled = 0;
      thumbnails.forEach((request) => {
        void request.then(() => settled++);
      });

      first.send(fault === 'missing' ? later : earlier);
      expect(first.disconnected()).toBe(true);
      expect(client.isConnected).toBe(false);
      expect(client.state).toBe(before);
      expect(updates.at(-1)).toMatchObject({ connected: false, message: /再接続/ });
      expect(client.timeline!.snapshot().status).toMatchObject({ available: false, mode: 'paused' });
      // Rejection settles in microtasks, without the 30-second request timer or retry firing.
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(2);
      expect(await Promise.all(thumbnails)).toEqual([undefined, undefined]);

      // The document can keep changing while Studio is disconnected.
      await editor.execute({ type: 'select-target', target: 'video-card' });
      await editor.execute({ type: 'style', style: { backgroundColor: '#123456' } });
      await expect.poll(() => ports.length).toBe(2);
      const next = ports[1]!,
        attach = next.requests[0]!,
        base = createStudioStateEncoder().encode(editor.snapshot(), editor.checkpoint());
      expect(attach).toMatchObject({ type: 'attach', resume: { version: 2 } });
      expect(base).toMatchObject({ sequence: 1, state: editor.snapshot() });
      expect(base.delta).toBeUndefined();
      next.send({ type: 'reply', id: attach.id, ok: true, ...base });
      await Promise.resolve();
      expect(client.isConnected).toBe(true);
      expect(client.state).toEqual(editor.snapshot());
      expect(checkpoints.at(-1)).toEqual(editor.checkpoint());
      expect(updates.at(-1)).toMatchObject({ connected: true, message: '接続中' });
      // A late event from the old port must not tear down the new connection.
      first.remoteDisconnect();
      expect(client.isConnected).toBe(true);
    } finally {
      client.destroy();
      editor.destroy();
    }
  });
