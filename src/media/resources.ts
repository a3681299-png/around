import { loadAsset } from '../assets/client';
import { inspectLottie } from '../assets/lottie';
import { prepareMediaTimeline } from '../world/media-time';
import { MediaBudgetUnavailable, type MediaBudget } from './budget';
import { createRasterSampler } from './raster-sampler';
import { ASSET_LIMITS, type AssetMetadata } from '../assets/validation';
import type { MediaTimeline } from '../world/media-time';
import type { AsyncSampler } from './sampler';

export interface MediaResource {
  metadata: AssetMetadata;
  blob: Blob;
  readonly disposed: boolean;
  data: object | undefined;
  timeline: MediaTimeline | undefined;
  acquireUrl(consumer: string): string;
  releaseUrl(consumer: string): void;
  use(consumer: string): void;
  unuse(consumer: string): void;
  sampler(consumer: string): AsyncSampler;
  releaseSampler(consumer: string): void;
  destroy(): void;
}

export function createResourceCache(budget: MediaBudget) {
  const cache = new Map<string, ResourceEntry>();
  let closed = false;
  const acquire = (id: string): ResourceEntry => {
    const existing = cache.get(id);
    if (existing) {
      existing.refs++;
      return existing;
    }
    const entry: ResourceEntry = {
      refs: 1,
      promise: budget
        .decode(async () => {
          // Bound concurrent storage/base64 transfers before allocating their buffers.
          const transfer = `${id}-transfer`;
          if (!budget.reserve(transfer, ASSET_LIMITS.fileBytes, 'encoded')) throw new MediaBudgetUnavailable();
          try {
            return await loadAsset(id);
          } finally {
            budget.release(transfer);
          }
        })
        .then(async ({ metadata, blob }) => {
          let disposed = false,
            url: string | undefined,
            sampler: ReturnType<typeof createRasterSampler> | undefined;
          const active = new Set<string>(),
            sampling = new Set<string>(),
            native = new Set<string>(),
            key = `${id}-original`;
          const resource: MediaResource = {
            metadata,
            blob,
            get disposed() {
              return disposed;
            },
            data:
              metadata.animation?.format === 'lottie'
                ? inspectLottie(new Uint8Array(await blob.arrayBuffer())).data
                : undefined,
            timeline:
              metadata.animation && metadata.animation.format !== 'webm'
                ? prepareMediaTimeline(metadata.animation)
                : undefined,
            acquireUrl(consumer) {
              native.add(consumer);
              return (url ??= URL.createObjectURL(blob));
            },
            releaseUrl(consumer) {
              native.delete(consumer);
              if (!native.size && url) {
                URL.revokeObjectURL(url);
                url = undefined;
              }
            },
            use(consumer: string) {
              active.add(consumer);
              budget.touch(key);
            },
            unuse(consumer: string) {
              active.delete(consumer);
            },
            sampler(consumer: string) {
              sampling.add(consumer);
              return (sampler ??= createRasterSampler(blob, metadata, budget));
            },
            releaseSampler(consumer: string) {
              sampler?.releaseConsumer(consumer);
              sampling.delete(consumer);
              if (!sampling.size) {
                sampler?.destroy();
                sampler = undefined;
              }
            },
            destroy() {
              if (disposed) return;
              disposed = true;
              sampler?.destroy();
              sampler = undefined;
              if (url) URL.revokeObjectURL(url);
              budget.release(key);
            },
          };
          if (
            !budget.reserve(key, blob.size, 'encoded', () => {
              if (active.size) return false;
              resource.destroy();
              if (cache.get(id) === entry) cache.delete(id);
              return true;
            })
          )
            throw new MediaBudgetUnavailable();
          if (closed || entry.refs === 0) {
            resource.destroy();
            throw new Error('表示を終了しました。');
          }
          return resource;
        }),
    };
    cache.set(id, entry);
    return entry;
  };
  return {
    acquire,
    release(id: string, entry: ResourceEntry) {
      if (--entry.refs > 0) return;
      if (cache.get(id) === entry) cache.delete(id);
      void entry.promise.then(
        (resource) => resource.destroy(),
        () => undefined,
      );
    },
    destroy() {
      closed = true;
      cache.forEach((entry) => {
        void entry.promise.then(
          (resource) => resource.destroy(),
          () => undefined,
        );
      });
      cache.clear();
    },
  };
}
export interface ResourceEntry {
  refs: number;
  promise: Promise<MediaResource>;
}
