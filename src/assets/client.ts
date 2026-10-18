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

export async function importAssets(files: readonly File[], session: string, signal?: AbortSignal): Promise<AssetMetadata[]> {
  if (!files.length || files.length > ASSET_LIMITS.batchCount) throw new Error('一度に追加できる画像は8枚までです。');
  if (files.reduce((size, file) => size + file.size, 0) > ASSET_LIMITS.batchBytes) throw new Error('一度に追加する素材は合計32MBまでです。');
  const wire: AssetWireFile[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    if (file.size > ASSET_LIMITS.fileBytes) throw new Error('素材は1ファイル32MBまでです。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = inspectAsset(bytes, file.type);
    await validateAnimatedFrames(bytes, info, signal); signal?.throwIfAborted();
    wire.push({ name: file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'image', mime: file.type, base64: bytesToBase64(bytes) });
  }
  signal?.throwIfAborted(); return request('import', { session, files: wire });
}

export async function loadAsset(id: string): Promise<{ metadata: AssetMetadata; blob: Blob }> {
  const result = await request<{ metadata: AssetMetadata; base64: string }>('get', { id });
  const bytes = base64ToBytes(result.base64);
  const info = inspectAsset(bytes, result.metadata.mime);
  return { metadata: { ...result.metadata, ...info }, blob: new Blob([new Uint8Array(bytes).buffer], { type: info.mime }) };
}

export const retainAssets = (session: string, ids: readonly string[]) => request<void>('lease', { session, ids });
export const releaseAssets = (session: string) => request<void>('release', { session });
export const commitDesign = (design: DesignDocument, session: string) => request<void>('save', { design, session });
export const checkDesignAssets = (design: DesignDocument, session: string) => request<void>('validate', { design, session });
