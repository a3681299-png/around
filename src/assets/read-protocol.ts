import type { AssetMetadata } from './validation';

export const ASSET_READ_MESSAGE = 'web-world-themes:asset-read-v1';
export const ASSET_READ_PORT = 'web-world-themes:asset-read-port-v1';
export const ASSET_READ_CONFIRM = 'web-world-themes:asset-read-confirm-v1';
export const ASSET_READ_FRAME = 'assets/read-frame.html';
export const ASSET_READ_TTL_MS = 10_000;
export type AssetReadErrorCode = 'denied' | 'restart' | 'unavailable';
export class AssetReadError extends Error {
  constructor(
    readonly code: AssetReadErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export interface AssetReadSource {
  metadata: AssetMetadata;
  buffer: ArrayBuffer;
}
export type AssetReadReply =
  | { type: 'challenge'; challenge: string; generation: string }
  | { type: 'source'; source: AssetReadSource }
  | { type: 'error'; code: AssetReadErrorCode; error: string };
