import { createYouTubeAdapter } from '../../src/sites/youtube';
import { createPageController } from '../../src/host/page-controller';
import { extensionAssets } from '../../src/browser/asset-client';
import { createTakeStorage } from '../../src/browser/take-storage';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { emptyDesign } from '../../src/design/schema';
import type { DesignDocument } from '../../src/design/types';

export function mount() {
  const counts = { variables: 0, compiles: 0, surfaces: 0 };
  (globalThis as any).__pageChanges = counts;
  const root = document.documentElement,
    nativeSet = root.style.setProperty.bind(root.style);
  // Nothing on the page follows a text change by writing variables on the root.
  root.style.setProperty = (name, value, priority) => {
    if (name.startsWith('--ww-')) counts.variables++;
    nativeSet(name, value, priority);
  };
  const controller = createPageController(
    document,
    createYouTubeAdapter(document, window),
    { assets: extensionAssets, takes: createTakeStorage('youtube') },
    () => counts.surfaces++,
  );
  const design: DesignDocument = {
    ...emptyDesign('youtube', null),
    rules: [{ kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#c9d4e8', borderRadiusPx: 8 } }],
  };
  controller.updateDesign(design);
  controller.update({ ...DEFAULT_SETTINGS, enabled: true });
  const clock = document.createElement('span');
  clock.id = 'page-change-clock';
  clock.textContent = '0:10';
  (document.querySelector('#movie_player') ?? document.body).append(clock);
  return {
    counts,
    controller,
    design,
    reset() {
      for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0;
    },
    async mutate(steps: number) {
      for (let index = 0; index < steps; index++) {
        clock.firstChild!.nodeValue = index % 2 ? '0:10' : '0:11';
        // Include both the adapter's flush and any renderer RAF it schedules.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      return { ...counts };
    },
    destroy() {
      controller.destroy();
      root.style.setProperty = nativeSet;
    },
  };
}
