import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { sidePanelDriver } from './helpers/side-panel';
import { installEditorEntry } from '../src/browser/editor-entry';

test('the actual action handler opens S synchronously and falls back to W only on rejection', async () => {
  const originalChrome = globalThis.chrome;
  let action: ((tab?: chrome.tabs.Tab) => void) | undefined,
    rejectPanel = false;
  const opened: number[] = [],
    windows: unknown[] = [];
  const event = () => ({ addListener() {}, removeListener() {} });
  globalThis.chrome = {
    action: {
      onClicked: {
        ...event(),
        addListener(listener: typeof action) {
          action = listener;
        },
      },
      setPopup: async () => {},
    },
    commands: { onCommand: event() },
    runtime: { onMessage: event(), getURL: (file: string) => 'chrome-extension://test/' + file },
    tabs: { onUpdated: event(), onRemoved: event() },
    storage: { onChanged: event(), local: { get: async () => ({}) } },
    sidePanel: {
      open: async ({ tabId }: { tabId: number }) => {
        opened.push(tabId);
        if (rejectPanel) throw Error('No S');
      },
    },
    windows: {
      create: async (options: unknown) => {
        windows.push(options);
        return {};
      },
    },
  } as unknown as typeof chrome;
  const cleanup = installEditorEntry();
  try {
    const tab = { id: 117, status: 'complete', url: 'https://www.youtube.com/watch?v=fixture' } as chrome.tabs.Tab;
    action!(tab);
    // A storage await before open would lose Chrome's activation. The call must already exist.
    expect(opened).toEqual([117]);
    await Promise.resolve();
    expect(windows).toEqual([]);
    rejectPanel = true;
    action!(tab);
    await expect.poll(() => windows.length).toBe(1);
    expect(opened).toEqual([117, 117]);
    expect(windows).toEqual([
      { url: 'chrome-extension://test/studio/index.html?target=117', type: 'popup', width: 1440, height: 900 },
    ]);
    action!({ ...tab, url: 'https://example.com/' });
    expect(opened).toEqual([117, 117]);
    expect(windows).toHaveLength(1);
  } finally {
    cleanup();
    if (originalChrome) globalThis.chrome = originalChrome;
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

function transport(action: 'close-without-reply' | 'error') {
  let targetAlive = true,
    commands = 0;
  let receive: ((event: { sessionId: string; message: string }) => void) | undefined;
  const cdp = {
    on(_event: string, listener: typeof receive) {
      receive = listener;
    },
    async detach() {},
    async send(method: string, params?: Record<string, any>) {
      if (method === 'Target.getTargets')
        return {
          targetInfos: targetAlive
            ? [
                {
                  targetId: 'native-panel',
                  attached: false,
                  url: 'chrome-extension://test/studio/index.html?surface=sidepanel',
                },
              ]
            : [],
        };
      if (method === 'Target.attachToTarget') return { sessionId: 'panel-session' };
      if (method !== 'Target.sendMessageToTarget') throw new Error('Unexpected transport method');
      const request = JSON.parse(params!.message);
      commands++;
      const click = request.params.expression.includes('.click()');
      if (click && action === 'close-without-reply') {
        targetAlive = false; // Chrome closes the target before sending a Runtime result.
        return {};
      }
      queueMicrotask(() =>
        receive?.({
          sessionId: 'panel-session',
          message: JSON.stringify({
            id: request.id,
            result:
              click && action === 'error'
                ? { exceptionDetails: { text: 'action failed', exception: { description: 'test action failure' } } }
                : { result: { value: undefined } },
          }),
        }),
      );
      return {};
    },
  };
  return {
    context: { newCDPSession: async () => cdp } as unknown as BrowserContext,
    get targetAlive() {
      return targetAlive;
    },
    get commands() {
      return commands;
    },
  };
}
test('handoff waits for target closure even when Chrome discards the click Runtime reply', async () => {
  const wire = transport('close-without-reply');
  const panel = await sidePanelDriver(wire.context, {} as Page, 'test');
  await panel.clickAndLeave('.handoff');
  expect(wire.targetAlive).toBe(false);
  expect(wire.commands).toBe(3); // Ready state, control availability, then the one action.
  await panel.detach();
});
test('ordinary panel actions still reject Runtime exceptions', async () => {
  const wire = transport('error');
  const panel = await sidePanelDriver(wire.context, {} as Page, 'test');
  await expect(panel.click('.ordinary')).rejects.toThrow('test action failure');
  expect(wire.targetAlive).toBe(true);
  await panel.detach();
});
