import { oneOf } from '../validation';
import {
  CLOSE_SIDE_PANEL,
  OPEN_SIDE_PANEL,
  OPEN_SIDE_PANEL_TOOLS,
  OPEN_STUDIO_WINDOW,
  PREPARE_SIDE_PANEL,
  type OpenEditorResponse,
} from '../editor/messages';

/** Chrome-only composition. Configure before a gesture: awaiting setOptions can lose it. */
export function installSidePanelHost() {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !raw || typeof raw !== 'object' || !('type' in raw)) return false;
    if (!oneOf(raw.type, [PREPARE_SIDE_PANEL, OPEN_SIDE_PANEL, CLOSE_SIDE_PANEL, OPEN_STUDIO_WINDOW])) return false;
    const fromPage = sender.origin === 'https://www.youtube.com' && sender.frameId === 0;
    const extensionPage = sender.url?.split('?')[0];
    const trustedUI =
      extensionPage === chrome.runtime.getURL('popup/index.html') ||
      extensionPage === chrome.runtime.getURL('studio/index.html');
    if (!fromPage && !trustedUI) return false;
    const tabId = fromPage ? sender.tab?.id : (raw as { tabId?: unknown }).tabId;
    if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0) {
      respond({ ok: false, error: '編集対象のタブがありません。' });
      return false;
    }
    let operation: Promise<unknown>;
    if (raw.type === CLOSE_SIDE_PANEL) {
      operation = chrome.sidePanel
        .setOptions({ tabId, enabled: false })
        .then(() => chrome.sidePanel.setOptions({ tabId, enabled: true }));
    } else if (raw.type === PREPARE_SIDE_PANEL) {
      operation = chrome.sidePanel.setOptions({
        tabId,
        enabled: true,
        path: 'studio/index.html?surface=sidepanel&target=' + tabId,
      });
    } else if (raw.type === OPEN_SIDE_PANEL) {
      // No asynchronous work precedes open: retain the originating click's activation.
      operation = chrome.sidePanel.open({ tabId }).then(async () => {
        const result = await chrome.tabs.sendMessage<{ type: string }, OpenEditorResponse>(tabId, {
          type: OPEN_SIDE_PANEL_TOOLS,
        });
        // Studio itself explains an OFF theme and offers display settings. Keep
        // that entry usable instead of closing the only route back to settings.
        if (!result?.ok) return;
      });
    } else {
      operation = chrome.windows
        .create({
          url: chrome.runtime.getURL('studio/index.html') + '?target=' + tabId,
          type: 'popup',
          width: 1440,
          height: 900,
        })
        .then(() => chrome.sidePanel.setOptions({ tabId, enabled: false }))
        .then(() => chrome.sidePanel.setOptions({ tabId, enabled: true }));
    }
    void operation.then(
      () => respond({ ok: true }),
      (error: unknown) =>
        respond({ ok: false, error: error instanceof Error ? error.message : 'Studioを開けませんでした。' }),
    );
    return true;
  });
}

export async function requestStudioSurface(
  type: typeof OPEN_SIDE_PANEL | typeof OPEN_STUDIO_WINDOW,
  tabId?: number,
): Promise<void> {
  const result = (await chrome.runtime.sendMessage({
    type,
    ...(tabId === undefined ? {} : { tabId }),
  })) as OpenEditorResponse;
  if (!result?.ok) throw new Error(result?.error ?? 'Studioを開けませんでした。');
}
