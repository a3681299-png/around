import { installAssetReadAdapter } from '../assets/read-adapter';
import {
  ASSET_READ_CONFIRM,
  ASSET_READ_FRAME,
  ASSET_READ_MESSAGE,
  ASSET_READ_PORT,
  ASSET_READ_TTL_MS,
  AssetReadError,
  type AssetReadReply,
  type AssetReadSource,
} from '../assets/read-protocol';
import { ASSET_LIMITS } from '../assets/limits';
import { ASSET_PROFILE, assetProfile, profileEnd } from '../diagnostics/asset-profile';

/** The hidden frame is storage only, outside the renderer and all fullscreen containers. */
export function createAssetReadHost(doc: Document) {
  const origin = chrome.runtime.getURL('').replace(/\/$/, '');
  let frame: HTMLIFrameElement | undefined,
    loading: Promise<HTMLIFrameElement> | undefined,
    destroyed = false;
  const active = new Set<(reason: unknown) => void>();
  const pending = new Map<string, { id: string; token: string }>();
  async function worker<T>(action: string, values: Record<string, unknown>): Promise<T> {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: ASSET_READ_MESSAGE, action, ...values });
    } catch {
      throw new AssetReadError('restart', '素材の取得許可を再確認します。');
    }
    if (!response?.ok)
      throw new AssetReadError(response?.code ?? 'restart', response?.error ?? '素材取得を再承認してください。');
    return response.value as T;
  }
  function reset(reason: unknown) {
    active.forEach((reject) => reject(reason));
    frame?.remove();
    frame = undefined;
    loading = undefined;
  }
  function ready() {
    if (destroyed) return Promise.reject(new DOMException('表示を終了しました。', 'AbortError'));
    if (frame?.isConnected && loading) return loading;
    if (frame) reset(new AssetReadError('unavailable', '素材取得のiframeが切断されました。'));
    const next = doc.createElement('iframe');
    frame = next;
    next.hidden = true;
    next.tabIndex = -1;
    next.setAttribute('aria-hidden', 'true');
    next.dataset.aroundAssetReader = '';
    next.src = chrome.runtime.getURL(ASSET_READ_FRAME);
    loading = new Promise<HTMLIFrameElement>((resolve, reject) => {
      let loaded = false;
      const fail = () => {
        clearTimeout(timer);
        reject(new AssetReadError('unavailable', '素材取得のiframeを利用できません。'));
      };
      const timer = setTimeout(fail, 2000);
      next.addEventListener('error', fail, { once: true });
      next.addEventListener('load', () => {
        clearTimeout(timer);
        if (loaded) {
          reset(new AssetReadError('restart', '素材取得のiframeが再読み込みされました。'));
          return;
        }
        loaded = true;
        if (next !== frame) {
          fail();
          return;
        }
        resolve(next);
      });
      // Never reparent this frame for fullscreen or SPA layout changes.
      doc.documentElement.append(next);
    });
    return loading;
  }
  function confirm(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== ASSET_READ_CONFIRM
    )
      return false;
    const proof = message as Record<string, unknown>,
      value = pending.get(String(proof['challenge']));
    respond({ allowed: Boolean(value && value.id === proof['id'] && value.token === proof['token']) });
    return false;
  }
  chrome.runtime.onMessage.addListener(confirm);
  const pagehide = () => reset(new DOMException('文書の表示を終了しました。', 'AbortError'));
  doc.defaultView!.addEventListener('pagehide', pagehide);
  async function attempt(id: string, signal: AbortSignal): Promise<AssetReadSource> {
    signal.throwIfAborted();
    const target = await ready();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let channel: MessageChannel;
      try {
        channel = new MessageChannel();
      } catch {
        reject(new AssetReadError('unavailable', '素材のバイナリ転送を利用できません。'));
        return;
      }
      let settled = false;
      let binding: { challenge: string; generation: string } | undefined;
      const revoke = () => {
        if (binding) void worker('cancel', binding).catch(() => undefined);
      };
      function finish(error?: unknown, value?: AssetReadSource) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        active.delete(fail);
        if (binding) pending.delete(binding.challenge);
        if (error) {
          revoke();
          try {
            channel.port1.postMessage({ type: 'cancel' });
          } catch {
            /* Detached/closed ports need no reply. */
          }
        }
        channel.port1.close();
        channel.port2.close();
        if (error) reject(error);
        else resolve(value!);
      }
      const fail = (reason: unknown) => finish(reason),
        abort = () => finish(signal.reason);
      active.add(fail);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => finish(new AssetReadError('unavailable', '素材の取得が時間内に完了しませんでした。')),
        ASSET_READ_TTL_MS,
      );
      channel.port1.onmessageerror = () => finish(new AssetReadError('unavailable', '素材の通信が切断されました。'));
      channel.port1.onmessage = (event: MessageEvent<AssetReadReply>) => {
        if (settled) return;
        const message = event.data;
        if (
          message?.type === 'challenge' &&
          !binding &&
          typeof message.challenge === 'string' &&
          typeof message.generation === 'string'
        ) {
          binding = { challenge: message.challenge, generation: message.generation };
          void worker<{ token: string }>('authorize', { ...binding, id })
            .then((authorization) => {
              if (settled) {
                revoke();
                return;
              }
              pending.set(binding!.challenge, { id, token: authorization.token });
              channel.port1.postMessage({ type: 'read', token: authorization.token });
            })
            .catch(fail);
        } else if (message?.type === 'error') finish(new AssetReadError(message.code, message.error));
        else if (message?.type === 'source') {
          const source = message.source;
          if (
            !binding ||
            !pending.has(binding.challenge) ||
            !(source?.buffer instanceof ArrayBuffer) ||
            source.metadata?.id !== id ||
            source.buffer.byteLength !== source.metadata.byteLength ||
            !source.buffer.byteLength ||
            source.buffer.byteLength > ASSET_LIMITS.modelBytes
          )
            finish(new AssetReadError('denied', '取得した素材が不正です。'));
          else finish(undefined, source);
        }
      };
      channel.port1.start();
      try {
        target.contentWindow!.postMessage({ type: ASSET_READ_PORT }, origin, [channel.port2]);
      } catch {
        finish(new AssetReadError('unavailable', '素材のバイナリ転送を利用できません。'));
      }
    });
  }
  const uninstall = installAssetReadAdapter(async (id, signal) => {
    if (typeof MessageChannel !== 'function') return undefined;
    for (let count = 0; count < 2; count++) {
      try {
        return await attempt(id, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof AssetReadError) || error.code === 'denied') throw error;
        if (error.code === 'restart' && count === 0) {
          profileEnd(assetProfile(id), 'download.reauthorize', ASSET_PROFILE ? performance.now() : 0, { count: 1 });
          continue;
        }
        reset(error);
        return undefined;
      }
    }
    return undefined;
  });
  return {
    destroy() {
      destroyed = true;
      uninstall();
      reset(new DOMException('素材の取得を終了しました。', 'AbortError'));
      chrome.runtime.onMessage.removeListener(confirm);
      doc.defaultView!.removeEventListener('pagehide', pagehide);
    },
  };
}
