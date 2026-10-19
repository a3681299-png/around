import type { DesignDocument } from '../design/types';
import { ASSET_LIMITS, base64ToBytes, bytesToBase64, type AssetMetadata } from './validation';
import { inspectAsset } from './inspect';
import { validateAnimatedFrames } from './decode';
import { ASSET_MESSAGE, type AssetWireFile } from './protocol';

async function request<T>(action: string, values: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: ASSET_MESSAGE, action, ...values }) as { ok: boolean; value?: T; error?: string } | undefined;
  if (!response?.ok) throw new Error(response?.error ?? '画像の保存処理に接続できません。拡張を再読み込みしてください。');
  return response.value as T;
}

export async function importAssets(files: readonly File[], session: string, signal?: AbortSignal, ownerTabId?: number): Promise<AssetMetadata[]> {
  const owner = ownerTabId === undefined ? {} : { ownerTabId };
  if (!files.length || files.length > ASSET_LIMITS.batchCount) throw new Error('一度に追加できる画像は8枚までです。');
  const large = files.some((file) => file.size > ASSET_LIMITS.fileBytes), total = files.reduce((size, file) => size + file.size, 0);
  if (total > (large ? ASSET_LIMITS.batchBytes : ASSET_LIMITS.fileBytes)) throw new Error('一度の追加は通常32MiB、大容量3Dを含む場合は64MiBまでです。');
  const wire: AssetWireFile[] = [];
  const imported: AssetMetadata[] = new Array(files.length), wireIndices: number[] = [];
  for (const [fileIndex, file] of files.entries()) {
    signal?.throwIfAborted();
    if (file.size > ASSET_LIMITS.modelBytes) throw new Error('通常素材は32MiB、GLB・VRMは64MiBまでです。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = inspectAsset(bytes, file.type);
    await validateAnimatedFrames(bytes, info, signal); signal?.throwIfAborted();
    const name = file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'image';
    if (file.size > ASSET_LIMITS.fileBytes) {
      const upload = await request<string>('upload-start', { session, ...owner, size: bytes.length, name, mime: file.type });
      try {
        for (let offset = 0; offset < bytes.length; offset += ASSET_LIMITS.chunkBytes) { signal?.throwIfAborted(); await request('upload-part', { session, ...owner, upload, offset, base64: bytesToBase64(bytes.subarray(offset, offset + ASSET_LIMITS.chunkBytes)) }); }
        signal?.throwIfAborted(); imported[fileIndex] = (await request<AssetMetadata[]>('upload-finish', { session, ...owner, upload }))[0]!;
      } catch (error) { await request('upload-abort', { session, ...owner, upload }).catch(() => undefined); throw error; }
    } else { wireIndices.push(fileIndex); wire.push({ name, mime: file.type, base64: bytesToBase64(bytes) }); }
  }
  signal?.throwIfAborted(); if (wire.length) (await request<AssetMetadata[]>('import', { session, ...owner, files: wire })).forEach((asset, i) => { imported[wireIndices[i]!] = asset; });
  return imported;
}

export async function loadAsset(id: string): Promise<{ metadata: AssetMetadata; blob: Blob }> {
  const result = await request<{ metadata: AssetMetadata; base64?: string; chunked?: boolean }>('get', { id });
  let bytes: Uint8Array;
  if (result.chunked) {
    if (!Number.isSafeInteger(result.metadata.byteLength) || result.metadata.byteLength > ASSET_LIMITS.modelBytes || result.metadata.byteLength <= 0) throw new Error('素材容量が不正です。');
    bytes = new Uint8Array(result.metadata.byteLength);
    for (let offset = 0; offset < bytes.length; offset += ASSET_LIMITS.chunkBytes) { const part = base64ToBytes(await request<string>('get-part', { id, offset })); if (part.length !== Math.min(ASSET_LIMITS.chunkBytes, bytes.length - offset)) throw new Error('素材の転送が中断されました。'); bytes.set(part, offset); }
  } else bytes = base64ToBytes(result.base64);
  const info = inspectAsset(bytes, result.metadata.mime);
  return { metadata: { ...result.metadata, ...info }, blob: new Blob([new Uint8Array(bytes).buffer], { type: info.mime }) };
}
export const loadAssetMetadata = (id: string) => request<AssetMetadata>('get-metadata', { id });

export const retainAssets = (session: string, ids: readonly string[]) => request<void>('lease', { session, ids });
export const releaseAssets = (session: string) => request<void>('release', { session });
export const commitDesign = (design: DesignDocument, session: string) => request<void>('save', { design, session });
export const checkDesignAssets = (design: DesignDocument, session: string) => request<void>('validate', { design, session });

/** An extension Studio pins recovery assets for its own tab, never an indefinite -1 owner. */
export const retainStudioAssets = (session: string, ids: readonly string[], ownerTabId: number) => request<void>('lease', { session, ids, ownerTabId });
