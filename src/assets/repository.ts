import type { AssetMetadata } from './validation';

export const ASSET_DATABASE = 'around-assets';
export interface AssetLease {
  session: string;
  tabId: number;
  documentId: string;
}
export const BACKUP_LIBRARY_LEASE: Readonly<AssetLease> = Object.freeze({
  session: 'backup-library',
  tabId: -1,
  documentId: 'backup-library',
});
export function keepAssetLease(
  lease: AssetLease,
  tabs: ReadonlySet<number | undefined>,
  current?: AssetLease,
): boolean {
  return (
    (lease.tabId === -1 || tabs.has(lease.tabId)) &&
    !(
      current &&
      !current.documentId.startsWith('studio:') &&
      lease.tabId === current.tabId &&
      lease.documentId !== current.documentId &&
      !lease.documentId.startsWith('studio:') &&
      // A restored library is durable, not the previous document of an un-tabbed UI.
      lease.documentId !== BACKUP_LIBRARY_LEASE.documentId
    )
  );
}
export interface StoredAsset extends AssetMetadata {
  blob: Blob;
  leases: AssetLease[];
}
let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
  });
  return database;
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('assets').objectStore('assets').get(id);
    request.onsuccess = () => resolve(request.result as StoredAsset | undefined);
    request.onerror = () => reject(request.error);
  });
}

/** The worker serializes requests; each database change is also one transaction. */
export async function changeAssets<T>(
  change: (rows: StoredAsset[]) => { value: T; put?: StoredAsset[]; remove?: string[] },
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    const store = tx.objectStore('assets');
    const request = store.getAll();
    let result: T;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const next = change(request.result as StoredAsset[]);
        result = next.value;
        next.put?.forEach((row) => store.put(row));
        next.remove?.forEach((id) => store.delete(id));
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('素材を保存できませんでした。'));
  });
}
