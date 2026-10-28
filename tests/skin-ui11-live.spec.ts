import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import {
  allPartsDesign,
  importSkinArt,
  partLocator,
  partSnapshot,
  plainSkinDesign,
  storeDesign,
} from './helpers/skin-verification';
import { declinePromotion, openNativeComments, waitForAdvertToEnd } from './helpers/youtube-live';
import { enterNativeTheater } from './helpers/youtube-theater';
import { contrastAt } from './helpers/native-youtube';
import {
  inkAudit,
  monitorInk,
  monitorSiteObservers,
  nativeObserverAudit,
  presentedFrames,
} from './helpers/skin-ink-audit';
import { installOutsetAudit, outsetAudit, outsetPaintDiff } from './helpers/skin-outset-audit';
import { nativeShortcut } from './helpers/native-shortcut';

const resultsUrl = 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const watchUrl = process.env.WW_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls';
const shots = path.resolve(process.env.WW_LIVE_UI11_SHOTS ?? 'docs/screenshots/ui1-1/verification');

async function live(headed = false) {
  await mkdir('.work', { recursive: true });
  await mkdir(shots, { recursive: true });
  const profile = await mkdtemp(path.resolve(headed ? '.work/g-entry-profile-' : '.work/ui11-live-'));
  const base = path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? 'dist');
  const extension = headed ? await mkdtemp(path.resolve('.work/g-entry-extension-')) : base;
  if (headed) await cp(base, extension, { recursive: true });
  const context = await launchExtension(profile, false, {
    headed,
    width: 1920,
    height: 1080,
    extensionPath: extension,
  });
  await monitorSiteObservers(context);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
  await storeDesign(popup, plainSkinDesign);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  return { context, popup, page, profile, extension };
}

async function openSkin(page: Page, popup: Page, part: string) {
  await page.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((node: HTMLButtonElement) => node.click());
  const editor = page.getByRole('dialog', { name: 'デザインエディター' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await editor.locator(`.skin-part[data-target="${part}"]`).click();
  return editor;
}

async function evidence(name: string, data: unknown, info: TestInfo) {
  await mkdir('.work/ui11-verification/live', { recursive: true });
  const body = JSON.stringify(data, null, 2);
  await writeFile(`.work/ui11-verification/live/${name}.json`, body);
  await info.attach(`${name}.json`, { body, contentType: 'application/json' });
}

test('optional real YouTube UI1.1: checker warning, ink sampling, modes, replacement art and SPA settle without a feedback loop', async ({}, info) => {
  test.skip(process.env.WW_LIVE_UI11 !== '1', 'Explicit signed-out UI1.1 lifecycle verification.');
  test.setTimeout(600_000);
  const { context, page, popup } = await live();
  const records: Record<string, unknown>[] = [];
  try {
    await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' });
    await declinePromotion(page);
    const checker = await importSkinArt(page, popup, 'tests/fixtures/skins/frame-checker.png');
    const forHeader = (asset: string) => {
      const design = allPartsDesign(asset);
      return { ...design, rules: design.rules.filter((rule) => ['filter-chip', 'search-box'].includes(rule.target)) };
    };
    await monitorInk(page);
    await storeDesign(popup, forHeader(checker));
    const editor = await openSkin(page, popup, 'filter-chip');
    await expect(editor.locator('.skin-ink')).toContainText('読みにくいかもしれません');
    await expect(editor.locator('.skin-ink')).toContainText('白でも黒でも 4.5:1 に届きません');
    await page.screenshot({ path: path.join(shots, 'checker-legibility-warning.png') });
    await editor.getByRole('button', { name: /編集を終了/ }).click();
    await presentedFrames(page);
    const checkerPlan = await inkAudit(page);
    await presentedFrames(page, 120);
    expect((await inkAudit(page)).plans).toBe(checkerPlan.plans);
    records.push({ stage: 'checker', audit: await inkAudit(page), siteObservers: await nativeObserverAudit(page) });
    const search = partLocator(page, 'search-box').first();
    const oldSource = await search.evaluate((node) => getComputedStyle(node).borderImageSource);
    const dark = await importSkinArt(page, popup, 'tests/fixtures/skins/frame-dark.png');
    await storeDesign(popup, forHeader(dark));
    await expect(search).not.toHaveCSS('border-image-source', oldSource);
    await expect.poll(async () => (await inkAudit(page)).plans).toBeGreaterThan(checkerPlan.plans);
    for (const mode of ['light', 'dark', 'light'] as const) {
      const before = (await inkAudit(page)).plans;
      const previousMode = await page.locator('html').getAttribute('data-ww-mode');
      await page.locator('html').evaluate((node, dark) => node.toggleAttribute('dark', dark), mode === 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-ww-mode', mode);
      if (previousMode !== mode) await expect.poll(async () => (await inkAudit(page)).plans).toBeGreaterThan(before);
      await presentedFrames(page);
      const settled = await inkAudit(page);
      await presentedFrames(page);
      expect((await inkAudit(page)).plans).toBe(settled.plans);
      const input = search.locator('input');
      await input.evaluate((node) => node.setAttribute('data-ui11-text', ''));
      const contrast = await contrastAt(page, '[data-ui11-text]');
      await input.evaluate((node) => node.removeAttribute('data-ui11-text'));
      expect.soft(contrast.ratio, `${mode} real search text on dark artwork`).toBeGreaterThanOrEqual(3);
      records.push({
        stage: mode,
        before,
        audit: settled,
        textContrast: contrast,
        siteObservers: await nativeObserverAudit(page),
      });
    }
    const beforeSpa = (await inkAudit(page)).plans;
    await page.evaluate(() => {
      (window as any).__ui11SameDocument = true;
    });
    const card = partLocator(page, 'video-card').first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/watch\?v=/);
    expect(await page.evaluate(() => (window as any).__ui11SameDocument)).toBe(true);
    await expect.poll(async () => (await inkAudit(page)).plans).toBeGreaterThan(beforeSpa);
    await presentedFrames(page, 120);
    const spa = await inkAudit(page);
    await presentedFrames(page, 120);
    expect((await inkAudit(page)).plans).toBe(spa.plans);
    expect(spa.exposedFrames).toBe(0);
    expect(spa.mutations).toBe(spa.plans * 2);
    expect(spa.events.every((event) => !event.present)).toBe(true);
    records.push({ stage: 'spa', before: beforeSpa, audit: spa, siteObservers: await nativeObserverAudit(page) });
    await page.screenshot({ path: path.join(shots, 'ink-after-spa.png') });
  } finally {
    await evidence('ink-lifecycle', records, info);
    await context.close();
  }
});

test('optional real YouTube UI1.1: petal import explains all three actionable frame warnings', async ({}, info) => {
  test.skip(process.env.WW_LIVE_UI11 !== '1', 'Explicit signed-out UI1.1 import verification.');
  test.setTimeout(180_000);
  const { context, page, popup } = await live();
  const records: Record<string, unknown> = {};
  try {
    await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' });
    await declinePromotion(page);
    const asset = await importSkinArt(page, popup, 'tests/fixtures/motion/petal.png');
    const imported = await openSkin(page, popup, 'video-card');
    records.defaults = await imported.locator('.skin-report').innerText();
    await page.screenshot({ path: path.join(shots, 'petal-import-defaults.png') });
    await imported.getByRole('button', { name: /編集を終了/ }).click();
    // Put the painted 4..17px strip wholly inside the left slice; deliberately make the
    // frame taller than a chip, and wider than its text inset. Each warning has a real cause.
    const design = allPartsDesign(asset, 200, { top: 12, right: 16, bottom: 12, left: 18 });
    await storeDesign(popup, { ...design, rules: design.rules.filter((rule) => rule.target === 'filter-chip') });
    const editor = await openSkin(page, popup, 'filter-chip');
    const warnings = editor.locator('.report-warnings');
    await expect(warnings).toContainText('中央が消えます');
    await expect(warnings).toContainText('絵が左の切り位置の中にしかありません');
    await expect(warnings).toContainText('文字までの余白');
    await expect(warnings).toContainText('文字に重なります');
    records.configured = await editor.locator('.skin-report').innerText();
    records.settings = design.rules[0]!.skin.states.normal;
    await warnings.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'petal-three-warnings.png') });
  } finally {
    await evidence('import-warnings', records, info);
    await context.close();
  }
});

test('optional real YouTube UI1.1: outward frames stay clear at 1280, 1920 and 2560 in normal and theater views', async ({}, info) => {
  test.skip(process.env.WW_LIVE_UI11 !== '1', 'Explicit signed-out UI1.1 outward-frame verification.');
  test.setTimeout(600_000);
  const { context, page, popup } = await live();
  const records: Record<string, unknown>[] = [];
  try {
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded' });
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    await page
      .locator('video')
      .first()
      .evaluate((node: HTMLVideoElement) => node.pause());
    await openNativeComments(page);
    const asset = await importSkinArt(page, popup, 'tests/fixtures/skins/frame-outset.png');
    const design = allPartsDesign(asset, 25, { top: 16, right: 16, bottom: 16, left: 16 });
    const dressed = {
      ...design,
      rules: design.rules
        .filter((rule) => ['video-card', 'comment-input'].includes(rule.target))
        .map((rule) =>
          rule.target === 'comment-input'
            ? { ...rule, skin: { states: { normal: { ...rule.skin.states.normal, scalePct: 50 } } } }
            : rule,
        ),
    };
    await installOutsetAudit(page);
    for (const width of [1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1080 });
      const defaultView = await enterNativeTheater(page);
      await defaultView();
      for (const wide of [false, true]) {
        await page.evaluate(() => scrollTo(0, 0));
        const restore = wide ? await enterNativeTheater(page) : undefined;
        for (const part of ['video-card', 'comment-input']) {
          await storeDesign(popup, plainSkinDesign);
          const target = partLocator(page, part).first();
          await expect(target).toBeVisible({ timeout: 20_000 });
          await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
          await (await target.elementHandle())!.waitForElementState('stable');
          const before = await partSnapshot(target);
          const beforePaint = await page.screenshot({ animations: 'disabled' });
          await storeDesign(popup, dressed);
          await expect(target).toHaveCSS('border-image-outset', part === 'video-card' ? '4px' : '8px');
          const after = await partSnapshot(target);
          const audit = await outsetAudit(page);
          const afterPaint = await page.screenshot({ animations: 'disabled' });
          const paint = await outsetPaintDiff(page, beforePaint, afterPaint, audit);
          records.push({ width, theater: wide, part, before, after, audit, paint });
          expect.soft(after.box, `${width} ${wide} ${part} box`).toEqual(before.box);
          expect.soft(after.hits, `${width} ${wide} ${part} hits`).toEqual(before.hits);
          expect.soft(audit.supported).toBe(true);
          for (const [id, height] of [
            ['player.controls.top', 64],
            ['player.controls.bottom', 112],
          ] as const)
            expect.soft(audit.bands.find((band: any) => band.id === id)?.protectedEnvelope.height).toBe(height);
          expect.soft(audit.parts.some((item) => item.kind === part)).toBe(true);
          expect
            .soft(paint.differences, `${width} ${wide} other controls and G1 protected planes retain every pixel`)
            .toEqual([]);
          expect.soft(audit.touchingFrames, `${width} ${wide} adjacent frames`).toEqual([]);
          await page.screenshot({
            path: path.join(shots, `outset-${width}-${wide ? 'theater' : 'normal'}-${part}.png`),
          });
        }
        await restore?.();
      }
    }
  } finally {
    await evidence('outset-matrix', records, info);
    await context.close();
  }
});

test('optional real YouTube UI1.1: measure self-filled search icons against light and dark artwork', async ({}, info) => {
  test.skip(process.env.WW_LIVE_UI11 !== '1', 'Explicit signed-out UI1.1 native-icon investigation.');
  test.setTimeout(300_000);
  const { context, page, popup } = await live();
  const records: Record<string, unknown>[] = [];
  try {
    await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' });
    await declinePromotion(page);
    for (const art of ['dark', 'light'] as const) {
      const asset = await importSkinArt(page, popup, `tests/fixtures/skins/frame-${art}.png`);
      const design = allPartsDesign(asset);
      await storeDesign(popup, { ...design, rules: design.rules.filter((rule) => rule.target === 'search-box') });
      const search = partLocator(page, 'search-box').first();
      const input = search.locator('input');
      for (const mode of ['light', 'dark'] as const) {
        await page.locator('html').evaluate((node, dark) => node.toggleAttribute('dark', dark), mode === 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-ww-mode', mode);
        await input.focus();
        await presentedFrames(page, 30);
        const paths = search.locator('svg path').filter({ visible: true });
        const count = await paths.count();
        expect.soft(count, `${mode} mode on ${art} art has a visible native icon to measure`).toBeGreaterThan(0);
        for (let index = 0; index < count; index++) {
          const fill = await paths.nth(index).evaluate((node) => getComputedStyle(node).fill);
          if (fill === 'none' || fill === 'rgba(0, 0, 0, 0)') continue;
          await paths.nth(index).evaluate((node) => node.setAttribute('data-ui11-icon', ''));
          const measured = await contrastAt(page, '[data-ui11-icon]', true);
          expect.soft(measured.ratio, `${mode} mode, ${art} art, native icon ${index}`).toBeGreaterThanOrEqual(3);
          const styles = await paths
            .nth(index)
            .evaluate((node) => ({ color: getComputedStyle(node).color, fill: getComputedStyle(node).fill }));
          records.push({
            mode,
            art,
            index,
            count,
            ...styles,
            ratio: measured.ratio,
            ink: measured.ink,
            background: measured.background,
            unobscured: measured.unobscured,
            readableAt3: measured.ratio >= 3,
          });
          await paths.nth(index).evaluate((node) => node.removeAttribute('data-ui11-icon'));
        }
        await search.screenshot({ path: path.join(shots, `search-icons-${mode}-${art}.png`) });
        records.push({
          mode,
          art,
          input: await input.evaluate((node) => ({
            color: getComputedStyle(node).color,
            placeholder: getComputedStyle(node, '::placeholder').color,
          })),
          paths: count,
        });
      }
    }
    expect(
      records.some((record) => typeof record.ratio === 'number'),
      'At least one real native SVG path was measured',
    ).toBe(true);
  } finally {
    await evidence('search-icons', records, info);
    await context.close();
  }
});

test('optional real YouTube UI1.1: lazy marks, SPA, native fullscreen and emergency off settle correctly', async ({}, info) => {
  test.skip(process.env.WW_LIVE_UI11 !== '1', 'Explicit signed-out UI1.1 native lifecycle verification.');
  test.setTimeout(300_000);
  const { context, page, popup, profile, extension } = await live(true);
  const records: Record<string, unknown> = {};
  const optional = page.locator('[data-ww-surface~="search-box"], [data-ww-surface~="filter-chip"]');
  try {
    await storeDesign(popup, { ...plainSkinDesign, rules: [] });
    await page.goto(resultsUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    await declinePromotion(page);
    await expect(optional).toHaveCount(0);
    await page.screenshot({ path: path.join(shots, 'lazy-unused-search.png') });
    const editor = await openSkin(page, popup, 'search-box');
    await presentedFrames(page, 2);
    await expect(partLocator(page, 'search-box')).toHaveCount(1);
    await expect.poll(() => partLocator(page, 'filter-chip').count()).toBeGreaterThan(0);
    await editor.getByRole('button', { name: /編集を終了/ }).click();
    await expect(optional).toHaveCount(0);
    const asset = await importSkinArt(page, popup, 'tests/fixtures/skins/frame-light.png');
    await storeDesign(popup, allPartsDesign(asset));
    const search = partLocator(page, 'search-box').first();
    await expect(search).toHaveCSS('border-image-source', /blob:/);
    await page.evaluate(() => {
      (window as any).__ui11SameDocument = true;
    });
    const old = await partLocator(page, 'video-card').first().elementHandle();
    await partLocator(page, 'video-card').first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/watch\?v=/);
    expect(await page.evaluate(() => (window as any).__ui11SameDocument)).toBe(true);
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    await expect(partLocator(page, 'like-button').first()).toHaveCSS('border-image-source', /blob:/);
    records.previousCard = await old!.evaluate((node) => ({
      connected: node.isConnected,
      marked: node.getAttribute('data-ww-surface'),
      visible: node.getBoundingClientRect().height > 0,
    }));
    if (!(records.previousCard as any).connected) expect((records.previousCard as any).marked).toBeNull();
    await installOutsetAudit(page);
    records.beforeFullscreen = await outsetAudit(page);
    await page
      .getByRole('button', { name: /^Full screen|^全画面/i })
      .first()
      .click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-ww-fullscreen', '');
    records.fullscreen = await outsetAudit(page);
    for (const [id, height] of [
      ['player.controls.top', 64],
      ['player.controls.bottom', 112],
    ] as const)
      expect((records.fullscreen as any).bands.find((band: any) => band.id === id)?.protectedEnvelope.height).toBe(
        height,
      );
    await page.screenshot({ path: path.join(shots, 'native-fullscreen.png') });
    await page
      .getByRole('button', { name: /Exit full screen|全画面表示を終了/i })
      .first()
      .click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-fullscreen');
    await expect(partLocator(page, 'like-button').first()).toHaveCSS('border-image-source', /blob:/);
    await storeDesign(popup, { ...plainSkinDesign, rules: [] });
    await expect(optional).toHaveCount(0);
    await storeDesign(popup, allPartsDesign(asset));
    await expect(search).toHaveCSS('border-image-source', /blob:/);
    await page.bringToFront();
    // This is a Chrome command accelerator, not a renderer keydown handler.
    await nativeShortcut(page, profile, extension, 'Q');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('[data-ww-surface]')].filter(
              (node) => getComputedStyle(node).borderImageSource !== 'none',
            ).length,
        ),
      )
      .toBe(0);
    records.emergency = await page.evaluate(() => ({
      design: document.documentElement.getAttribute('data-ww-design'),
      force: document.documentElement.getAttribute('data-ww-skin-force'),
      inkOff: document.documentElement.hasAttribute('data-ww-ink-off'),
    }));
    expect(records.emergency).toEqual({ design: null, force: null, inkOff: false });
    await page.screenshot({ path: path.join(shots, 'native-after-emergency-off.png') });
  } finally {
    records.dom = await page.evaluate(() => ({
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      parts: [...document.querySelectorAll('[data-ww-surface~="search-box"]')].map((node) => ({
        tag: node.tagName,
        classes: node.className,
        box: node.getBoundingClientRect().toJSON(),
        visibility: getComputedStyle(node).visibility,
      })),
      inputs: [...document.querySelectorAll('input')]
        .filter((node) => node.type === 'text')
        .map((node) => {
          const parents = [];
          for (let current: Element | null = node; current && parents.length < 5; current = current.parentElement)
            parents.push({
              tag: current.tagName,
              classes: current.className,
              mark: current.getAttribute('data-ww-surface'),
              box: current.getBoundingClientRect().toJSON(),
              visibility: getComputedStyle(current).visibility,
            });
          return parents;
        }),
    }));
    await evidence('native-lifecycle', records, info);
    await context.close();
  }
});
