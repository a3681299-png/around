import { getSiteAdapter } from '../sites';
import { oneOf } from '../validation';
import { watchSettings } from '../storage/settings';
import { DEFAULT_THEME, themes } from '../themes';
import { createThemeController } from '../themes/controller';
import { createSettingsPanel } from '../settings/panel';
import { createCreatorEditor, type CreatorEditor } from '../editor/controller';
import {
  OPEN_CREATOR_EDITOR,
  OPEN_INPAGE_STUDIO,
  OPEN_SIDE_PANEL_TOOLS,
  PREPARE_SIDE_PANEL,
  PROBE_EDITOR_TARGET,
} from '../editor/messages';
import type { UserSettings } from '../storage/settings';
import { connectStudioHost } from '../browser/studio-host';
import { ASSET_PROFILE } from '../diagnostics/asset-profile';
import { installAssetRuntimeHost } from '../diagnostics/asset-runtime-host';
import { createAssetReadHost } from '../browser/asset-read-host';
import { requestStudioSurface } from '../browser/side-panel';
import { OPEN_SIDE_PANEL } from '../editor/messages';
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
    () => settingsPanel.open(),
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
  const unwatchEmergency = watchEmergencyOff((value) => controller.suspend(value));
  void chrome.runtime.sendMessage({ type: PREPARE_SIDE_PANEL }).catch(() => undefined);
  const settingsPanel = createSettingsPanel(document, () => {
    void requestStudioSurface(OPEN_SIDE_PANEL).catch((error: unknown) => {
      settingsPanel.open();
      settingsPanel.panel.shadowRoot!.querySelector('#save-status')!.textContent =
        error instanceof Error ? error.message : 'エディターを開けませんでした。';
    });
  });
  // The settings entry stays available independently of the theme's ON/OFF state.
  const unmountSettings = site.mountSettings(settingsPanel);
  const reportError = (error: unknown) => {
    controller.destroy();
    creator?.setEnabled(false);
    console.error('[Web World Themes] 設定を読み込めませんでした。', error);
  };
  const update = (settings: UserSettings) => {
    controller.update(settings);
    creator?.setEnabled(settings.enabled && settings.strength > 0);
  };
  let unwatch = watchSettings(update, reportError);
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      !oneOf(message.type, [OPEN_CREATOR_EDITOR, OPEN_INPAGE_STUDIO, OPEN_SIDE_PANEL_TOOLS, PROBE_EDITOR_TARGET])
    )
      return false;
    if (message.type === PROBE_EDITOR_TARGET) {
      respond({ siteId: site.id });
      return false;
    }
    respond(
      message.type === OPEN_SIDE_PANEL_TOOLS
        ? creator?.openSidePanel()
        : message.type === OPEN_INPAGE_STUDIO
          ? creator?.openStudio()
          : creator?.open(),
    );
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
    disconnectStudio();
    creator?.destroy();
    controller.destroy();
    for (const url of previewUrls.values()) void url.then((value) => value && skinAssetPort.revoke(value));
    previewUrls.clear();
    assetReader.destroy();
  };
}
