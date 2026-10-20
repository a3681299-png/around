import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openAssetLab, compactLabResult } from './helpers/asset-runtime-lab';

test('opt-in resident iframe uses IDB, rejects page messages and reconnects with new generations', async () => {
  test.skip(process.env.WW_ASSET_LAB_TEST !== '1', 'Explicit profiling build only'); test.setTimeout(180000);
  const lab = await openAssetLab();
  try {
    const result = await lab.call('show', 'resident', lab.asset.id, 3); expect(result.alphaPixels).toBeGreaterThan(100); expect(result.stats.instances).toBe(3); expect(result.binaryBytes).toBe(0);
    expect(await lab.page.locator('#ww-asset-runtime-lab').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    const invalid = await lab.control.evaluate(async () => chrome.runtime.sendMessage({ type: 'ww.asset-runtime.lab.v1', action: 'claim', ticket: 'forged' })); expect(invalid.ok).toBe(false);
    let generation = result.generation;
    for (let n = 0; n < 5; n++) { const r = await lab.call('restart'); expect(r.alphaPixels).toBeGreaterThan(100); expect(r.generation).toBeGreaterThan(generation); generation = r.generation; }
    for (let n = 0; n < 5; n++) {
      await lab.page.locator('#ww-asset-runtime-lab').evaluate((f: HTMLIFrameElement) => { f.src = f.src; });
      await expect.poll(async () => (await lab.call('state')).generation).toBeGreaterThan(generation);
      await expect.poll(() => lab.page.frameLocator('#ww-asset-runtime-lab').locator('canvas').count()).toBeGreaterThan(0);
      generation = (await lab.call('state')).generation;
    }
    await lab.page.locator('#movie_player').evaluate((e: HTMLElement) => e.requestFullscreen());
    await expect.poll(async () => (await lab.call('state')).generation).toBeGreaterThan(generation);
    await expect.poll(() => lab.page.frameLocator('#ww-asset-runtime-lab').locator('canvas').count()).toBeGreaterThan(0);
    await lab.page.evaluate(() => document.exitFullscreen());
    await lab.call('clear'); await expect(lab.page.frameLocator('#ww-asset-runtime-lab').locator('canvas')).toHaveCount(0);
    await lab.popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(lab.page.locator('#ww-asset-runtime-lab')).toHaveCount(0);
  } finally { await lab.context.close(); }
});

test('opt-in resident benchmark: private original, five reloads and fullscreen reconnections', async () => {
  test.skip(process.env.WW_ASSET_RESIDENT_LIVE !== '1' || !process.env.WW_VRM_FILE, 'Explicit real-site/private-file benchmark'); test.setTimeout(600000);
  const lab = await openAssetLab(true, process.env.WW_VRM_FILE), report: Record<string, any> = { browser: lab.context.browser()?.version(), bytes: lab.asset.byteLength, actualVrmVersion: lab.asset.model.vrm.version, resident: [], reconnect: [] };
  const persist = async () => { await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/asset-runtime-resident.json', JSON.stringify(report, null, 2)); };
  try {
    await lab.page.locator('video').first().evaluate((v: HTMLVideoElement) => v.pause());
    for (let n = 0; n < 5; n++) { const r = await lab.call('show', 'resident', lab.asset.id); expect(r.alphaPixels).toBeGreaterThan(1000); report.resident.push({ trial: n + 1, cache: n ? 'warm-process-fresh-model' : 'first-renderer', ...compactLabResult(r) }); await persist(); }
    for (let n = 0; n < 5; n++) { const started = performance.now(), r = await lab.call('restart'); report.reconnect.push({ trial: n + 1, reconnectMs: performance.now() - started, ...compactLabResult(r) }); await persist(); }
    await lab.page.locator('#movie_player').hover(); await lab.page.locator('.ytp-settings-button').click(); report.settingsClickable = await lab.page.locator('.ytp-settings-menu').isVisible(); await lab.page.locator('.ytp-settings-button').click();
    report.fullscreen = [];
    for (let n = 0; n < 5; n++) {
      await lab.page.locator('.ytp-fullscreen-button').click(); await expect.poll(() => lab.page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      report.fullscreen.push(await lab.page.evaluate(() => ({ inside: document.fullscreenElement!.contains(document.querySelector('#ww-asset-runtime-lab')), element: document.fullscreenElement!.tagName })));
      await lab.page.evaluate(() => document.exitFullscreen());
    }
    report.permissions = await lab.control.evaluate(() => chrome.runtime.getManifest().permissions); await persist();
  } catch (error) { report.failure = String(error); await persist(); throw error; }
  finally { await lab.context.close(); }
});

test('opt-in binary route transfers actual model ownership and preserves pixels', async () => {
  test.skip(process.env.WW_ASSET_LAB_TEST !== '1', 'Explicit profiling build only'); test.setTimeout(120000);
  const lab = await openAssetLab();
  try {
    const resident = await lab.call('show', 'resident', lab.asset.id);
    const binary = await lab.call('show', 'binary', lab.asset.id);
    const chunks = await lab.call('show', 'chunks', lab.asset.id);
    expect(binary.alphaPixels).toBe(resident.alphaPixels); expect(chunks.alphaPixels).toBe(resident.alphaPixels);
    expect(binary.binaryBytes).toBe(lab.asset.byteLength); expect(binary.senderDetached).toBe(true);
    expect(binary.spans.some((s: any) => s.id === binary.trace && s.name === 'rpc.get-part')).toBe(false);
    await lab.call('destroy'); await expect(lab.page.locator('#ww-asset-runtime-lab')).toHaveCount(0); await expect(lab.page.locator('#ww-asset-runtime-binary')).toHaveCount(0);
  } finally { await lab.context.close(); }
});

test('opt-in private original: matched saved-source chunks, binary and resident comparison', async () => {
  test.skip(process.env.WW_ASSET_BINARY_LIVE !== '1' || !process.env.WW_VRM_FILE, 'Explicit real-site/private-file benchmark'); test.setTimeout(600000);
  const lab = await openAssetLab(true, process.env.WW_VRM_FILE), report: Record<string, any> = { browser: lab.context.browser()?.version(), bytes: lab.asset.byteLength, modes: {} };
  const persist = async () => { await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/asset-runtime-binary.json', JSON.stringify(report, null, 2)); };
  try {
    await lab.page.locator('video').first().evaluate((v: HTMLVideoElement) => v.pause());
    for (const mode of ['chunks', 'binary', 'resident']) {
      report.modes[mode] = [];
      for (let n = 0; n < 5; n++) {
        const r = await lab.call('show', mode, lab.asset.id); expect(r.alphaPixels).toBeGreaterThan(1000);
        report.modes[mode].push({ trial: n + 1, cache: n ? 'warm-process-fresh-model' : 'first-route-session', ...compactLabResult(r) }); await persist();
      }
    }
  } catch (error) { report.failure = String(error); await persist(); throw error; }
  finally { await lab.context.close(); }
});
