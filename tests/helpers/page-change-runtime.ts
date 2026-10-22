import { createYouTubeAdapter } from '../../src/sites/youtube';
import { createThemeController } from '../../src/themes/controller';
import { retroTheme } from '../../src/themes/retro';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { emptyDesign } from '../../src/design/schema';
import type { DesignDocument } from '../../src/design/types';

export function mount() {
  const counts = { themeWrites: 0, variables: 0, compiles: 0, featureRefreshes: 0, surfaces: 0 };
  (globalThis as any).__pageChanges = counts;
  const root = document.documentElement,
    nativeSet = root.style.setProperty.bind(root.style),
    variableNames = new Set(['--ww-strength', ...Object.keys(retroTheme.variables(DEFAULT_SETTINGS))]);
  root.style.setProperty = (name, value, priority) => {
    if (variableNames.has(name)) counts.themeWrites++;
    nativeSet(name, value, priority);
  };
  const controller = createThemeController(
    document,
    createYouTubeAdapter(document, window),
    {
      ...retroTheme,
      variables(settings) {
        counts.variables++;
        return retroTheme.variables(settings);
      },
    },
    () => counts.surfaces++,
  );
  const design: DesignDocument = {
    ...emptyDesign('youtube', 'retro'),
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
