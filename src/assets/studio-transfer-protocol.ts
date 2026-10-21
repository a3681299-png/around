import type { AssetMetadata } from './validation';

export const STUDIO_ASSET_TRANSFER = 'web-world-themes:studio-assets-v1';
export const STUDIO_TRANSFER_AUTHORIZE = 'studio-transfer-authorize';
export const STUDIO_TRANSFER_CONFIRM = 'studio-transfer-confirm';
export const STUDIO_TRANSFER_STATUS = 'studio-transfer-status';
export const STUDIO_TRANSFER_ATTEMPTS = 3;
export const STUDIO_TRANSFER_TIMEOUT_MS = 30000;
export interface StudioTransferGrant {
  token: string;
  generation: string;
}
export interface StudioTransferFile {
  name: string;
  mime: string;
  buffer: ArrayBuffer;
}
export interface StudioTransferRequest extends StudioTransferGrant {
  type: typeof STUDIO_ASSET_TRANSFER;
  request: string;
  session: string;
  files: StudioTransferFile[];
  profile?: string;
}
export type StudioTransferReply =
  | { type: 'challenge'; request: string; generation: string; challenge: string }
  | { type: 'done'; request: string; generation: string; assets: AssetMetadata[] }
  | {
      type: 'error';
      request: string;
      generation: string;
      code: 'restart' | 'invalid' | 'unauthorized' | 'cancelled' | 'busy';
      error: string;
    };
