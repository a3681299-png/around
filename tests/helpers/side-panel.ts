import type { BrowserContext, Page, CDPSession } from '@playwright/test';
import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

/** Chrome's real panel WebContents is not a tab in Playwright. Use public CDP. */
export async function sidePanelDriver(context: BrowserContext, page: Page, extensionId: string, targetTab?: number) {
  const cdp = await context.newCDPSession(page);
  let targetId = '';
  await expect.poll(async () => {
    const { targetInfos } = await cdp.send('Target.getTargets');
    targetId = targetInfos.find((target) => target.url.startsWith('chrome-extension://' + extensionId + '/studio/index.html?surface=sidepanel') && (targetTab === undefined || new URL(target.url).searchParams.get('target') === String(targetTab)))?.targetId ?? '';
    return targetId;
  }).not.toBe('');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let serial = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  cdp.on('Target.receivedMessageFromTarget', (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('Side panel CDP timeout: ' + method)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value as T;
  };
  const panel = 'document.querySelector("#web-world-themes-creator")?.shadowRoot';
  const query = (selector: string) => panel + '?.querySelector(' + JSON.stringify(selector) + ')';
  const settle = () => expect.poll(() => evaluate('document.querySelector("#web-world-themes-creator")?.getAttribute("aria-busy")')).not.toBe('true');
  return {
    evaluate, send, cdp,
    text(selector: string) { return evaluate<string>(query(selector) + '?.textContent'); },
    async click(selector: string, waitAfter = true) {
      await settle();
      // Panel WebContents is not a Playwright Page. Exercise the shared button's
      // DOM action with CDP user activation; real YouTube controls use mouse clicks.
      await evaluate(`(()=>{const n=${query(selector)};if(!n||n.disabled)throw Error('Unavailable: '+${JSON.stringify(selector)});n.click();})()`);
      if (waitAfter) await settle();
    },
    async fill(selector: string, value: string) { await settle(); await evaluate(`(()=>{const n=${query(selector)};n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`); await settle(); },
    async files(paths: string[]) {
      const { result } = await send('Runtime.evaluate', { expression: query('.file') });
      await send('DOM.setFileInputFiles', { objectId: result.objectId, files: paths });
      await send('Runtime.releaseObject', { objectId: result.objectId });
    },
    async screenshot(file: string) { const result = await send('Page.captureScreenshot'); await writeFile(file, Buffer.from(result.data, 'base64')); },
    async detach() { pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(new Error('Detached')); }); pending.clear(); await cdp.detach(); },
  };
}

export async function nativeWindow(cdp: CDPSession, width: number, height = 1000) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height, windowState: 'normal' } });
}
