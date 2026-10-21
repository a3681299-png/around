import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { STUDIO_ASSET_TRANSFER } from '../../src/assets/studio-transfer-protocol';

export interface StudioImportProbe {
  portImports: { type: string; keys: string[]; assets?: string[] }[];
  uploads: { action: string; session: string }[];
  nativeTransfers: { bytes: number; detached: boolean }[];
  fileReads: number;
  stored: boolean;
  resume?: () => void;
}
export async function observeImports(studio: Page, holdStored = false) {
  await studio.addInitScript(
    ({ hold, transferType }) => {
      const probe: StudioImportProbe = {
        portImports: [],
        uploads: [],
        nativeTransfers: [],
        fileReads: 0,
        stored: false,
      };
      (globalThis as any).__studioImportProbe = probe;
      const connect = chrome.tabs.connect;
      chrome.tabs.connect = function (...args) {
        const port = Reflect.apply(connect, chrome.tabs, args) as chrome.runtime.Port,
          post = port.postMessage;
        port.postMessage = (message: Record<string, any>) => {
          if (message.type === 'import' || message.type === 'import-assets')
            probe.portImports.push({ type: message.type, keys: Object.keys(message), assets: message.assets });
          post.call(port, message);
        };
        return port;
      };
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = function (...args: unknown[]) {
        const message = args[0] as Record<string, any>,
          result = Reflect.apply(send, chrome.runtime, args);
        if (message?.type === 'web-world-themes:assets' && message.session?.startsWith('studio-upload-')) {
          probe.uploads.push({ action: message.action, session: message.session });
          if (hold && (message.action === 'import' || message.action === 'upload-finish'))
            return Promise.resolve(result).then(async (response) => {
              if (response?.ok && !probe.stored) {
                probe.stored = true;
                await new Promise<void>((resolve) => {
                  probe.resume = resolve;
                });
              }
              return response;
            });
        }
        return result;
      } as typeof chrome.runtime.sendMessage;
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        probe.fileReads++;
        return read.call(this);
      };
      if (typeof ServiceWorker !== 'undefined') {
        const post = ServiceWorker.prototype.postMessage;
        ServiceWorker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
          const body = message as { type?: string; files?: { buffer: ArrayBuffer }[] };
          const bytes = body.type === transferType ? body.files!.reduce((n, file) => n + file.buffer.byteLength, 0) : 0;
          const result = Reflect.apply(post, this, [message, ...args]);
          if (body.type === transferType)
            probe.nativeTransfers.push({ bytes, detached: body.files!.every((file) => file.buffer.byteLength === 0) });
          return result;
        };
        const OriginalChannel = MessageChannel;
        globalThis.MessageChannel = class extends OriginalChannel {
          constructor() {
            super();
            this.port1.addEventListener(
              'message',
              (event: MessageEvent) => {
                if (hold && event.data?.type === 'done' && !probe.stored) {
                  probe.stored = true;
                  const value = event.data;
                  probe.resume = () => {
                    this.port1.dispatchEvent(new MessageEvent('message', { data: value }));
                  };
                  event.stopImmediatePropagation();
                }
              },
              true,
            );
          }
        };
      }
    },
    { hold: holdStored, transferType: STUDIO_ASSET_TRANSFER },
  );
  await studio.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
}
export async function assetRows(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ id: string; byteLength: number; leases: { session: string }[] }[]>((resolve, reject) => {
        const open = indexedDB.open('web-world-themes-assets', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            request = db.transaction('assets').objectStore('assets').getAll();
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve(request.result.map((row) => ({ id: row.id, byteLength: row.byteLength, leases: row.leases })));
          };
        };
      }),
  );
}
export async function uploadLeases(page: Page) {
  return (await assetRows(page)).flatMap((row) =>
    row.leases.filter((lease) => lease.session.startsWith('studio-upload-')).map((lease) => lease.session),
  );
}
