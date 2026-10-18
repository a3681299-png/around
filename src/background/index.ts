import { ASSET_MESSAGE, type AssetWireFile } from '../assets/protocol';
import { changeAssets, getAsset, type AssetLease, type StoredAsset } from '../assets/repository';
import { ASSET_LIMITS, base64ToBytes, bytesToBase64, type AssetMetadata } from '../assets/validation';
import { inspectAsset } from '../assets/inspect';
import { validateDesignAssets } from '../assets/design-assets';
import { isAssetId, isDesignId, parseDesign } from '../design/schema';
import { saveDesign } from '../storage/designs';

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.catch(() => undefined);
  return result;
}

function owner(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): AssetLease {
  if (!isDesignId(message['session'])) throw new Error('編集セッションが不正です。');
  return { session: message['session'], tabId: sender.tab?.id ?? -1, documentId: sender.documentId ?? sender.url ?? '' };
}

async function prune(current?: AssetLease): Promise<void> {
  const values = await chrome.storage.local.get(null);
  const references = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('webWorldThemes.design.')) continue;
    try { parseDesign(value).decorations.forEach((item) => references.add(item.assetId)); }
    catch { return; } // A future document version may reference assets we cannot see.
  }
  const tabs = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  await changeAssets((rows) => {
    const put: StoredAsset[] = [], remove: string[] = [];
    for (const row of rows) {
      const leases = row.leases.filter((lease) => (lease.tabId === -1 || tabs.has(lease.tabId))
        && !(current && lease.tabId === current.tabId && lease.documentId !== current.documentId));
      if (leases.length || references.has(row.id)) put.push({ ...row, leases });
      else remove.push(row.id);
    }
    return { value: undefined, put, remove };
  });
}

async function leaseAssets(lease: AssetLease, ids: readonly string[]): Promise<void> {
  await changeAssets((rows) => {
    if (ids.some((id) => !rows.some((row) => row.id === id))) throw new Error('画像素材が見つかりません。もう一度読み込んでください。');
    return { value: undefined, put: rows.map((row) => ({ ...row, leases: [
      ...row.leases.filter((entry) => entry.session !== lease.session), ...(ids.includes(row.id) ? [lease] : []),
    ] })) };
  });
}

async function importBatch(input: unknown, lease: AssetLease): Promise<AssetMetadata[]> {
  if (!Array.isArray(input) || !input.length || input.length > ASSET_LIMITS.batchCount) throw new Error('一度に追加できる画像は8枚までです。');
  const assets: StoredAsset[] = [];
  let size = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new Error('画像の形式が不正です。');
    const file = raw as AssetWireFile;
    if (typeof file.name !== 'string' || !file.name.length || file.name.length > 120 || /[\u0000-\u001f]/.test(file.name)
      || typeof file.mime !== 'string') throw new Error('画像の形式が不正です。');
    const bytes = base64ToBytes(file.base64);
    size += bytes.length;
    if (size > ASSET_LIMITS.batchBytes) throw new Error('一度に追加する素材は合計32MBまでです。');
    const info = inspectAsset(bytes, file.mime);
    const blob = new Blob([new Uint8Array(bytes).buffer], { type: info.mime });
    // ServiceWorker has no ImageDecoder. Both boundaries inspect containers;
    // images validate frame 0. Video is probed by the content importer.
    if (info.animation?.format !== 'lottie' && info.animation?.format !== 'webm') {
      const bitmap = await createImageBitmap(blob);
      try { if (bitmap.width !== info.width || bitmap.height !== info.height) throw new Error('画像を正しく読み込めませんでした。'); }
      finally { bitmap.close(); }
    }
    const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
    const id = `asset-${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    assets.push({ ...info, id, name: file.name, byteLength: bytes.length, blob, leases: [lease] });
  }
  await prune(lease);
  await changeAssets((rows) => {
    const combined = new Map(rows.map((row) => [row.id, row]));
    for (const asset of assets) {
      const existing = combined.get(asset.id);
      combined.set(asset.id, existing ? { ...existing, leases: [...existing.leases.filter((entry) => entry.session !== lease.session), lease] } : asset);
    }
    if (combined.size > ASSET_LIMITS.count || [...combined.values()].reduce((sum, row) => sum + row.byteLength, 0) > ASSET_LIMITS.totalBytes) {
      throw new Error('素材の保存上限（256MB・128素材）またはブラウザーの空き容量を確認してください。不要な素材を削除して保存すると空きを確保できます。');
    }
    return { value: undefined, put: [...combined.values()] };
  });
  return assets.map(({ blob: _blob, leases: _leases, ...metadata }) => metadata);
}

async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message['action'] === 'get') {
    if (!isAssetId(message['id'])) throw new Error('素材IDが不正です。');
    const asset = await getAsset(message['id']);
    if (!asset) throw new Error('画像素材が見つかりません。');
    const { blob, leases: _leases, ...metadata } = asset;
    return { metadata, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
  }
  const lease = owner(message, sender);
  if (message['action'] === 'import') return importBatch(message['files'], lease);
  if (message['action'] === 'lease') {
    const ids = message['ids'];
    // Undo/redo can retain assets absent from the current 32-layer document.
    if (!Array.isArray(ids) || ids.length > ASSET_LIMITS.count || !ids.every(isAssetId)) throw new Error('素材IDが不正です。');
    await leaseAssets(lease, ids);
  } else if (message['action'] === 'release') {
    await leaseAssets(lease, []);
  } else if (message['action'] === 'save' || message['action'] === 'validate') {
    const design = parseDesign(message['design']);
    const assets = new Map<string, AssetMetadata>();
    for (const id of new Set(design.decorations.map((layer) => layer.assetId))) { const asset = await getAsset(id); if (asset) assets.set(id, asset); }
    validateDesignAssets(design.decorations, assets);
    if (message['action'] === 'validate') return undefined;
    await saveDesign(design);
  } else throw new Error('未対応の素材操作です。');
  // Cleanup is secondary to a successful save; a failed cleanup retains assets.
  await prune(lease).catch(() => undefined);
  return undefined;
}

chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !input || typeof input !== 'object' || !('type' in input) || input.type !== ASSET_MESSAGE) return false;
  if (!sender.url?.startsWith(chrome.runtime.getURL('')) && !(sender.origin === 'https://www.youtube.com' && sender.frameId === 0)) return false;
  void enqueue(() => handle(input as Record<string, unknown>, sender)).then(
    (value) => respond({ ok: true, value }),
    (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : '画像の保存に失敗しました。' }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener(() => { void enqueue(() => prune()).catch(() => undefined); });
