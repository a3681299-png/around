import { expect, type Page, type CDPSession } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from '../fixtures';
import { vrmFixture } from './vrm-fixture';

export async function isolatedLab(page: Page, cdp: CDPSession, id: string) {
  const contexts: any[] = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  const checked = new Set<number>();
  for (let round = 0; round < 50; round++) {
    for (const c of contexts.filter((c) => c.auxData?.isDefault === false)) {
      if (checked.has(c.id)) continue;
      checked.add(c.id);
      const r = await cdp
        .send('Runtime.evaluate', {
          contextId: c.id,
          expression: 'typeof chrome!=="undefined"&&chrome.runtime?.id',
          returnByValue: true,
        })
        .catch(() => undefined);
      if (!r) continue;
      if (r.result.value !== id) continue;
      return async (method: string, ...args: unknown[]) => {
        const r = await cdp.send('Runtime.evaluate', {
          contextId: c.id,
          expression: `globalThis.wwAssetRuntimeHost[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
          returnByValue: true,
          awaitPromise: true,
        });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value as any;
      };
    }
    await page.waitForTimeout(100);
  }
  throw new Error('Isolated extension context missing: ' + page.url());
}

export async function openAssetLab(live = false, file?: string) {
  const context = await launchExtension(
    await mkdtemp(path.join(tmpdir(), 'ww-ar-lab-')),
    !live,
    live ? { headed: true, width: 1920, height: 1000 } : {},
  );
  try {
    const control = await context.newPage();
    await control.goto('chrome://extensions/');
    const item = control.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await control.goto(`chrome-extension://${id}/diagnostics/asset-runtime-lab.html`);
    await control
      .locator('#file')
      .setInputFiles(file ?? { name: 'original.vrm', mimeType: 'model/vrm', buffer: vrmFixture() });
    const asset = await control.evaluate(() => (globalThis as any).wwAssetLab.seed());
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await popup.getByRole('switch', { name: 'テーマを使う' }).check();
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    const tab = await control.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!,
    );
    const { session } = await control.evaluate(({ id, tab }) => (globalThis as any).wwAssetLab.open([id], tab), {
      id: asset.id,
      tab,
    });
    const cdp = await context.newCDPSession(page),
      call = await isolatedLab(page, cdp, id);
    await call('start', session);
    return { context, control, popup, page, cdp, call, asset, id, tab };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export function compactLabResult(result: Record<string, any>) {
  const spans = (result.spans ?? []).filter((s: any) => s.id === result.trace),
    stages: Record<string, number> = {};
  for (const s of spans) {
    const key = s.context + ':' + s.name;
    stages[key] = (stages[key] ?? 0) + s.durationMs;
  }
  const { spans: _spans, trace: _trace, ...rest } = result;
  return { ...rest, stages };
}
