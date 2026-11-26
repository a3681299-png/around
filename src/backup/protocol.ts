export const BACKUP_MESSAGE = 'around:backup-v1';
export const BACKUP_PAGE = 'backup/index.html';
export interface BackupSummary {
  createdAt: string;
  designs: number;
  assets: number;
  takes: number;
  assetBytes: number;
}
export interface BackupReply {
  ok: boolean;
  file?: Blob;
  summary?: BackupSummary;
  error?: string;
}
