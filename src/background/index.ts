import { installSidePanelHost } from '../browser/side-panel';
import { installEditorEntry } from '../browser/editor-entry';
import { ASSET_MESSAGE, type AssetWireFile } from '../assets/protocol';
import { changeAssets, getAsset, keepAssetLease, type AssetLease, type StoredAsset } from '../assets/repository';
import { ASSET_LIMITS, base64ToBytes, bytesToBase64, type AssetMetadata, type AssetInfo } from '../assets/validation';
import { validateAssetBytes } from '../assets/validate-bytes';
import { validateDocumentAssets } from '../assets/design-assets';
import { sameModelInfo } from '../models/types';
import { designAssetIds } from '../design/references';
import { isAssetId, isDesignId, parseDesign } from '../design/schema';
import { saveDesign } from '../browser/design-store';
import { installTakeStorage } from '../browser/take-repository';
import { createAssetTransfers } from '../assets/transfers';
import { createWorkQueue } from '../assets/work-queue';
import { createSourceCache } from '../assets/source-cache';
import { canReuseImportInspection, validateImportBatchSizes } from '../assets/import-validation';
import { createStudioTransferService, type StudioTransferEvent } from './studio-transfer';
import {
  STUDIO_TRANSFER_AUTHORIZE,
  STUDIO_TRANSFER_CONFIRM,
  STUDIO_TRANSFER_STATUS,
} from '../assets/studio-transfer-protocol';
import { ASSET_MESSAGES } from '../assets/limits';
import { installAssetRuntimeBroker } from '../diagnostics/asset-runtime-broker';
import { createAssetReadService } from './asset-read';
import { createBackupService, backupPageURL } from './backup';
import { ASSET_READ_CONFIRM, ASSET_READ_FRAME, ASSET_READ_MESSAGE, AssetReadError } from '../assets/read-protocol';
import {
  ASSET_PROFILE,
  PROFILE_MESSAGE,
  assetProfile,
  linkAssetProfile,
  validProfile,
  profileAsync,
  profileSync,
  profileEnd,
  profileSnapshot,
  profileIngest,
  profileClear,
} from '../diagnostics/asset-profile';

const transfers = createAssetTransfers();
// Development iframe probe only: a selected asset, one tab, one use, 60 seconds.
const profileGrants = new Map<string, { id: string; tab: number; expires: number }>();
const profileSessions = new Map<string, string>();

// Lease/release/save must not be dropped when a burst exceeds the read queue's cap.
const mutations = createWorkQueue(1, Infinity),
  reads = createWorkQueue(2);
const enqueue = <T>(action: () => Promise<T>) => mutations.run(action);
const assetRead = createAssetReadService({
  extensionId: chrome.runtime.id,
  frameURL: chrome.runtime.getURL(ASSET_READ_FRAME),
  async approved(id, host) {
    const row = await getAsset(id);
    if (!row) return false;
    if (row.leases.some((lease) => lease.tabId === host.tab && lease.documentId === host.document)) return true;
    const key = 'webWorldThemes.design.youtube',
      values = await chrome.storage.local.get(key);
    if (!values[key]) return false;
    try {
      return designAssetIds(parseDesign(values[key])).includes(id);
    } catch {
      return false;
    }
  },
  async confirm(host, proof) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        chrome.tabs
          .sendMessage(host.tab, { type: ASSET_READ_CONFIRM, ...proof }, { documentId: host.document, frameId: 0 })
          .then(
            (reply) => reply?.allowed === true,
            () => false,
          ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  },
});
chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (!input || typeof input !== 'object' || !('type' in input) || input.type !== ASSET_READ_MESSAGE) return false;
  void reads
    .run(() => assetRead.handle(input as Record<string, unknown>, sender))
    .then(
      (value) => respond({ ok: true, value }),
      (error: unknown) =>
        respond({
          ok: false,
          code: error instanceof AssetReadError ? error.code : 'unavailable',
          error: error instanceof Error ? error.message : '素材取得を利用できません。',
        }),
    );
  return true;
});
chrome.tabs.onRemoved.addListener((tab) => assetRead.revokeTab(tab));
const verified = new Map<string, AssetInfo>(); // Worker-lifetime receipts, populated only after full validation.
const sourceRows = createSourceCache({
  load: async (id: string) => {
    const row = await getAsset(id);
    if (!row) throw new Error('素材が見つかりません。');
    return row;
  },
  size: (row) => row.blob.size,
  now: () => performance.now(),
  maxBytes: 96 * 1024 * 1024,
  idleMs: 5000,
});

async function owner(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<AssetLease> {
  if (!isDesignId(message['session'])) throw new Error('編集セッションが不正です。');
  if (message['ownerTabId'] !== undefined) {
    const studioURL = chrome.runtime.getURL('studio/index.html');
    if (sender.url?.split('?')[0] !== studioURL || !Number.isSafeInteger(message['ownerTabId']))
      throw new Error('素材の保持先が不正です。');
    const sidePanel = new URL(sender.url!).searchParams.get('surface') === 'sidepanel';
    if (sidePanel) {
      if (new URL(sender.url!).searchParams.get('target') !== String(message['ownerTabId']))
        throw new Error('サイドパネルの保持先が不正です。');
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
        ...(sender.documentId ? { documentIds: [sender.documentId] } : {}),
      });
      const context = contexts.find((entry) => entry.documentUrl === sender.url);
      if (!context) throw new Error('サイドパネルが見つかりません。');
      await chrome.tabs.get(message['ownerTabId'] as number);
      return {
        session: message['session'],
        tabId: message['ownerTabId'] as number,
        documentId: 'studio:sidepanel:' + message['ownerTabId'],
      };
    }
    const contexts = await chrome.runtime.getContexts({
      tabIds: [message['ownerTabId'] as number],
      ...(sender.documentId ? { documentIds: [sender.documentId] } : {}),
    });
    const context = contexts.find(
      (entry) => entry.documentUrl === sender.url && entry.documentUrl?.split('?')[0] === studioURL,
    );
    if (!context) throw new Error('エディターのタブが見つかりません。');
    return { session: message['session'], tabId: context.tabId, documentId: 'studio:' + context.tabId };
  }
  return {
    session: message['session'],
    tabId: sender.tab?.id ?? -1,
    documentId: sender.documentId ?? sender.url ?? '',
  };
}

async function prune(current?: AssetLease): Promise<void> {
  const values = await chrome.storage.local.get(null);
  const references = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('webWorldThemes.design.')) continue;
    try {
      designAssetIds(parseDesign(value)).forEach((id) => references.add(id));
    } catch {
      return;
    } // A future document version may reference assets we cannot see.
  }
  const tabs = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  await changeAssets((rows) => {
    const put: StoredAsset[] = [],
      remove: string[] = [];
    for (const row of rows) {
      // Recovery shares a tab with the live page, but cannot supersede its document.
      const leases = row.leases.filter((lease) => keepAssetLease(lease, tabs, current));
      if (leases.length || references.has(row.id)) {
        if (leases.length !== row.leases.length) put.push({ ...row, leases });
      } else {
        remove.push(row.id);
        sourceRows.delete(row.id);
        verified.delete(row.id);
      }
    }
    return { value: undefined, put, remove };
  });
}

async function leaseAssets(lease: AssetLease, ids: readonly string[]): Promise<void> {
  await changeAssets((rows) => {
    if (ids.some((id) => !rows.some((row) => row.id === id)))
      throw new Error('素材が見つかりません。もう一度読み込んでください。');
    const put: StoredAsset[] = [];
    for (const row of rows) {
      const existing = row.leases.find((entry) => entry.session === lease.session),
        needed = ids.includes(row.id);
      if (
        (needed && existing?.tabId === lease.tabId && existing.documentId === lease.documentId) ||
        (!needed && !existing)
      )
        continue;
      put.push({
        ...row,
        leases: [...row.leases.filter((entry) => entry.session !== lease.session), ...(needed ? [lease] : [])],
      });
    }
    return { value: undefined, put };
  });
}

async function importBatch(
  input: unknown,
  lease: AssetLease,
  decoded?: Uint8Array | readonly Uint8Array[],
  trace?: string,
): Promise<AssetMetadata[]> {
  if (!Array.isArray(input) || !input.length || input.length > ASSET_LIMITS.batchCount)
    throw new Error(ASSET_MESSAGES.batchCount);
  const decodedFiles = decoded instanceof Uint8Array ? undefined : decoded;
  if (decodedFiles) {
    if (decodedFiles.length !== input.length) throw new Error('素材転送の個数が不正です。');
    validateImportBatchSizes(decodedFiles.map((bytes) => bytes.length));
  }
  const assets: StoredAsset[] = [];
  let size = 0;
  for (const [index, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') throw new Error('素材の形式が不正です。');
    const file = raw as AssetWireFile;
    if (
      typeof file.name !== 'string' ||
      !file.name.length ||
      file.name.length > 120 ||
      /[\u0000-\u001f]/.test(file.name) ||
      typeof file.mime !== 'string'
    )
      throw new Error('素材の形式が不正です。');
    const bytes = decodedFiles
      ? decodedFiles[index]!
      : decoded instanceof Uint8Array
        ? decoded
        : base64ToBytes(file.base64);
    size += bytes.length;
    if (size > (decoded ? ASSET_LIMITS.modelBytes : ASSET_LIMITS.fileBytes))
      throw new Error(ASSET_MESSAGES.transferSize(Boolean(decoded)));
    const hash = await profileAsync(
      trace,
      'store.hash',
      () => crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
      { bytes: bytes.length },
    );
    const id = `asset-${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const cached = verified.get(id);
    // A different MIME declaration still passes the original boundary check.
    const reusable = canReuseImportInspection(cached, file.mime);
    const { info, blob } = reusable
      ? profileSync(trace, 'store.verified-hit', () => ({
          info: structuredClone(cached),
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: cached.mime }),
        }))
      : await validateAssetBytes(bytes as Uint8Array<ArrayBuffer>, file.mime, trace);
    if (verified.size >= ASSET_LIMITS.count) verified.delete(verified.keys().next().value!);
    verified.set(id, structuredClone(info));
    assets.push({ ...info, id, name: file.name, byteLength: bytes.length, blob, leases: [lease] });
    linkAssetProfile(id, trace);
  }
  await profileAsync(trace, 'store.prune', () => prune(lease));
  await profileAsync(trace, 'store.idb-write-transaction', () =>
    changeAssets((rows) => {
      const combined = new Map(rows.map((row) => [row.id, row]));
      const put = new Map<string, StoredAsset>();
      for (const asset of assets) {
        const existing = combined.get(asset.id);
        let next = existing
          ? { ...existing, leases: [...existing.leases.filter((entry) => entry.session !== lease.session), lease] }
          : asset;
        if (existing?.model?.vrm && !existing.model.vrm.body && asset.model?.vrm?.body) {
          if (!sameModelInfo(existing.model, asset.model)) throw new Error('既存素材の情報が一致しません。');
          // The SHA and all other facts match. Add the newly measured body without replacing
          // the original record, its name, blob or other sessions' leases.
          next = {
            ...next,
            model: { ...existing.model, vrm: { ...existing.model.vrm, body: asset.model.vrm.body } },
          };
        }
        combined.set(asset.id, next);
        put.set(asset.id, next);
      }
      if (
        combined.size > ASSET_LIMITS.count ||
        [...combined.values()].reduce((sum, row) => sum + row.byteLength, 0) > ASSET_LIMITS.totalBytes
      ) {
        throw new Error(ASSET_MESSAGES.storage);
      }
      return { value: undefined, put: [...put.values()] };
    }),
  );
  // A read may already have cached the legacy row before this import measured it.
  for (const asset of assets) sourceRows.delete(asset.id);
  return assets.map(({ blob: _blob, leases: _leases, ...metadata }) => metadata);
}

const workerClients = (
  globalThis as unknown as {
    clients: { get(id: string): Promise<{ id: string; url: string; frameType: string } | undefined> };
  }
).clients;
const studioTransfer = createStudioTransferService({
  studioURL: chrome.runtime.getURL('studio/index.html'),
  extensionId: chrome.runtime.id,
  async sidePanelDocument(url) {
    const contexts = (
      await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] })
    ).filter((context) => context.documentUrl === url && context.frameId === 0);
    return contexts.length === 1 ? contexts[0]!.documentId : undefined;
  },
  client: (id) => workerClients.get(id),
  owner,
  enqueue,
  importBatch,
});
self.addEventListener('message', (event) => studioTransfer.receive(event as unknown as StudioTransferEvent));
const backups = createBackupService({
  pageURL: backupPageURL(),
  client: (id) => workerClients.get(id),
  enqueue,
  assetsChanged: (ids) => ids.forEach((id) => sourceRows.delete(id)),
});
self.addEventListener('message', (event) => backups.receive(event as unknown as StudioTransferEvent));

async function handle(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  trace?: string,
): Promise<unknown> {
  if (message['action'] === STUDIO_TRANSFER_AUTHORIZE) return studioTransfer.authorize(message, sender);
  if (message['action'] === STUDIO_TRANSFER_CONFIRM) return studioTransfer.confirm(message, sender);
  if (message['action'] === STUDIO_TRANSFER_STATUS) return studioTransfer.status(message, sender);
  if (message['action'] === 'get' || message['action'] === 'get-part' || message['action'] === 'get-metadata') {
    if (!isAssetId(message['id'])) throw new Error('素材IDが不正です。');
    const asset = await profileAsync(trace, 'store.idb-read-or-cached', () => sourceRows.get(message['id'] as string));
    if (!asset) throw new Error('素材が見つかりません。');
    const { blob, leases: _leases, ...metadata } = asset;
    if (message['action'] === 'get-metadata') return metadata;
    if (message['action'] === 'get-part') {
      const offset = message['offset'];
      if (
        typeof offset !== 'number' ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= blob.size ||
        offset % ASSET_LIMITS.chunkBytes
      )
        throw new Error('素材の転送位置が不正です。');
      const bytes = new Uint8Array(
        await profileAsync(
          trace,
          'download.blob-read',
          () => blob.slice(offset, offset + ASSET_LIMITS.chunkBytes).arrayBuffer(),
          { bytes: Math.min(ASSET_LIMITS.chunkBytes, blob.size - offset) },
        ),
      );
      return profileSync(trace, 'download.encode-base64', () => bytesToBase64(bytes), { bytes: bytes.length });
    }
    if (blob.size > ASSET_LIMITS.fileBytes) return { metadata, chunked: true };
    return { metadata, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
  }
  const lease = await profileAsync(trace, 'store.owner-check', () => owner(message, sender));
  const transferOwner = JSON.stringify([lease.session, lease.tabId, sender.documentId ?? sender.url]);
  if (message['action'] === 'upload-start')
    return transfers.start(
      crypto.randomUUID(),
      transferOwner,
      message['size'],
      message['name'],
      message['mime'],
      Date.now(),
    );
  if (message['action'] === 'upload-part') {
    if (typeof message['base64'] !== 'string' || message['base64'].length > Math.ceil(ASSET_LIMITS.chunkBytes / 3) * 4)
      throw new Error('素材の転送断片が大きすぎます。');
    const bytes = profileSync(trace, 'upload.decode-base64', () => base64ToBytes(message['base64']));
    profileSync(
      trace,
      'upload.reassemble',
      () => transfers.append(message['upload'], transferOwner, message['offset'], bytes, Date.now()),
      { bytes: bytes.length },
    );
    return undefined;
  }
  if (message['action'] === 'upload-abort') {
    transfers.abort(message['upload'], transferOwner, Date.now());
    return undefined;
  }
  if (message['action'] === 'upload-finish') {
    const file = transfers.finish(message['upload'], transferOwner, Date.now());
    return importBatch([{ name: file.name, mime: file.mime, base64: '' }], lease, file.bytes, trace);
  }
  if (message['action'] === 'import') return importBatch(message['files'], lease, undefined, trace);
  if (message['action'] === 'lease') {
    const ids = message['ids'];
    // Undo/redo can retain assets absent from the current 32-layer document.
    if (!Array.isArray(ids) || ids.length > ASSET_LIMITS.count || !ids.every(isAssetId))
      throw new Error('素材IDが不正です。');
    await profileAsync(trace, 'store.lease-rewrite', () => leaseAssets(lease, ids));
  } else if (message['action'] === 'release') {
    studioTransfer.revoke(lease.session);
    await profileAsync(trace, 'store.release-rewrite', () => leaseAssets(lease, []));
  } else if (message['action'] === 'save' || message['action'] === 'validate') {
    const design = parseDesign(message['design']);
    const assets = new Map<string, AssetMetadata>();
    for (const id of designAssetIds(design)) {
      const asset = await getAsset(id);
      if (asset) assets.set(id, asset);
    }
    validateDocumentAssets(design, assets);
    if (message['action'] === 'validate') return undefined;
    const revision = message['revision'];
    if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0))
      throw new Error('保存する編集の版が不正です。');
    await saveDesign(design, typeof revision === 'number' ? { sessionId: lease.session, revision } : undefined);
  } else throw new Error('未対応の素材操作です。');
  // Cleanup is secondary to a successful save; a failed cleanup retains assets.
  await profileAsync(trace, 'store.prune-after-command', () => prune(lease)).catch(() => undefined);
  return undefined;
}

chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (
    ASSET_PROFILE &&
    sender.id === chrome.runtime.id &&
    input &&
    typeof input === 'object' &&
    'type' in input &&
    input.type === PROFILE_MESSAGE
  ) {
    const message = input as Record<string, unknown>,
      extension = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (
      !extension &&
      !(sender.origin === 'https://www.youtube.com' && sender.frameId === 0 && message['action'] === 'ingest')
    )
      return false;
    if (
      extension &&
      message['action'] === 'grant' &&
      sender.frameId === 0 &&
      isAssetId(message['id']) &&
      Number.isSafeInteger(message['tab'])
    ) {
      profileGrants.forEach((grant, key) => {
        if (grant.expires < Date.now()) profileGrants.delete(key);
      });
      if (profileGrants.size >= 8) {
        respond({ error: 'probe grant limit' });
        return false;
      }
      const nonce = crypto.randomUUID();
      profileGrants.set(nonce, { id: message['id'], tab: message['tab'] as number, expires: Date.now() + 60000 });
      respond({ nonce });
      return false;
    }
    if (extension && message['action'] === 'claim') {
      const grant = typeof message['nonce'] === 'string' ? profileGrants.get(message['nonce']) : undefined;
      if (!grant || grant.expires < Date.now() || sender.tab?.id !== grant.tab || !sender.frameId) {
        respond({ error: 'invalid probe grant' });
        return false;
      }
      profileGrants.delete(message['nonce'] as string);
      respond({ id: grant.id });
      return false;
    }
    if (message['action'] === 'ingest') profileIngest(message['spans']);
    else if (extension && message['action'] === 'clear') {
      profileClear();
      profileSessions.clear();
    }
    respond({ spans: message['action'] === 'snapshot' && extension ? profileSnapshot() : [] });
    return false;
  }
  if (
    sender.id !== chrome.runtime.id ||
    !input ||
    typeof input !== 'object' ||
    !('type' in input) ||
    input.type !== ASSET_MESSAGE
  )
    return false;
  if (
    !sender.url?.startsWith(chrome.runtime.getURL('')) &&
    !(sender.origin === 'https://www.youtube.com' && sender.frameId === 0)
  )
    return false;
  const message = input as Record<string, unknown>;
  let trace = ASSET_PROFILE
    ? ((typeof message['id'] === 'string' ? assetProfile(message['id']) : undefined) ??
      (validProfile(message['__profile']) ? message['__profile'] : undefined))
    : undefined;
  if (ASSET_PROFILE) {
    if (!trace && Array.isArray(message['ids']))
      trace = message['ids'].flatMap((id) =>
        typeof id === 'string' && assetProfile(id) ? [assetProfile(id)!] : [],
      )[0];
    const design = message['design'] as { decorations?: { assetId?: string }[] } | undefined;
    if (!trace && Array.isArray(design?.decorations))
      trace = design.decorations.flatMap((item) =>
        typeof item?.assetId === 'string' && assetProfile(item.assetId) ? [assetProfile(item.assetId)!] : [],
      )[0];
    const session = message['session'];
    if (typeof session === 'string') {
      trace ??= profileSessions.get(session);
      if (trace) {
        if (profileSessions.size >= 128) profileSessions.delete(profileSessions.keys().next().value!);
        profileSessions.set(session, trace);
      }
    }
  }
  const arrived = ASSET_PROFILE ? performance.now() : 0;
  const scheduler = ['get', 'get-part', 'get-metadata', STUDIO_TRANSFER_CONFIRM, STUDIO_TRANSFER_STATUS].includes(
    String(message['action']),
  )
    ? reads
    : mutations;
  void scheduler
    .run(() => {
      profileEnd(trace, 'queue.' + message['action'], arrived);
      return profileAsync(trace, 'service.' + message['action'], () => handle(message, sender, trace));
    })
    .then(
      (value) => respond({ ok: true, value, ...(trace ? { __profile: trace } : {}) }),
      (error: unknown) =>
        respond({ ok: false, error: error instanceof Error ? error.message : '素材の保存に失敗しました。' }),
    );
  return true;
});
chrome.tabs.onRemoved.addListener(() => {
  void enqueue(() => prune()).catch(() => undefined);
});

installSidePanelHost();
installEditorEntry();
installTakeStorage(enqueue);
if (ASSET_PROFILE) installAssetRuntimeBroker();
