import { getSiteAdapter } from '../sites';
import { watchSettings } from '../storage/settings';
import { DEFAULT_THEME, themes } from '../themes';
import { createThemeController } from '../themes/controller';

// Lives in the isolated content-script world; reinjection leaves just one controller.
const lifetime = globalThis as typeof globalThis & {
  __webWorldThemesCleanup?: () => void;
};

const site = getSiteAdapter(document, window);
if (site) {
  lifetime.__webWorldThemesCleanup?.();
  const controller = createThemeController(document, site, themes[DEFAULT_THEME]);
  const reportError = (error: unknown) => {
    controller.destroy();
    console.error('[Web World Themes] 設定を読み込めませんでした。', error);
  };
  let unwatch = watchSettings(controller.update, reportError);
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    // A page restored from the back/forward cache must reread current settings.
    unwatch();
    unwatch = watchSettings(controller.update, reportError);
  };
  window.addEventListener('pageshow', onPageShow);
  lifetime.__webWorldThemesCleanup = () => {
    unwatch();
    window.removeEventListener('pageshow', onPageShow);
    controller.destroy();
  };
}
