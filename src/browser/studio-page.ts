import { mountStudio } from '../studio/app';
import { createStudioClient } from './studio-client';
import { createStudioRecovery } from './studio-recovery';
import { browserStudioPreferences } from './preferences';
import { mountEditorSafety } from '../settings/safety-controls';
import { skinAssetPort } from './skin-assets';
import { closeOwnSidePanel } from './side-panel';
import tokens from '../editor/studio-tokens.css';

// The page around the editor wears the same tokens as the editor's shadow root. They are declared
// for :host there; here the page itself is the host.
const pageTokens = document.createElement('style');
pageTokens.textContent = tokens.replaceAll(':host', ':root');
document.head.append(pageTokens);

async function start() {
  const params = new URL(location.href).searchParams,
    sidePanel = params.get('surface') === 'sidepanel';
  const value = params.get('target');
  const target = value && /^\d+$/.test(value) ? Number(value) : undefined;
  const tab = sidePanel ? { id: target } : await chrome.tabs.getCurrent();
  if (tab?.id === undefined) throw new Error('エディターのタブを取得できません。');
  // Each preview URL lives until the Studio page closes.
  const skinPreviews = new Map<string, Promise<string | undefined>>();
  const app = mountStudio(document, document.querySelector<HTMLElement>('#studio')!, {
    hostName: 'YouTube',
    mountSafety: mountEditorSafety,
    sidePanel,
    ...(sidePanel ? { closePanel: () => closeOwnSidePanel(tab.id!) } : {}),
    connect: (notify, checkpoint) => createStudioClient(notify, checkpoint, sidePanel ? document : undefined),
    recovery: createStudioRecovery(tab.id),
    preferences: browserStudioPreferences,
    // The extension page reads skin art from its own asset store, like the page renderer does.
    skinAssetUrl(assetId) {
      let url = skinPreviews.get(assetId);
      if (!url) {
        url = skinAssetPort.load(assetId).catch(() => {
          skinPreviews.delete(assetId);
          return undefined;
        });
        skinPreviews.set(assetId, url);
      }
      return url;
    },
    openSettings: (target) => {
      void chrome.windows.create({
        url: chrome.runtime.getURL('popup/index.html') + (target === undefined ? '' : '?target=' + target),
        type: 'popup',
        width: 420,
        height: 900,
      });
    },
  });
  document.body.toggleAttribute('data-sidepanel', sidePanel);
  await app.start(target);
  window.addEventListener('pagehide', () => app.destroy(), { once: true });
}
void start().catch((error: unknown) => {
  document.querySelector('#studio')!.textContent =
    error instanceof Error ? error.message : 'エディターを起動できませんでした。';
});
