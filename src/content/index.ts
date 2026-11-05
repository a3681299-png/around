import { getSiteAdapter } from '../sites';
import { oneOf } from '../validation';
import { watchSettings } from '../browser/settings-store';
import { createPageController } from '../host/page-controller';
import { createSettingsPanel } from '../settings/panel';
import { createCreatorEditor, type CreatorEditor } from '../editor/controller';
import { PREPARE_SIDE_PANEL, PROBE_EDITOR_TARGET } from '../editor/messages';
import type { UserSettings } from '../storage/settings';
import { connectStudioHost } from '../browser/studio-host';
import { ASSET_PROFILE } from '../diagnostics/asset-profile';
import { installAssetRuntimeHost } from '../diagnostics/asset-runtime-host';
import { createAssetReadHost } from '../browser/asset-read-host';
import { requestStudioSurface } from '../browser/side-panel';
import { OPEN_SIDE_PANEL, OPEN_STUDIO_WINDOW } from '../editor/messages';
import { watchEmergencyOff } from '../browser/safety-store';
import { skinAssetPort } from '../browser/skin-assets';
import { extensionAssets } from '../browser/asset-client';
import { createTakeStorage } from '../browser/take-storage';
import { G11_ENABLED, g11ExposeController } from '../diagnostics/g11-hooks';
import { pagePaintRegions, safePaintRegions } from '../world/operations';

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
  const controller = createPageController(
    document,
    site,
    { assets: extensionAssets, takes: createTakeStorage(site.id), skinAssets: skinAssetPort },
    () => creator?.refreshSelection(),
  );
  // Panel previews share the renderer's loader; each preview URL lives until the page unloads.
  const previewUrls = new Map<string, Promise<string | undefined>>();
  controller.suspend(true);
  creator = createCreatorEditor(
    document,
    site,
    // New artwork names no base theme (docs/theme-removal.md).
    null,
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
  // G1 measurement build only (folded away elsewhere): the harness's area and state checks.
  if (G11_ENABLED)
    g11ExposeController(controller, () => {
      const source = controller.safety?.source,
        snapshot = source?.capture();
      if (!source || !snapshot) return null;
      const pageSlot = source.pageSlot();
      return {
        snapshot,
        regions: safePaintRegions(snapshot, false),
        pageRegions: pageSlot ? pagePaintRegions(snapshot, false, { left: 0, top: 0, ...snapshot.viewport }) : [],
        pageSlot: Boolean(pageSlot),
        videoSlot: Boolean(source.videoSlot()),
        status: controller.safety!.snapshot().stopped,
      };
    });
  const disconnectStudio = connectStudioHost(document, site, creator, controller.safety);
  const unwatchEmergency = watchEmergencyOff((value) => {
    controller.suspend(value);
    creator?.suspendMarks(value);
  });
  void chrome.runtime.sendMessage({ type: PREPARE_SIDE_PANEL }).catch(() => undefined);
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
  // The settings entry stays available independently of the ON/OFF state.
  const unmountSettings = site.mountSettings(settingsPanel);
  const reportError = (error: unknown) => {
    controller.destroy();
    creator?.setEnabled(false);
    console.error('[Web World Themes] 設定を読み込めませんでした。', error);
  };
  const update = (settings: UserSettings) => {
    creatorMode = settings.creatorMode;
    controller.update(settings);
    creator?.setEnabled(settings.enabled);
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
    disconnectStudio();
    creator?.destroy();
    controller.destroy();
    for (const url of previewUrls.values()) void url.then((value) => value && skinAssetPort.revoke(value));
    previewUrls.clear();
    assetReader.destroy();
  };
}
