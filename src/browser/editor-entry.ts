import { watchSettings } from '../storage/settings';
import { OPEN_SIDE_PANEL_TOOLS, PROBE_EDITOR_TARGET, PREPARE_SIDE_PANEL } from '../editor/messages';
import { EMERGENCY_COMMAND, SAFETY_SHORTCUT, safetyShortcut, setEmergencyOff } from '../storage/safety';

export const EDITOR_COMMAND = 'open-editor';
/** action/commands callbacks retain their user gesture: no storage read precedes open(). */
export function installEditorEntry() {
  const approvedTabs = new Set<number>(),
    navigations = new Map<number, number>();
  const onUpdated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
    if (change.status === 'loading') {
      approvedTabs.delete(id);
      navigations.set(id, (navigations.get(id) ?? 0) + 1);
    }
  };
  const onRemoved = (id: number) => {
    approvedTabs.delete(id);
    navigations.set(id, (navigations.get(id) ?? 0) + 1);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  const standalone = (tabId?: number) =>
    chrome.windows.create({
      url: chrome.runtime.getURL('studio/index.html') + (tabId === undefined ? '' : '?target=' + tabId),
      type: 'popup',
      width: 1440,
      height: 900,
    });
  const open = (tab?: chrome.tabs.Tab) => {
    // No Studio window for an unrelated tab; there is no supported edit target.
    if (
      !tab ||
      tab.status === 'loading' ||
      (tab.url && !/^https:\/\/www\.youtube\.com\/(?!embed\/|live_chat)/.test(tab.url))
    )
      return;
    // commands may omit sensitive tab.url without a tabs permission. Probe our
    // own content script; an unrelated tab has no authenticated edit endpoint.
    if (!tab.url && (tab.id === undefined || !approvedTabs.has(tab.id))) {
      if (tab.id === undefined) return;
      const generation = navigations.get(tab.id) ?? 0;
      void chrome.tabs
        .sendMessage(tab.id, { type: PROBE_EDITOR_TARGET })
        .then((reply) => {
          if (reply?.siteId === 'youtube' && (navigations.get(tab.id!) ?? 0) === generation)
            open({ ...tab, url: 'https://www.youtube.com/' });
        })
        .catch(() => undefined);
      return;
    }
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
    if (command === EMERGENCY_COMMAND) void setEmergencyOff(true);
    if (command === EDITOR_COMMAND) open(tab);
  };
  chrome.commands.onCommand.addListener(onCommand);
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, reply: (value: string) => void) => {
    if (
      sender.id === chrome.runtime.id &&
      sender.origin === 'https://www.youtube.com' &&
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === PREPARE_SIDE_PANEL
    ) {
      approvedTabs.add(sender.tab.id);
      return false; // The existing side-panel host owns the response.
    }
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== SAFETY_SHORTCUT
    )
      return false;
    void safetyShortcut().then(reply, () => reply(''));
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessage);
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
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
  };
}
