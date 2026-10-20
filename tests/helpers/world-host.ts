import { build } from 'esbuild';
import path from 'node:path';
import type { Page, Locator } from '@playwright/test';
import { expect } from '../fixtures';

export const overlay = '#web-world-themes-decorations',
  media = `${overlay} .media`;
export async function isolate(page: Page, extensionId: string) {
  const session = await page.context().newCDPSession(page),
    contexts: { id: number; auxData?: { type?: string } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await session.send('Runtime.enable');
  let id: number | undefined;
  for (const context of contexts.filter((context) => context.auxData?.type === 'isolated')) {
    const result = await session.send('Runtime.evaluate', {
      contextId: context.id,
      expression: 'globalThis.chrome?.runtime?.id',
      returnByValue: true,
    });
    if (result.result.value === extensionId) {
      id = context.id;
      break;
    }
  }
  if (id === undefined) throw new Error('Extension isolated world not found');
  return {
    session,
    async evaluate<T>(expression: string): Promise<T> {
      const result = await session.send('Runtime.evaluate', {
        contextId: id,
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value as T;
    },
  };
}
export async function reinject(
  runtime: Awaited<ReturnType<typeof isolate>>,
  mode: 'legacy' | 'compare' | 'runtime',
  devtools: boolean,
) {
  const bundle = await build({
    entryPoints: ['src/content/index.ts'],
    bundle: true,
    write: false,
    target: 'chrome120',
    format: 'iife',
    loader: { '.css': 'text' },
    define: { __WW_WORLD_MODE__: JSON.stringify(mode), __WW_WORLD_DEVTOOLS__: String(devtools) },
    logLevel: 'silent',
  });
  await runtime.evaluate(bundle.outputFiles[0]!.text);
}
export async function open(popup: Page, page: Page): Promise<Locator> {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await page.bringToFront();
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.getByRole('dialog', { name: 'デザインエディター' });
  await expect(panel).toBeVisible();
  return panel;
}
export async function image(panel: Locator, page: Page) {
  await panel
    .getByLabel('画像素材を追加', { exact: true })
    .setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(page.locator(media)).toHaveAttribute('data-playback', 'still');
  await panel.getByRole('button', { name: 'プロパティを編集', exact: true }).click();
}
export async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
  await panel.getByRole('button', { name: '編集を終了' }).click();
}
export async function watch(page: Page) {
  await page.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-ww-surface~="player-window"]')).toBeVisible();
}
