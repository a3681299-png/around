import { build } from 'esbuild';
import { test, expect } from './fixtures';

test('Timeline acknowledges reordered rules and Undo restores the displayed key value', async ({ context }) => {
  const page = await context.newPage();
  const bundle = await build({
    entryPoints: ['tests/helpers/timeline-state.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'TimelineStateTest',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.evaluate(() => (globalThis as any).TimelineStateTest.mount(document));
  const timeline = page.locator('.signal-timeline'),
    value = timeline.locator('.timeline-key-value');
  await timeline.locator('.timeline-toggle').click();
  await timeline.locator('[data-key-id="key-middle"]').click();
  await expect(value).toHaveValue('100');
  await value.fill('80');
  await value.press('Tab');
  await expect(value).toHaveValue('80');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(value).toHaveValue('100');
});
