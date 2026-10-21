import { importAssets, readImportFile, releaseAssets } from './client';
import { ASSET_MESSAGE } from './protocol';
import { validateImportBatchSizes } from './import-validation';
import { isAssetId } from '../design/schema';
import { ASSET_LIMITS } from './limits';
import {
  ASSET_PROFILE,
  newAssetProfile,
  profileEnd,
  linkAssetProfile,
  flushAssetProfile,
} from '../diagnostics/asset-profile';
import {
  STUDIO_ASSET_TRANSFER,
  STUDIO_TRANSFER_AUTHORIZE,
  STUDIO_TRANSFER_CONFIRM,
  STUDIO_TRANSFER_STATUS,
  STUDIO_TRANSFER_ATTEMPTS,
  STUDIO_TRANSFER_TIMEOUT_MS,
  type StudioTransferGrant,
  type StudioTransferFile,
  type StudioTransferReply,
  type StudioTransferRequest,
} from './studio-transfer-protocol';
import type { AssetMetadata } from './validation';

class WorkerRestarted extends Error {}
class TransferUnavailable extends Error {}
interface UploadPorts {
  worker(): Promise<Pick<ServiceWorker, 'postMessage'> | undefined>;
  rpc<T>(action: string, values: Record<string, unknown>): Promise<T>;
  read: typeof readImportFile;
  fallback: typeof importAssets;
  release?: typeof releaseAssets;
  channel(): MessageChannel;
  heartbeatMs?: number;
  timeoutMs?: number;
}
async function rpc<T>(action: string, values: Record<string, unknown>): Promise<T> {
  let response: { ok: boolean; value?: T; error?: string } | undefined;
  try {
    response = await chrome.runtime.sendMessage({ type: ASSET_MESSAGE, action, ...values });
  } catch {
    throw new WorkerRestarted();
  }
  if (!response) throw new WorkerRestarted();
  if (!response.ok) throw new Error(response.error ?? '素材の保存処理に接続できません。');
  return response.value as T;
}
const browserPorts: UploadPorts = {
  async worker() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker || typeof MessageChannel === 'undefined') return;
    try {
      return (await navigator.serviceWorker.getRegistration())?.active ?? undefined;
    } catch {
      return;
    }
  },
  rpc,
  read: readImportFile,
  fallback: importAssets,
  release: releaseAssets,
  channel: () => new MessageChannel(),
};

/** File references remain owned here until the authoritative saved reply, including bounded restarts. */
export function createStudioUploader(ports: UploadPorts = browserPorts) {
  return async (
    files: readonly File[],
    session: string,
    signal: AbortSignal,
    ownerTabId: number,
  ): Promise<AssetMetadata[]> => {
    validateImportBatchSizes(files.map((file) => file.size));
    const trace = newAssetProfile(),
      values = { session, ownerTabId };
    const fallback = async () => {
      signal.throwIfAborted();
      const start = ASSET_PROFILE ? performance.now() : 0;
      try {
        // Revoke any binary permit before the legacy transport can replace it.
        await ports.release?.(session);
        signal.throwIfAborted();
        const assets = await ports.fallback(files, session, signal, ownerTabId);
        for (const asset of assets) linkAssetProfile(asset.id, trace);
        return assets;
      } finally {
        profileEnd(
          trace,
          files.some((file) => file.size > ASSET_LIMITS.fileBytes)
            ? 'studio.upload.chunk-fallback'
            : 'studio.upload.json-fallback',
          start,
          { count: 1 },
        );
        if (ASSET_PROFILE) await flushAssetProfile();
      }
    };
    for (let attempt = 1; attempt <= STUDIO_TRANSFER_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      const worker = await ports.worker();
      signal.throwIfAborted();
      if (!worker) return fallback();
      const started = ASSET_PROFILE ? performance.now() : 0;
      try {
        const prepared: StudioTransferFile[] = [];
        for (const file of files) {
          // A detached buffer is never reused; each attempt rereads the immutable File.
          const { name, bytes } = await ports.read(file, signal, trace);
          prepared.push({ name, mime: file.type, buffer: bytes.buffer as ArrayBuffer });
        }
        signal.throwIfAborted();
        const grant = await ports.rpc<StudioTransferGrant>(STUDIO_TRANSFER_AUTHORIZE, {
          ...values,
          sizes: files.map((file) => file.size),
        });
        signal.throwIfAborted();
        const request: StudioTransferRequest = {
          type: STUDIO_ASSET_TRANSFER,
          ...grant,
          session,
          request: crypto.randomUUID(),
          files: prepared,
          ...(trace ? { profile: trace } : {}),
        };
        const assets = await new Promise<AssetMetadata[]>((resolve, reject) => {
          let channel: MessageChannel;
          try {
            channel = ports.channel();
          } catch {
            throw new TransferUnavailable();
          }
          let finished = false,
            challenged = false,
            generation = grant.generation,
            heartbeat: ReturnType<typeof setTimeout> | undefined;
          const finish = (error?: unknown, assets?: AssetMetadata[]) => {
            if (finished) return;
            finished = true;
            clearTimeout(deadline);
            clearTimeout(heartbeat);
            signal.removeEventListener('abort', abort);
            channel.port1.close();
            channel.port2.close();
            if (error) reject(error);
            else resolve(assets!);
          };
          const abort = () => finish(signal.reason);
          const deadline = setTimeout(
            () =>
              finish(
                challenged
                  ? new Error('素材転送の応答がありません。もう一度追加してください。')
                  : new TransferUnavailable(),
              ),
            ports.timeoutMs ?? STUDIO_TRANSFER_TIMEOUT_MS,
          );
          const check = async () => {
            if (finished) return;
            try {
              const status = await ports.rpc<{ generation: string; active: boolean }>(STUDIO_TRANSFER_STATUS, {
                ...values,
                token: grant.token,
              });
              if (finished) return;
              if (status.generation !== generation) return finish(new WorkerRestarted());
              if (!status.active) return finish(new Error('素材転送の許可が失効しました。'));
            } catch {
              /* A transient Runtime failure is bounded by the deadline. */
            }
            if (!finished)
              heartbeat = setTimeout(() => {
                void check();
              }, ports.heartbeatMs ?? 1000);
          };
          channel.port1.onmessage = (event: MessageEvent<StudioTransferReply>) => {
            const message = event.data;
            if (!message || message.request !== request.request || finished) return;
            if (message.type === 'challenge') {
              challenged = true;
              generation = message.generation;
              void ports
                .rpc<{ generation: string; accepted: boolean }>(STUDIO_TRANSFER_CONFIRM, {
                  ...values,
                  token: grant.token,
                  request: request.request,
                  challenge: message.challenge,
                })
                .then(
                  (result) => {
                    if (result.generation !== generation) finish(new WorkerRestarted());
                    else if (!result.accepted) finish(new Error('素材転送の確認が失効しました。'));
                  },
                  (reason: unknown) => {
                    if (!finished) {
                      if (reason instanceof WorkerRestarted) void check();
                      else finish(reason);
                    }
                  },
                );
            } else if (message.type === 'done') {
              if (
                !Array.isArray(message.assets) ||
                message.assets.length !== files.length ||
                !message.assets.every((asset) => asset && isAssetId(asset.id))
              )
                finish(new Error('素材転送の応答が不正です。'));
              else finish(undefined, message.assets);
            } else if (message.type === 'error')
              finish(message.code === 'restart' ? new WorkerRestarted() : new Error(message.error));
          };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) return abort();
          try {
            worker.postMessage(request, [...prepared.map((file) => file.buffer), channel.port2]);
          } catch {
            return finish(new TransferUnavailable());
          }
          heartbeat = setTimeout(() => {
            void check();
          }, ports.heartbeatMs ?? 1000);
        });
        signal.throwIfAborted();
        for (const asset of assets) linkAssetProfile(asset.id, trace);
        profileEnd(trace, 'studio.upload.array-buffer', started, {
          bytes: files.reduce((n, file) => n + file.size, 0),
          count: attempt,
        });
        if (ASSET_PROFILE) await flushAssetProfile();
        return assets;
      } catch (reason) {
        signal.throwIfAborted();
        if (reason instanceof TransferUnavailable) return fallback();
        if (!(reason instanceof WorkerRestarted)) throw reason;
        profileEnd(trace, 'studio.upload.retry', started, { count: attempt });
        if (attempt === STUDIO_TRANSFER_ATTEMPTS)
          throw new Error('Workerが繰り返し再起動したため取り込みを中止しました。もう一度追加してください。');
      }
    }
    throw new Error('素材を取り込めませんでした。');
  };
}
export const importStudioAssets = createStudioUploader();
