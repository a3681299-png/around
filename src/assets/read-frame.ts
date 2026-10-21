import { getAsset } from './repository';
import { ASSET_LIMITS } from './limits';
import {
  ASSET_READ_MESSAGE,
  ASSET_READ_PORT,
  ASSET_READ_TTL_MS,
  AssetReadError,
  type AssetReadReply,
} from './read-protocol';

async function worker<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: ASSET_READ_MESSAGE, action, ...values });
  } catch {
    throw new AssetReadError('restart', '素材取得のWorkerが停止しました。');
  }
  if (!reply?.ok) throw new AssetReadError(reply?.code ?? 'restart', reply?.error ?? '素材取得を再承認してください。');
  return reply.value as T;
}
const channels = new Map<MessagePort, () => void>();
// The window message is a non-secret, unprivileged port hand-off only. No asset
// IDs, capabilities, replies or binary data are ever sent on window messages.
window.addEventListener('message', (event: MessageEvent) => {
  if (
    event.source !== parent ||
    event.origin !== 'https://www.youtube.com' ||
    event.data?.type !== ASSET_READ_PORT ||
    event.ports.length !== 1
  )
    return;
  const port = event.ports[0]!;
  if (channels.size >= 8) {
    port.close();
    return;
  }
  channels.set(port, close);
  let alive = true,
    reading = false;
  let binding: { challenge: string; generation: string } | undefined;
  function close() {
    if (!alive) return;
    alive = false;
    clearTimeout(timer);
    channels.delete(port);
    port.close();
    if (binding) void worker('close', binding).catch(() => undefined);
  }
  function error(reason: unknown) {
    if (alive) {
      const value: AssetReadReply = {
        type: 'error',
        code: reason instanceof AssetReadError ? reason.code : 'unavailable',
        error: reason instanceof Error ? reason.message : '素材を取得できませんでした。',
      };
      try {
        port.postMessage(value);
      } finally {
        close();
      }
    }
  }
  const timer = setTimeout(close, ASSET_READ_TTL_MS);
  port.onmessageerror = () => close();
  port.onmessage = (event: MessageEvent) => {
    const message = event.data;
    if (message?.type === 'cancel') {
      close();
      return;
    }
    if (!alive || !binding || reading || message?.type !== 'read' || typeof message.token !== 'string') return;
    reading = true;
    void (async () => {
      const proof = { ...binding!, token: message.token },
        { id } = await worker<{ id: string }>('consume', proof),
        row = await getAsset(id);
      if (!alive) return;
      if (
        !row ||
        row.id !== id ||
        row.blob.size !== row.byteLength ||
        row.blob.size <= 0 ||
        row.blob.size > ASSET_LIMITS.modelBytes
      )
        throw new Error('保存済み素材が不正です。');
      const buffer = await row.blob.arrayBuffer();
      if (!alive) return;
      await worker('deliver', proof);
      if (!alive) return;
      const { blob: _blob, leases: _leases, ...metadata } = row;
      const reply: AssetReadReply = { type: 'source', source: { metadata, buffer } };
      port.postMessage(reply, [buffer]);
      close();
    })().catch(error);
  };
  port.start();
  void worker<{ challenge: string; generation: string }>('open')
    .then((value) => {
      binding = value;
      if (!alive) {
        void worker('close', value).catch(() => undefined);
        return;
      }
      port.postMessage({ type: 'challenge', ...value } satisfies AssetReadReply);
    })
    .catch(error);
});
window.addEventListener('pagehide', () => {
  channels.forEach((close) => close());
});
