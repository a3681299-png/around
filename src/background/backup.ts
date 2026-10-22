import { BACKUP_MESSAGE, BACKUP_PAGE, type BackupReply, type BackupSummary } from '../backup/protocol';
import { BACKUP_PREFERENCE_KEYS, type BackupManifest } from '../backup/schema';
import { backupObject, sameBackupData } from '../backup/data';
import { encodeBackup, decodeBackup, sha256 } from '../backup/archive';
import { planRestore } from '../backup/restore';
import { readSettings } from '../storage/settings';
import { parseDesign } from '../design/schema';
import { changeAssets } from '../assets/repository';
import { readStoredTakes, restoreTakes } from '../browser/take-repository';
import { oneOf } from '../validation';
import type { StudioTransferEvent } from './studio-transfer';

interface BackupPorts {
  pageURL: string;
  client(id: string): Promise<{ id: string; url: string; frameType: string } | undefined>;
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
}
function summary(manifest: BackupManifest): BackupSummary {
  return {
    createdAt: manifest.createdAt,
    designs: manifest.designs.length,
    assets: manifest.assets.length,
    takes: manifest.takes.length,
    assetBytes: manifest.assets.reduce((sum, row) => sum + row.byteLength, 0),
  };
}
export function createBackupService(ports: BackupPorts) {
  let busy = false;
  async function handle(raw: unknown): Promise<BackupReply> {
    const input = backupObject(raw, ['type', 'action', 'file', 'applySettings']);
    if (
      !oneOf(input['action'], ['export', 'inspect', 'restore']) ||
      (input['action'] !== 'export' &&
        (!(input['file'] instanceof Blob) || typeof input['applySettings'] !== 'boolean'))
    )
      throw new Error('バックアップ操作が不正です。');
    if (input['action'] === 'export') {
      const local = await chrome.storage.local.get(null);
      const settings = await readSettings();
      const rows = await changeAssets((rows) => ({ value: rows }));
      const manifest: BackupManifest = {
        format: 'web-world-themes-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        settings,
        preferences: Object.fromEntries(
          BACKUP_PREFERENCE_KEYS.filter((key) => Object.hasOwn(local, key)).map((key) => [key, local[key]]),
        ),
        designs: Object.entries(local)
          .filter(([key]) => key.startsWith('webWorldThemes.design.'))
          .map(([key, raw]) => {
            const design = parseDesign(raw);
            if (key !== 'webWorldThemes.design.' + design.siteId) throw new Error('作品の保存先が不正です。');
            return design;
          }),
        takes: await readStoredTakes(),
        assets: rows.map(({ id, name, mime, byteLength }) => ({ id, name, mime, byteLength })),
      };
      const file = await encodeBackup(
        manifest,
        rows.map((row) => row.blob),
      );
      if (!sameBackupData(local, await chrome.storage.local.get(null)))
        throw new Error('書き出し中に設定・作品が変わりました。保存後にもう一度書き出してください。');
      return { ok: true, file, summary: summary(manifest) };
    }
    const backup = await decodeBackup(input['file'] as Blob);
    const local = await chrome.storage.local.get(null),
      takes = await readStoredTakes();
    const rows = await changeAssets((rows) => ({ value: rows }));
    const plan = planRestore(backup, local, rows, takes, input['applySettings'] as boolean);
    // Hash reused originals too: a corrupt destination must not masquerade as a match.
    for (const row of rows)
      if (backup.assets.some((incoming) => incoming.id === row.id)) {
        if ('asset-' + (await sha256(new Uint8Array(await row.blob.arrayBuffer()))) !== row.id)
          throw new Error('既存素材のSHA-256が一致しません。');
      }
    if (input['action'] === 'inspect') return { ok: true, summary: summary(backup.manifest) };
    if (!sameBackupData(local, await chrome.storage.local.get(null)))
      throw new Error('確認中に設定・作品が変わりました。編集画面を閉じてからもう一度確認してください。');
    // All format, integrity, collision and quota checks have completed before writes.
    // These three stores cannot share a transaction. An I/O failure can leave new
    // originals/takes; no existing record is replaced, and retry is idempotent.
    await changeAssets(() => ({ value: undefined, put: plan.added }));
    await restoreTakes(backup.manifest.takes);
    // Only settings explicitly selected in the UI can replace existing settings.
    await chrome.storage.local.set(plan.values);
    return { ok: true, summary: summary(backup.manifest) };
  }
  return {
    receive(event: StudioTransferEvent) {
      const raw = event.data;
      if (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== BACKUP_MESSAGE) return;
      const reply = event.ports[0];
      if (!reply || event.ports.length !== 1) return;
      const send = (value: BackupReply) => {
        try {
          reply.postMessage(value);
        } catch {
          // The user may close the page after a successful durable write.
        } finally {
          reply.close();
        }
      };
      event.waitUntil(
        (async () => {
          const source = event.source as { id?: string } | null;
          const client = source?.id ? await ports.client(source.id) : undefined;
          if (!client || client.url !== ports.pageURL || client.frameType !== 'top-level')
            throw new Error('バックアップ専用ページ以外からの操作は受け付けません。');
          if (busy) throw new Error('バックアップ処理の完了を待ってください。');
          busy = true;
          try {
            send(await ports.enqueue(() => handle(raw)));
          } finally {
            busy = false;
          }
        })().catch((error: unknown) => {
          send({ ok: false, error: error instanceof Error ? error.message : 'バックアップに失敗しました。' });
        }),
      );
    },
  };
}
export function backupPageURL(): string {
  return chrome.runtime.getURL(BACKUP_PAGE);
}
