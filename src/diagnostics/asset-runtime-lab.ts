import { importAssets, releaseAssets, retainAssets } from '../assets/client';
import { getAsset } from '../assets/repository';
import { ASSET_LIMITS } from '../assets/validation';
import { ASSET_LAB_MESSAGE } from './asset-runtime-broker';
import { createAssetLabScene } from './asset-runtime-scene';
import { PROFILE_MESSAGE } from './asset-profile';
import { createSourceCache } from '../assets/source-cache';

const stage = document.querySelector<HTMLElement>('#stage')!,
  output = document.querySelector<HTMLElement>('#output')!;
const session = 'asset-lab-' + crypto.randomUUID();
let allowed: string[] = [],
  port: MessagePort | undefined,
  generation = 0,
  key = '',
  busy = false;
const request = async (values: Record<string, unknown>) => {
  const r = await chrome.runtime.sendMessage({ type: ASSET_LAB_MESSAGE, ...values });
  if (!r?.ok) throw new Error(r?.error ?? 'Lab unavailable');
  return r.value;
};
const sources = createSourceCache({
  load: async (id: string) => {
    const row = await getAsset(id);
    if (!row) throw new Error('Asset missing');
    const { blob, leases: _leases, ...metadata } = row;
    return { blob, metadata };
  },
  size: (a) => a.blob.size,
  now: () => performance.now(),
  maxBytes: 96 * 1024 * 1024,
  idleMs: 30000,
});
const read = async (id: string) => {
  if (parent !== window && !allowed.includes(id)) throw new Error('Asset outside grant');
  return sources.get(id);
};
const scene = createAssetLabScene(stage, read);
async function seed() {
  const file = document.querySelector<HTMLInputElement>('#file')!.files?.[0];
  if (!file) throw new Error('Choose local file');
  return (await importAssets([file], session))[0]!;
}
async function churn(id: string, rounds = 8) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 32) throw new Error('Invalid maintenance count');
  const token = 'lab-churn-' + crypto.randomUUID(),
    started = performance.now();
  try {
    for (let n = 0; n < rounds; n++) {
      await retainAssets(token, [id]);
      await releaseAssets(token);
    }
  } finally {
    await releaseAssets(token);
  }
  return { maintenanceMs: performance.now() - started, rounds, requestCount: rounds * 2 + 1 };
}
document.querySelector('#seed')!.addEventListener('click', () => {
  void seed().then(
    (m) => {
      output.textContent = JSON.stringify(m);
    },
    (e: unknown) => {
      output.textContent = String(e);
    },
  );
});
document.querySelector('#stop')!.addEventListener('click', () => scene.clear());
Object.assign(globalThis, {
  wwAssetLab: {
    seed,
    churn,
    seedMany: async () => {
      const out = [];
      for (const file of document.querySelector<HTMLInputElement>('#file')!.files ?? [])
        out.push(...(await importAssets([file], session)));
      return out;
    },
    show: scene.show,
    showMany: scene.showMany,
    configure: scene.configure,
    pose: scene.pose,
    animate: scene.animate,
    add2D: scene.add2D,
    clear: scene.clear,
    stats: scene.stats,
    open: (ids: string[], tab: number) => request({ action: 'open', ids, tab }),
  },
});
if (parent !== window) {
  document.body.classList.add('framed');
  void request({ action: 'claim', ticket: new URL(location.href).searchParams.get('ticket') }).then(
    (reply) => {
      allowed = reply.ids;
      key = reply.key;
      generation = reply.generation;
      document.documentElement.dataset.authorized = 'true';
    },
    (e: unknown) => {
      document.documentElement.dataset.error = String(e);
    },
  );
  window.addEventListener('message', (e: MessageEvent) => {
    if (
      !key ||
      e.origin !== 'https://www.youtube.com' ||
      e.source !== parent ||
      e.data?.type !== ASSET_LAB_MESSAGE ||
      e.data.key !== key ||
      e.data.generation !== generation ||
      e.ports.length !== 1 ||
      port
    )
      return;
    port = e.ports[0]!;
    key = '';
    const connected = port;
    connected.onmessage = (event: MessageEvent) => {
      const m = event.data;
      if (!m || m.generation !== generation || !Number.isSafeInteger(m.request)) return;
      const reply = (value: unknown, transfer: Transferable[] = []) =>
        connected.postMessage({ request: m.request, generation, value }, transfer);
      if (m.action === 'clear') {
        scene.clear();
        void chrome.runtime
          .sendMessage({ type: PROFILE_MESSAGE, action: 'clear' })
          .then(() => reply({ cleared: true }));
        return;
      }
      if (m.action === 'profile') {
        void chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'snapshot' }).then((value) => reply(value));
        return;
      }
      try {
        if (m.action === 'configure') {
          scene.configure(m.settings);
          reply({ configured: true });
          return;
        }
        if (m.action === 'stats') {
          reply(scene.stats());
          return;
        }
        if (m.action === 'reset-stats') {
          scene.resetObservations();
          reply({ reset: true });
          return;
        }
        if (m.action === 'animate') {
          scene.animate(m.enabled === true);
          reply({ animating: m.enabled === true });
          return;
        }
        if (m.action === 'pose') {
          scene.pose(m.index, m.happy);
          reply({ updated: true });
          return;
        }
        if (m.action === 'add2d') {
          scene.add2D(m.count);
          reply({ count: m.count });
          return;
        }
      } catch (error) {
        connected.postMessage({ request: m.request, generation, error: String(error) });
        return;
      }
      const ids: unknown[] = m.ids ?? [m.id];
      if (
        busy ||
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 5 ||
        ids.some((id) => typeof id !== 'string' || !allowed.includes(id))
      ) {
        connected.postMessage({ request: m.request, generation, error: 'Busy or forbidden asset' });
        return;
      }
      busy = true;
      void (async () => {
        const start = performance.now(),
          asset = await read(m.id),
          sourceMs = performance.now() - start;
        if (m.action === 'binary') {
          if (asset.blob.size > ASSET_LIMITS.modelBytes) throw new Error('Source over budget');
          const before = performance.now(),
            buffer = await asset.blob.arrayBuffer();
          reply({ metadata: asset.metadata, sourceMs, blobReadMs: performance.now() - before, buffer }, [buffer]);
          connected.postMessage({ type: 'released-source', generation, detached: buffer.byteLength === 0 });
          return;
        }
        if (m.action !== 'snapshot') throw new Error('Unknown renderer command');
        scene.configure(m.settings ?? {});
        const result = m.ids
          ? await scene.showMany(await Promise.all(ids.map(async (id) => (await read(id as string)).metadata)))
          : await scene.show(asset.metadata, m.count);
        reply({ ...result, sourceMs });
      })()
        .catch((error: unknown) => {
          connected.postMessage({ request: m.request, generation, error: String(error) });
        })
        .finally(() => {
          busy = false;
        });
    };
    connected.start();
    connected.postMessage({ type: 'ready', generation });
  });
}
window.addEventListener('pagehide', () => {
  port?.close();
  scene.destroy();
  sources.clear();
  if (parent === window) void releaseAssets(session);
});
