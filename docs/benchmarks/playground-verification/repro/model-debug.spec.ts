import { test, expect } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openEditor, closeEditorPages } from '../../tests/helpers/editor';
import { waitForAdvertToEnd, declinePromotion } from '../../tests/helpers/youtube-live';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const url = 'https://www.youtube.com/watch?v=LC1a-DwUhls';
for (const [side, kind] of [
  ['after', 'normal'],
  ['after', 'probe'],
  ['before', 'probe'],
  ['before', 'normal'],
])
  test(`model reload diagnosis ${side} ${kind}`, async () => {
    test.setTimeout(240000);
    const label = `${side}-${kind}`,
      result: any = { side, kind, stages: [], console: [] };
    const context = await launchExtension(await mkdtemp(path.resolve('.work/md-')), false, {
      headed: true,
      width: 1920,
      height: 1241,
      extensionPath: path.resolve(`.work/model-debug-${label}`),
    });
    let page: any;
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
        id = new URL(worker.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeEnabled();
      page = await context.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });
      page.on('console', (m: any) => {
        if (m.type() === 'error') result.console.push(m.text());
      });
      page.on('pageerror', (e: any) => result.console.push(e.message));
      async function ready() {
        await expect(page.locator('#movie_player')).toBeVisible({ timeout: 45000 });
        await declinePromotion(page);
        await waitForAdvertToEnd(page);
        await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
      }
      async function state(stage: string) {
        result.stages.push({
          stage,
          html: await page.locator('html').evaluate((e: HTMLElement) => ({
            errors: e.getAttribute('data-verification-model-errors'),
            safety: e.getAttribute('data-around-safety'),
          })),
          media: await page
            .locator('.model-media')
            .evaluateAll((es: HTMLElement[]) =>
              es.map((e) => ({ ...e.dataset, visibility: getComputedStyle(e).visibility })),
            ),
          stats: await page
            .locator('[data-around-model-stats]')
            .evaluateAll((es: HTMLElement[]) => es.map((e) => e.dataset.aroundModelStats)),
        });
      }
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await ready();
      let edit = await openEditor(popup, page);
      await edit.panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
      await expect(edit.panel.locator('.layer')).toHaveCount(1);
      await edit.panel.locator('.save').click();
      await expect(edit.panel.locator('.dirty')).toHaveText('保存済み');
      await closeEditorPages(page);
      const search = page.getByRole('combobox', { name: /Search|検索/ });
      await search.fill('lofi hip hop');
      await search.press('Enter');
      await expect(page).toHaveURL(/results\?search_query/);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await ready();
      edit = await openEditor(popup, page);
      result.inputEnabled = await edit.panel.locator('.model-file').isEnabled();
      const manifest = JSON.parse(await readFile('.work/playground/content/manifest.json', 'utf8'));
      const file: any = Object.values(manifest.assets).find((e: any) => e.file.endsWith('.vrm'));
      await edit.panel.locator('.model-file').setInputFiles(path.resolve('.work/playground/content', file.file));
      await state('import');
      await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 30000 });
      await edit.panel.locator('[data-image-prop="widthPx"]').fill('210');
      await edit.panel.locator('[data-image-prop="heightPx"]').fill('280');
      await edit.panel.locator('[data-image-prop="anchor"]').selectOption('video-player');
      await edit.panel.locator('[data-image-prop="x"]').fill('75');
      await edit.panel.locator('[data-image-prop="y"]').fill('45');
      await edit.panel.locator('[data-image-prop="y"]').press('Tab');
      await edit.panel.locator('.save').click();
      await expect(edit.panel.locator('.dirty')).toHaveText('保存済み');
      await closeEditorPages(page);
      await state('saved');
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await ready();
      await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 30000 });
      await state('reload');
      result.completed = true;
    } finally {
      if (page && !page.isClosed()) {
        result.final = await page
          .evaluate(() => ({
            errors: document.documentElement.getAttribute('data-verification-model-errors'),
            url: location.href,
          }))
          .catch(() => null);
        await page.screenshot({ path: `.work/evidence/model-debug-${label}.png` }).catch(() => {});
      }
      await mkdir('.work/evidence', { recursive: true });
      await writeFile(`.work/evidence/model-debug-${label}.json`, JSON.stringify(result, null, 2));
      await context.close();
    }
  });
