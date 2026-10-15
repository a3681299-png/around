import type { DesignDocument } from '../design/types';
import { ASSET_LIMITS, base64ToBytes, bytesToBase64, inspectImage, type AssetMetadata } from './validation';
import { ASSET_MESSAGE, type AssetWireFile } from './protocol';

async function request<T>(action: string, values: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: ASSET_MESSAGE, action, ...values }) as { ok: boolean; value?: T; error?: string } | undefined;
  if (!response?.ok) throw new Error(response?.error ?? '画像の保存処理に接続できません。拡張を再読み込みしてください。');
  return response.value as T;
}

export async function importAssets(files: readonly File[], session: string): Promise<AssetMetadata[]> {
  if (!files.length || files.length > ASSET_LIMITS.batchCount) throw new Error('一度に追加できる画像は8枚までです。');
  if (files.reduce((size, file) => size + file.size, 0) > ASSET_LIMITS.batchBytes) throw new Error('一度に追加する画像は合計12MBまでです。');
  const wire: AssetWireFile[] = [];
  for (const file of files) {
    if (file.size > ASSET_LIMITS.fileBytes) throw new Error('画像は1枚4MBまでです。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    inspectImage(bytes, file.type);
    wire.push({ name: file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'image', mime: file.type, base64: bytesToBase64(bytes) });
  }
  return request('import', { session, files: wire });
}

export async function loadAsset(id: string): Promise<{ metadata: AssetMetadata; blob: Blob }> {
  const result = await request<{ metadata: AssetMetadata; base64: string }>('get', { id });
  const bytes = base64ToBytes(result.base64);
  return { metadata: result.metadata, blob: new Blob([new Uint8Array(bytes).buffer], { type: result.metadata.mime }) };
}

export const retainAssets = (session: string, ids: readonly string[]) => request<void>('lease', { session, ids });
export const releaseAssets = (session: string) => request<void>('release', { session });
export const commitDesign = (design: DesignDocument, session: string) => request<void>('save', { design, session });
