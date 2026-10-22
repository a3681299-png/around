import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { sidePanelDriver } from './helpers/side-panel';

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
