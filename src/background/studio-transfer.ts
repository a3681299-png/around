import { ASSET_LIMITS } from '../assets/limits';
import { validateImportBatchSizes } from '../assets/import-validation';
import {
  STUDIO_ASSET_TRANSFER,
  STUDIO_TRANSFER_TIMEOUT_MS,
  type StudioTransferGrant,
  type StudioTransferReply,
} from '../assets/studio-transfer-protocol';
import type { AssetLease } from '../assets/repository';
import type { AssetMetadata } from '../assets/validation';
import { validProfile } from '../diagnostics/asset-profile';

interface ClientSource {
  id: string;
  url: string;
  frameType: string;
}
export interface StudioTransferEvent {
  data: unknown;
  source: unknown;
  ports: readonly MessagePort[];
  waitUntil(task: Promise<unknown>): void;
}
interface Grant {
  token: string;
  lease: AssetLease;
  sender: chrome.runtime.MessageSender;
  ownerTabId: number;
  sizes: number[];
  expires: number;
}
interface Pending {
  id: string;
  grant: Grant;
  challenge: string;
  reply: MessagePort;
  files: Record<string, unknown>[];
  bytes: number;
  claimed: boolean;
  finished: boolean;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
  trace: string | undefined;
}
interface Ports {
  now?: () => number;
  studioURL: string;
  extensionId: string;
  sidePanelDocument(url: string): Promise<string | undefined>;
  client(id: string): Promise<ClientSource | undefined>;
  owner(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<AssetLease>;
  enqueue<T>(action: () => Promise<T>): Promise<T>;
  importBatch(
    input: unknown,
    lease: AssetLease,
    decoded: readonly Uint8Array[],
    trace?: string,
  ): Promise<AssetMetadata[]>;
}

/** Binary bytes are admitted only after a Runtime-authenticated document confirms its private port challenge. */
export function createStudioTransferService(ports: Ports) {
  const now = ports.now ?? Date.now;
  const generation = crypto.randomUUID(),
    grants = new Map<string, Grant>(),
    pending = new Map<string, Pending>();
  let bytesHeld = 0;
  const post = (reply: MessagePort, value: StudioTransferReply) => {
    try {
      reply.postMessage(value);
    } catch {
      /* A lost reply is recovered from the original File. */
    }
  };
  const finish = (entry: Pending, value: StudioTransferReply) => {
    if (entry.finished) return;
    entry.finished = true;
    clearTimeout(entry.timer);
    pending.delete(entry.id);
    bytesHeld -= entry.bytes;
    entry.files = [];
    post(entry.reply, value);
    entry.reply.close();
    entry.resolve();
  };
  const failure = (
    request: string,
    code: Extract<StudioTransferReply, { type: 'error' }>['code'],
    error: string,
  ): StudioTransferReply => ({ type: 'error', request, generation, code, error });
  const revoke = (session: string) => {
    for (const [token, grant] of grants)
      if (grant.lease.session === session) {
        grants.delete(token);
        for (const entry of pending.values())
          if (entry.grant === grant) finish(entry, failure(entry.id, 'cancelled', '素材の取り込みを中止しました。'));
      }
  };
  const authenticate = async (message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => {
    if (
      sender.id !== ports.extensionId ||
      sender.url?.split('?')[0] !== ports.studioURL ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      !Number.isSafeInteger(message['ownerTabId']) ||
      typeof message['session'] !== 'string' ||
      !message['session'].startsWith('studio-upload-')
    )
      throw new Error('エディター以外からの素材転送は受け付けません。');
    let source = sender;
    if (!sender.documentId || sender.frameId === undefined) {
      // Chrome omits frameId/documentId on native side-panel Runtime messages.
      // Resolve the live Chrome-owned context, then run owner() with its document ID.
      if (new URL(sender.url!).searchParams.get('surface') !== 'sidepanel')
        throw new Error('エディターの送信元ドキュメントを確認できません。');
      const documentId = await ports.sidePanelDocument(sender.url!);
      if (!documentId || (sender.documentId && sender.documentId !== documentId))
        throw new Error('エディターの送信元ドキュメントを確認できません。');
      source = { ...sender, documentId, frameId: 0 };
    }
    return { lease: await ports.owner(message, source), sender: source };
  };
  const sameSender = (grant: Grant, sender: chrome.runtime.MessageSender, session: unknown) =>
    grant.lease.session === session && grant.sender.documentId === sender.documentId && grant.sender.url === sender.url;
  return {
    generation,
    revoke,
    async authorize(
      message: Record<string, unknown>,
      sender: chrome.runtime.MessageSender,
    ): Promise<StudioTransferGrant> {
      const { lease, sender: source } = await authenticate(message, sender),
        sizes = message['sizes'];
      if (
        !Array.isArray(sizes) ||
        sizes.length > ASSET_LIMITS.batchCount ||
        !sizes.every((size) => Number.isSafeInteger(size) && size > 0 && size <= ASSET_LIMITS.modelBytes)
      )
        throw new Error('素材の転送容量が不正です。');
      validateImportBatchSizes(sizes);
      for (const grant of grants.values()) if (grant.expires < now()) revoke(grant.lease.session);
      revoke(lease.session);
      if (grants.size >= 4) throw new Error('素材転送の容量予算を超えています。');
      const token = crypto.randomUUID();
      grants.set(token, {
        token,
        lease,
        sender: { ...source },
        ownerTabId: message['ownerTabId'] as number,
        sizes: [...sizes],
        expires: now() + 60000,
      });
      return { token, generation };
    },
    async status(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
      const { sender: source } = await authenticate(message, sender);
      const grant = typeof message['token'] === 'string' ? grants.get(message['token']) : undefined;
      return {
        generation,
        active: Boolean(grant && sameSender(grant, source, message['session']) && grant.expires >= now()),
      };
    },
    async confirm(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
      const { sender: source } = await authenticate(message, sender);
      const entry = typeof message['request'] === 'string' ? pending.get(message['request']) : undefined;
      if (!entry) return { generation, accepted: false };
      const grant = entry.grant;
      if (grant.expires < now()) {
        revoke(grant.lease.session);
        return { generation, accepted: false };
      }
      if (
        message['token'] !== grant.token ||
        message['challenge'] !== entry.challenge ||
        !sameSender(grant, source, message['session']) ||
        message['ownerTabId'] !== grant.ownerTabId
      )
        throw new Error('エディターの転送確認元が一致しません。');
      if (entry.claimed) return { generation, accepted: true };
      entry.claimed = true;
      void ports
        .enqueue(async () => {
          if (entry.finished || grants.get(grant.token) !== grant) return;
          if (grant.expires < now()) throw new Error('素材転送の許可が失効しました。');
          // A queued confirmation cannot revive a revoked lease or a departed document.
          const lease = await ports.owner({ session: grant.lease.session, ownerTabId: grant.ownerTabId }, source);
          if (entry.finished || grants.get(grant.token) !== grant) return;
          const files = entry.files;
          const assets = await ports.importBatch(
            files.map((file) => ({ name: file['name'], mime: file['mime'], base64: '' })),
            lease,
            files.map((file) => new Uint8Array(file['buffer'] as ArrayBuffer)),
            entry.trace,
          );
          finish(entry, { type: 'done', request: entry.id, generation, assets });
        })
        .catch((reason: unknown) =>
          finish(
            entry,
            failure(entry.id, 'invalid', reason instanceof Error ? reason.message : '素材を保存できません。'),
          ),
        );
      return { generation, accepted: true };
    },
    receive(event: StudioTransferEvent) {
      if (
        !event.data ||
        typeof event.data !== 'object' ||
        !('type' in event.data) ||
        event.data.type !== STUDIO_ASSET_TRANSFER
      )
        return;
      const data = event.data as Record<string, unknown>,
        reply = event.ports[0],
        source = event.source as Partial<ClientSource> | null;
      if (!reply) return;
      const request =
        typeof data['request'] === 'string' && /^[\w-]{1,100}$/.test(data['request']) ? data['request'] : '';
      const reject = (code: Extract<StudioTransferReply, { type: 'error' }>['code'], error: string) => {
        post(reply, failure(request, code, error));
        reply.close();
      };
      if (!source?.id || source.url?.split('?')[0] !== ports.studioURL || source.frameType !== 'top-level')
        return reject('unauthorized', 'エディター以外からの素材転送は受け付けません。');
      const grant = typeof data['token'] === 'string' ? grants.get(data['token']) : undefined;
      if (!grant)
        return reject(data['generation'] !== generation ? 'restart' : 'cancelled', '素材転送の許可が失効しました。');
      const files = data['files'];
      if (
        !request ||
        pending.has(request) ||
        data['session'] !== grant.lease.session ||
        data['generation'] !== generation ||
        grant.expires < now() ||
        !Array.isArray(files) ||
        files.length !== grant.sizes.length ||
        !files.every(
          (file, i) =>
            file &&
            typeof file === 'object' &&
            file.buffer instanceof ArrayBuffer &&
            file.buffer.byteLength === grant.sizes[i],
        )
      )
        return reject('invalid', '素材転送の形式・容量が不正です。');
      const bytes = grant.sizes.reduce((n, size) => n + size, 0);
      if (pending.size >= 4 || bytesHeld + bytes > ASSET_LIMITS.modelBytes * 2)
        return reject('busy', '素材転送の容量予算を超えています。');
      let resolve: () => void = () => {};
      const done = new Promise<void>((accept) => {
        resolve = accept;
      });
      const entry: Pending = {
        id: request,
        grant,
        challenge: crypto.randomUUID(),
        reply,
        files,
        bytes,
        claimed: false,
        finished: false,
        resolve,
        timer: setTimeout(
          () => finish(entry, failure(request, 'cancelled', '素材転送の確認がタイムアウトしました。')),
          STUDIO_TRANSFER_TIMEOUT_MS,
        ),
        trace: validProfile(data['profile']) ? data['profile'] : undefined,
      };
      pending.set(request, entry);
      bytesHeld += bytes;
      event.waitUntil(
        (async () => {
          const client = await ports.client(source.id!);
          if (!client || client.url !== grant.sender.url || client.frameType !== 'top-level')
            finish(entry, failure(request, 'unauthorized', 'エディターの転送元が一致しません。'));
          else if (!entry.finished && grants.get(grant.token) === grant)
            post(reply, { type: 'challenge', request, generation, challenge: entry.challenge });
          await done;
        })().catch((reason: unknown) => finish(entry, failure(request, 'unauthorized', String(reason)))),
      );
    },
  };
}
