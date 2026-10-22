import { watchSettings } from '../storage/settings';
import { OPEN_SIDE_PANEL_TOOLS } from '../editor/messages';

export const EDITOR_COMMAND = 'open-editor';
/** action/commands callbacks retain their user gesture: no storage read precedes open(). */
export function installEditorEntry() {
  const standalone = (tabId?: number) =>
    chrome.windows.create({
      url: chrome.runtime.getURL('studio/index.html') + (tabId === undefined ? '' : '?target=' + tabId),
      type: 'popup',
      width: 1440,
      height: 900,
    });
  const open = (tab?: chrome.tabs.Tab) => {
    const id = tab?.id;
    const operation =
      id === undefined
        ? standalone()
        : chrome.sidePanel
            .open({ tabId: id })
            .then(async () => {
              // Keep Studio visible when the theme is OFF; its settings entry remains usable.
              await chrome.tabs.sendMessage(id, { type: OPEN_SIDE_PANEL_TOOLS }).catch(() => undefined);
            })
            .catch(() => standalone(id));
    void operation.catch((error: unknown) => console.error('[Web World Themes] エディターを開けませんでした。', error));
  };
  chrome.action.onClicked.addListener(open);
  const onCommand = (command: string, tab?: chrome.tabs.Tab) => {
    if (command === EDITOR_COMMAND) open(tab);
  };
  chrome.commands.onCommand.addListener(onCommand);
  let last: boolean | undefined;
  const unwatch = watchSettings(
    (settings) => {
      if (settings.creatorMode === last) return;
      last = settings.creatorMode;
      void chrome.action.setPopup({ popup: settings.creatorMode ? '' : 'popup/index.html' }).catch((error: unknown) => {
        console.error('[Web World Themes] 起動先を変更できませんでした。', error);
      });
    },
    (error) => console.error('[Web World Themes] 起動設定を読み込めませんでした。', error),
  );
  return () => {
    unwatch();
    chrome.action.onClicked.removeListener(open);
    chrome.commands.onCommand.removeListener(onCommand);
  };
}
