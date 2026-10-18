import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchExtension } from './fixtures';
import { sidePanelDriver, nativeWindow } from './helpers/side-panel';

async function setup() {
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-panel-test-')), true, { headed: true });
  const manager = await context.newPage(); await manager.goto('chrome://extensions/');
  const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' }); await item.waitFor();
  const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id); await manager.close();
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/index.html`);
  const page = await context.newPage(); await page.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await page.bringToFront();
  await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
  return { context, page, popup, id, local: page.locator('#web-world-themes-creator') };
}

test('native Chrome panel uses the same draft, group masks, selection, history, anchors and saved artwork', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await mkdir('.work/verification', { recursive: true });
    await local.getByLabel('画像素材を追加').setInputFiles(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
    await expect(local.locator('.layer')).toHaveCount(3); await local.locator('.select-all').click();
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.selected-count')).toBe('3個選択中');
    await expect(local).toHaveAttribute('data-page-toolbar', ''); await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
    await expect.poll(() => panel.evaluate('innerWidth')).toBeGreaterThan(250);
    await expect.poll(() => panel.evaluate('chrome.storage.session.get(null).then(xs=>Object.values(xs).some(v=>v?.draft?.decorations?.length===3))')).toBe(true);
    // Isolated fixture only: reproduce a delayed empty recovery write. The live
    // page's lease must continue protecting bytes, even without a recovery pin.
    const retained = await panel.evaluate<boolean>(`(async()=>{
      const target=Number(new URL(location.href).searchParams.get('target'));
      const checkpoint=(await chrome.storage.session.get('webWorldThemes.studio.session.'+target))['webWorldThemes.studio.session.'+target];
      const id=checkpoint.draft.decorations[0].assetId;
      await chrome.runtime.sendMessage({type:'web-world-themes:assets',action:'lease',session:'session-studio-'+target+'-'+target,ownerTabId:target,ids:[]});
      return (await chrome.runtime.sendMessage({type:'web-world-themes:assets',action:'get',id})).ok;
    })()`); expect(retained).toBe(true);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1200); const width = await page.evaluate(() => innerWidth);
    await panel.click('.group-layers'); await expect.poll(() => panel.evaluate('document.querySelector("#web-world-themes-creator").shadowRoot.querySelectorAll(".layer[data-kind=group]").length')).toBe(1);
    await panel.click('[data-effect="enabled"]');
    await expect(page.locator('#web-world-themes-decorations .group-content')).toHaveCSS('mask-image', /radial-gradient/);
    await panel.screenshot('.work/verification/sidepanel-fixture.png');
    const groupX = await panel.evaluate('document.querySelector("#web-world-themes-creator").shadowRoot.querySelector("[data-image-prop=x]").value');
    const first = page.locator('#web-world-themes-decorations [data-image-id]').first(); const before = (await first.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 10, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x + 30, 0);
    await expect.poll(() => panel.evaluate('document.querySelector("#web-world-themes-creator").shadowRoot.querySelector("[data-image-prop=x]").value')).not.toBe(groupX);
    await panel.click('.undo'); await expect.poll(async () => ({ x: Math.round((await first.boundingBox())!.x), status: await panel.text('.status'), error: await panel.evaluate('document.querySelector(".connection-status").textContent') })).toMatchObject({ x: Math.round(before.x) });
    await panel.click('.redo'); await panel.click('.save'); await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await nativeWindow(panel.cdp, 1920); await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(width);
    const stored = await popup.evaluate(async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube']);
    expect((stored as { schemaVersion: number }).schemaVersion).toBe(7);
    await page.reload(); await expect.poll(() => panel.text('.dirty')).toBe('保存済み'); await expect(page.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(3);
    await panel.click('.close', false); await expect(page.locator('[data-ww-editing]')).toHaveCount(0); await expect(local).toHaveCount(0); await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1750);
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
  } finally { await context.close(); }
});

test('side panel and standalone hand off unsaved Undo and asset leases, while targets stay isolated', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]); await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.fill('[data-image-prop="rotationDeg"]', '20'); await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更');
    await expect.poll(() => panel.evaluate('document.querySelector(".recovery-status").textContent')).toBe('');
    await expect.poll(async () => ({ retained: await popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).some((key) => key.startsWith('webWorldThemes.studio.session.'))), status: await panel.evaluate('document.querySelector(".recovery-status").textContent'), contexts: await panel.evaluate('chrome.runtime.getContexts({}).then(xs=>xs.map(x=>({type:x.contextType,doc:x.documentId,tab:x.tabId})))') })).toMatchObject({ retained: true, status: '' });
    await page.reload(); await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更'); await expect(page.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(1);
    const opened = context.waitForEvent('page'); await panel.click('[aria-label="独立Studioへ切替"]', false);
    const standalone = await opened; await standalone.setViewportSize({ width: 1440, height: 900 });
    await expect(standalone.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    const shared = standalone.locator('#web-world-themes-creator'); await expect(shared.locator('.dirty')).toHaveText('未保存の変更');
    await shared.locator('.undo').click(); await expect(shared.locator('[data-image-prop="rotationDeg"]')).toHaveValue('0');
    await shared.locator('.redo').click(); await expect(shared.locator('[data-image-prop="rotationDeg"]')).toHaveValue('20');
    await page.bringToFront(); await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const next = await sidePanelDriver(context, page, id); await expect.poll(() => next.text('.dirty')).toBe('未保存の変更');
    await expect(standalone.locator('.connection-status')).toContainText('引き継ぎ'); await expect(standalone.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
    await next.click('[aria-label="従来のインページStudioへ切替"]', false); await expect(local).toHaveAttribute('data-inpage', ''); await expect(local.locator('.dirty')).toHaveText('未保存の変更');
    await local.locator('.undo').click(); await expect(local.locator('[data-image-prop="rotationDeg"]')).toHaveValue('0');
    await local.locator('.discard').click(); await expect(page.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(0);
    await popup.locator('#effect-strength').fill('0'); await expect(local).toHaveCount(0); await expect(page.locator('#web-world-themes-decorations')).toHaveCount(0);
  } finally { await context.close(); }
});


test('tab-specific panels isolate drafts and recovery; floating tools yield to native video controls', async () => {
  test.setTimeout(120_000);
  const { context, page, popup, id, local } = await setup();
  try {
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const first = await sidePanelDriver(context, page, id);
    await expect.poll(() => first.text('.dirty')).toBe('保存済み'); await first.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => first.text('.selected-count')).toBe('1個選択中'); await first.fill('.layer-name', '最初のタブ');
    const secondPage = await context.newPage(); await secondPage.goto('https://www.youtube.com/watch?v=second'); await secondPage.bringToFront();
    const target = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!);
    await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
    const secondLocal = secondPage.locator('#web-world-themes-creator'); await secondLocal.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const second = await sidePanelDriver(context, secondPage, id, target); await expect.poll(() => second.text('.dirty')).toBe('保存済み');
    await second.files([path.resolve('tests/fixtures/motion/petal.png')]); await expect.poll(() => second.text('.selected-count')).toBe('1個選択中'); await second.fill('.layer-name', '次のタブ');
    await expect.poll(() => popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith('webWorldThemes.studio.session.')).length)).toBe(2);
    await expect.poll(() => second.evaluate('document.querySelector(".recovery-status").textContent')).toBe('');
    await page.reload(); await expect.poll(() => first.text('.dirty')).toBe('未保存の変更'); await expect.poll(() => first.text('.layer-title')).toBe('最初のタブ'); await expect.poll(() => second.text('.layer-title')).toBe('次のタブ');
    await secondPage.bringToFront();
    await secondPage.locator('#movie_player .ytp-chrome-bottom').evaluate((node: HTMLElement) => { node.style.cssText = 'position:fixed;bottom:32px;left:12px;width:500px;height:32px;'; });
    await expect(secondLocal).toHaveAttribute('data-native-overlap', ''); await expect(secondLocal).not.toBeVisible();
    await secondPage.locator('#movie_player .ytp-chrome-bottom').evaluate((node: HTMLElement) => node.removeAttribute('style'));
    await expect(secondLocal).not.toHaveAttribute('data-native-overlap', ''); await expect(secondLocal).toBeVisible();
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    for (const targetPage of [page, secondPage]) { await expect(targetPage.locator('[data-ww-editing]')).toHaveCount(0); await expect(targetPage.locator('#web-world-themes-decorations')).toHaveCount(0); }
  } finally { await context.close(); }
});
