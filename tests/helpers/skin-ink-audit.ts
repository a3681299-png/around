import type { BrowserContext, Page } from '@playwright/test';

export interface InkAudit {
  plans: number;
  mutations: number;
  frames: number;
  exposedFrames: number;
  events: { at: number; old: string | null; present: boolean }[];
}

/** Observe the root without changing the extension's isolated-world prototypes. */
export async function monitorInk(page: Page) {
  await page.evaluate(() => {
    const audit: InkAudit = { plans: 0, mutations: 0, frames: 0, exposedFrames: 0, events: [] };
    (window as typeof window & { __inkAudit: InkAudit }).__inkAudit = audit;
    const root = document.documentElement;
    new MutationObserver((records) => {
      for (const record of records) {
        audit.mutations++;
        if (record.oldValue === null) audit.plans++;
        audit.events.push({
          at: performance.now(),
          old: record.oldValue,
          present: root.hasAttribute('data-around-ink-off'),
        });
      }
    }).observe(root, { attributes: true, attributeOldValue: true, attributeFilter: ['data-around-ink-off'] });
    const sample = () => {
      audit.frames++;
      if (root.hasAttribute('data-around-ink-off')) audit.exposedFrames++;
      if (audit.frames < 36000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

export const inkAudit = (page: Page) =>
  page.evaluate(() => (window as typeof window & { __inkAudit: InkAudit }).__inkAudit);

export const nativeObserverAudit = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as typeof window & {
          __nativeInkObservers?: { rootCallbacks: number; records: number; stacks: string[] };
        }
      ).__nativeInkObservers,
  );

/** Installed before YouTube scripts. Preserve callback `this`, records and observer identity. */
export async function monitorSiteObservers(context: BrowserContext) {
  await context.addInitScript(() => {
    const audit = { rootCallbacks: 0, records: 0, stacks: [] as string[] };
    (window as typeof window & { __nativeInkObservers: typeof audit }).__nativeInkObservers = audit;
    const Native = MutationObserver;
    window.MutationObserver = class extends Native {
      constructor(callback: MutationCallback) {
        const stack = new Error().stack ?? '';
        super((records, observer) => {
          const ink = records.filter(
            (record) => record.target === document.documentElement && record.attributeName === 'data-around-ink-off',
          );
          if (ink.length && stack.includes('youtube.com/s/')) {
            audit.rootCallbacks++;
            audit.records += ink.length;
            if (!audit.stacks.includes(stack)) audit.stacks.push(stack);
          }
          callback.call(observer, records, observer);
        });
      }
    };
  });
}

/** Count presentation opportunities, keeping native timers and performance.now live. */
export async function presentedFrames(page: Page, count = 60) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let remaining = count;
        const frame = () => {
          if (--remaining === 0) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    count,
  );
}
