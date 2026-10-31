import { getSiteAdapter } from '../sites';
import { oneOf } from '../validation';
import { watchSettings } from '../storage/settings';
import { DEFAULT_THEME, themes } from '../themes';
import { createThemeController } from '../themes/controller';
import { createSettingsPanel } from '../settings/panel';
import { mountPixelFont } from '../ui/pixel-font';
import { createCreatorEditor, type CreatorEditor } from '../editor/controller';
import { PREPARE_SIDE_PANEL, PROBE_EDITOR_TARGET } from '../editor/messages';
import type { UserSettings } from '../storage/settings';
import { connectStudioHost } from '../browser/studio-host';
import { ASSET_PROFILE } from '../diagnostics/asset-profile';
import { installAssetRuntimeHost } from '../diagnostics/asset-runtime-host';
import { createAssetReadHost } from '../browser/asset-read-host';
import { requestStudioSurface } from '../browser/side-panel';
import { OPEN_SIDE_PANEL, OPEN_STUDIO_WINDOW } from '../editor/messages';
import { watchEmergencyOff } from '../storage/safety';
import { skinAssetPort } from '../browser/skin-assets';

if (ASSET_PROFILE) installAssetRuntimeHost(document);

// Lives in the isolated content-script world; reinjection leaves just one controller.
const lifetime = globalThis as typeof globalThis & {
  __webWorldThemesCleanup?: () => void;
};

const site = getSiteAdapter(document, window);
if (site) {
  lifetime.__webWorldThemesCleanup?.();
  const assetReader = createAssetReadHost(document);
  let creator: CreatorEditor | undefined;
  const controller = createThemeController(
    document,
    site,
    themes[DEFAULT_THEME],
    () => creator?.refreshSelection(),
    skinAssetPort,
  );
  // Panel previews share the renderer's loader; each preview URL lives until the page unloads.
  const previewUrls = new Map<string, Promise<string | undefined>>();
  controller.suspend(true);
  creator = createCreatorEditor(
    document,
    site,
    DEFAULT_THEME,
    controller.updateDesign,
    controller.setImageEditing,
    controller.validateDesign,
    controller.timeline,
    {
      status: controller.skinAssetStatus,
      previews: controller.setSkinPreviews,
      ink: controller.skinInkStatus,
      url(assetId) {
        let url = previewUrls.get(assetId);
        if (!url) {
          url = skinAssetPort.load(assetId).catch(() => {
            previewUrls.delete(assetId);
            return undefined;
          });
          previewUrls.set(assetId, url);
        }
        return url;
      },
    },
  );
  const disconnectStudio = connectStudioHost(document, site, creator, controller.safety);
  const unwatchEmergency = watchEmergencyOff((value) => {
    controller.suspend(value);
    creator?.suspendMarks(value);
  });
  void chrome.runtime.sendMessage({ type: PREPARE_SIDE_PANEL }).catch(() => undefined);
  // The retro theme's window chrome and LCD clock use the packaged pixel face (the settings panel,
  // which used to load it, now wears the WWT Studio system).
  const unmountFont = mountPixelFont(document);
  let creatorMode = false;
  // The side panel first; where Chrome will not open it, the editor's own window.
  const settingsPanel = createSettingsPanel(document, {
    open(surface) {
      // The side panel request goes first and at once: Chrome opens it only within the click.
      const opened =
        surface === 'window'
          ? requestStudioSurface(OPEN_STUDIO_WINDOW)
          : requestStudioSurface(OPEN_SIDE_PANEL).catch(() => requestStudioSurface(OPEN_STUDIO_WINDOW));
      void opened.catch((error: unknown) =>
        settingsPanel.report(error instanceof Error ? error.message : 'エディターを開けませんでした。'),
      );
    },
    creatorMode: () => creatorMode,
  });
  // The settings entry stays available independently of the theme's ON/OFF state.
  const unmountSettings = site.mountSettings(settingsPanel);
  const reportError = (error: unknown) => {
    controller.destroy();
    creator?.setEnabled(false);
    console.error('[Web World Themes] 設定を読み込めませんでした。', error);
  };
  const update = (settings: UserSettings) => {
    creatorMode = settings.creatorMode;
    controller.update(settings);
    creator?.setEnabled(settings.enabled && settings.strength > 0);
  };
  let unwatch = watchSettings(update, reportError);
  // The page answers one question from the extension: whether it is an edit target. The editor
  // itself is the side panel or its window, which connects through the Studio port.
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      !oneOf(message.type, [PROBE_EDITOR_TARGET])
    )
      return false;
    respond({ siteId: site.id });
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    // A page restored from the back/forward cache must reread current settings.
    unwatch();
    unwatch = watchSettings(update, reportError);
    creator?.reload();
    void chrome.runtime.sendMessage({ type: PREPARE_SIDE_PANEL }).catch(() => undefined);
  };
  window.addEventListener('pageshow', onPageShow);
  lifetime.__webWorldThemesCleanup = () => {
    unwatch();
    unwatchEmergency();
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener('pageshow', onPageShow);
    unmountSettings();
    settingsPanel.destroy();
    unmountFont();
    disconnectStudio();
    creator?.destroy();
    controller.destroy();
    for (const url of previewUrls.values()) void url.then((value) => value && skinAssetPort.revoke(value));
    previewUrls.clear();
    assetReader.destroy();
  };
}
