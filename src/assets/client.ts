import type { DesignDocument } from '../design/types';
import { ASSET_LIMITS, base64ToBytes, bytesToBase64, type AssetMetadata } from './validation';
import { ASSET_MESSAGES } from './limits';
import { inspectAsset } from './inspect';
import { validateAnimatedFrames } from './decode';
import { ASSET_MESSAGE, type AssetWireFile } from './protocol';
import {
  ASSET_PROFILE,
  assetProfile,
  newAssetProfile,
  linkAssetProfile,
  profileAsync,
  profileSync,
  profileEnd,
  flushAssetProfile,
} from '../diagnostics/asset-profile';
import { createSourceCache } from './source-cache';
import { rememberVerifiedSource } from './verified-source';
import { validateImportBatchSizes } from './import-validation';

async function request<T>(action: string, values: Record<string, unknown>): Promise<T> {
  const trace = ASSET_PROFILE
    ? ((values['__profile'] as string | undefined) ??
      (typeof values['id'] === 'string' ? assetProfile(values['id']) : undefined))
    : undefined;
  const start = ASSET_PROFILE ? performance.now() : 0;
  const response = (await chrome.runtime.sendMessage({
    type: ASSET_MESSAGE,
    action,
    ...values,
    ...(trace ? { __profile: trace } : {}),
  })) as { ok: boolean; value?: T; error?: string; __profile?: string } | undefined;
  if (ASSET_PROFILE) {
    const id = response?.__profile ?? trace;
    if (typeof values['id'] === 'string') linkAssetProfile(values['id'], id);
    profileEnd(id, 'rpc.' + action, start, {
      count: 1,
      ...(typeof values['base64'] === 'string'
        ? { wireChars: values['base64'].length }
        : typeof response?.value === 'string'
          ? { wireChars: response.value.length }
          : {}),
    });
  }
  if (!response?.ok)
    throw new Error(response?.error ?? '素材の保存処理に接続できません。拡張を再読み込みしてください。');
  return response.value as T;
}

/** Both Studio transports retain the existing client-side media probes. */
export async function readImportFile(file: File, signal?: AbortSignal, trace?: string) {
  signal?.throwIfAborted();
  if (file.size > ASSET_LIMITS.modelBytes) throw new Error(ASSET_MESSAGES.fileSizes);
  const bytes = new Uint8Array(
    await profileAsync(trace, 'import.file-read', () => file.arrayBuffer(), { bytes: file.size }),
  );
  const info = profileSync(trace, 'import.inspect', () => inspectAsset(bytes, file.type));
  await profileAsync(trace, 'import.validate-textures', () => validateAnimatedFrames(bytes, info, signal, trace));
  signal?.throwIfAborted();
  const name = file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'image';
  return { bytes, name };
}

export async function importAssets(
  files: readonly File[],
  session: string,
  signal?: AbortSignal,
  ownerTabId?: number,
): Promise<AssetMetadata[]> {
  const owner = ownerTabId === undefined ? {} : { ownerTabId };
  validateImportBatchSizes(files.map((file) => file.size));
  const wire: AssetWireFile[] = [];
  const imported: AssetMetadata[] = new Array(files.length),
    wireIndices: number[] = [];
  const wireTraces: (string | undefined)[] = [];
  for (const [fileIndex, file] of files.entries()) {
    const trace = newAssetProfile(),
      before = ASSET_PROFILE ? performance.now() : 0;
    const profiled = trace ? { __profile: trace } : {};
    const { bytes, name } = await readImportFile(file, signal, trace);
    if (file.size > ASSET_LIMITS.fileBytes) {
      const upload = await request<string>('upload-start', {
        session,
        ...owner,
        ...profiled,
        size: bytes.length,
        name,
        mime: file.type,
      });
      try {
        const uploadStart = ASSET_PROFILE ? performance.now() : 0;
        for (let offset = 0; offset < bytes.length; offset += ASSET_LIMITS.chunkBytes) {
          signal?.throwIfAborted();
          const part = bytes.subarray(offset, offset + ASSET_LIMITS.chunkBytes);
          const base64 = profileSync(trace, 'upload.encode-base64', () => bytesToBase64(part), { bytes: part.length });
          await request('upload-part', { session, ...owner, ...profiled, upload, offset, base64 });
        }
        profileEnd(trace, 'upload.parts-total', uploadStart, { bytes: bytes.length });
        signal?.throwIfAborted();
        imported[fileIndex] = (
          await request<AssetMetadata[]>('upload-finish', { session, ...owner, ...profiled, upload })
        )[0]!;
      } catch (error) {
        await request('upload-abort', { session, ...owner, upload }).catch(() => undefined);
        throw error;
      }
    } else {
      wireIndices.push(fileIndex);
      wireTraces.push(trace);
      wire.push({ name, mime: file.type, base64: bytesToBase64(bytes) });
    }
    if (imported[fileIndex]) linkAssetProfile(imported[fileIndex]!.id, trace);
    profileEnd(trace, imported[fileIndex] ? 'import.file-to-stored' : 'import.file-prepared', before, {
      bytes: bytes.length,
    });
  }
  signal?.throwIfAborted();
  if (wire.length)
    (
      await request<AssetMetadata[]>('import', {
        session,
        ...owner,
        files: wire,
        ...(wireTraces[0] ? { __profile: wireTraces[0] } : {}),
      })
    ).forEach((asset, i) => {
      imported[wireIndices[i]!] = asset;
      linkAssetProfile(asset.id, wireTraces[0]);
    });
  if (ASSET_PROFILE) await flushAssetProfile();
  return imported;
}

async function fetchAsset(id: string, signal: AbortSignal): Promise<{ metadata: AssetMetadata; blob: Blob }> {
  signal.throwIfAborted();
  const result = await request<{ metadata: AssetMetadata; base64?: string; chunked?: boolean }>('get', { id });
  const trace = assetProfile(id),
    started = ASSET_PROFILE ? performance.now() : 0;
  let bytes: Uint8Array;
  if (result.chunked) {
    if (
      !Number.isSafeInteger(result.metadata.byteLength) ||
      result.metadata.byteLength > ASSET_LIMITS.modelBytes ||
      result.metadata.byteLength <= 0
    )
      throw new Error('素材容量が不正です。');
    bytes = new Uint8Array(result.metadata.byteLength);
    for (let offset = 0; offset < bytes.length; offset += ASSET_LIMITS.chunkBytes) {
      signal.throwIfAborted();
      const wire = await request<string>('get-part', { id, offset });
      signal.throwIfAborted();
      const part = profileSync(trace, 'download.decode-base64', () => base64ToBytes(wire), {
        bytes: Math.min(ASSET_LIMITS.chunkBytes, bytes.length - offset),
      });
      if (part.length !== Math.min(ASSET_LIMITS.chunkBytes, bytes.length - offset))
        throw new Error('素材の転送が中断されました。');
      profileSync(trace, 'download.reassemble', () => bytes.set(part, offset), { bytes: part.length });
    }
  } else bytes = base64ToBytes(result.base64);
  profileEnd(trace, 'download.parts-total', started, { bytes: bytes.length });
  signal.throwIfAborted();
  const info = profileSync(trace, 'download.inspect', () => inspectAsset(bytes, result.metadata.mime));
  const blob = profileSync(
    trace,
    'download.clone-blob',
    () => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: info.mime }),
    { bytes: bytes.length },
  );
  rememberVerifiedSource(blob, info);
  return { metadata: { ...result.metadata, ...info }, blob };
}
const sources = createSourceCache({
  load: fetchAsset,
  size: (asset) => asset.blob.size,
  now: () => performance.now(),
  maxBytes: 96 * 1024 * 1024,
  idleMs: 30000,
});
export async function loadAsset(id: string, signal?: AbortSignal): Promise<{ metadata: AssetMetadata; blob: Blob }> {
  const asset = await sources.get(id, signal);
  return { metadata: structuredClone(asset.metadata), blob: asset.blob };
}
export const clearAssetSources = () => sources.clear();
export const loadAssetMetadata = (id: string) => request<AssetMetadata>('get-metadata', { id });

export const retainAssets = (session: string, ids: readonly string[]) => request<void>('lease', { session, ids });
export const releaseAssets = (session: string) => request<void>('release', { session });
export const commitDesign = (design: DesignDocument, session: string) => request<void>('save', { design, session });
export const checkDesignAssets = (design: DesignDocument, session: string) =>
  request<void>('validate', { design, session });

/** An extension Studio pins recovery assets for its own tab, never an indefinite -1 owner. */
export const retainStudioAssets = (session: string, ids: readonly string[], ownerTabId: number) =>
  request<void>('lease', { session, ids, ownerTabId });
