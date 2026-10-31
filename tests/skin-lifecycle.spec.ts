import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';
import {
  allPartsDesign,
  importSkinArt,
  nativeFixtureParts,
  partLocator,
  plainSkinDesign,
  skinParts,
  storeDesign,
} from './helpers/skin-verification';
import { inkAudit, monitorInk, presentedFrames } from './helpers/skin-ink-audit';

test('unused parts stay unmarked; the skin tool and each named kind acquire and release marks across SPA', async ({
  youtube,
  popup,
}) => {
  test.setTimeout(60_000);
  await storeDesign(popup, plainSkinDesign);
  await nativeFixtureParts(youtube);
  const empty = { ...plainSkinDesign, rules: [] };
  const optional = skinParts.filter((part) => part !== 'video-card');
  const only = async (part?: string) => {
    for (const kind of optional)
      if (kind === part) await expect(partLocator(youtube, kind).first()).toBeVisible();
      else await expect(youtube.locator(`[data-ww-surface~="${kind}"]`)).toHaveCount(0);
    await expect(partLocator(youtube, 'video-card').first()).toBeVisible();
  };
  await storeDesign(popup, empty);
  await only();
  const { panel: editor } = await openEditor(popup, youtube);
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  for (const part of skinParts) await expect(partLocator(youtube, part).first(), part).toBeVisible();
  await editor
    .getByRole('button', { name: /編集を終了/ })
    .first()
    .click();
  await only();
  for (const part of optional) {
    await storeDesign(popup, { ...empty, rules: [{ kind: 'surface-style', target: part, style: {} }] });
    await only(part);
    const old = await partLocator(youtube, part).first().elementHandle();
    await partLocator(youtube, part)
      .first()
      .evaluate((node) => {
        const replacement = node.cloneNode(true) as Element;
        [replacement, ...replacement.querySelectorAll('[data-ww-surface]')].forEach((element) =>
          element.removeAttribute('data-ww-surface'),
        );
        node.replaceWith(replacement);
        history.pushState({}, '', '/watch?v=next-fixture');
        document.dispatchEvent(new Event('yt-navigate-finish'));
      });
    await only(part);
    await expect.poll(() => old!.getAttribute('data-ww-surface')).toBeNull();
    await old!.dispose();
    await storeDesign(popup, empty);
    await only();
  }
  await youtube.reload();
  await only();
});

test('native-ink sampling is absent at presentation and settles after mode and art changes', async ({
  youtube,
  popup,
}, info) => {
  await storeDesign(popup, plainSkinDesign);
  await nativeFixtureParts(youtube);
  const light = await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-light.png');
  const forDescription = (asset: string) => {
    const design = allPartsDesign(asset);
    return { ...design, rules: design.rules.filter((rule) => rule.target === 'description-panel') };
  };
  await monitorInk(youtube);
  await storeDesign(popup, forDescription(light));
  const description = partLocator(youtube, 'description-panel');
  await expect(description).toHaveCSS('border-image-source', /blob:/);
  await expect.poll(async () => (await inkAudit(youtube)).plans).toBeGreaterThan(0);
  await presentedFrames(youtube);
  const first = await inkAudit(youtube);
  await presentedFrames(youtube);
  expect((await inkAudit(youtube)).plans).toBe(first.plans);
  await youtube.locator('html').evaluate((node) => node.setAttribute('dark', ''));
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-mode', 'dark');
  await expect.poll(async () => (await inkAudit(youtube)).plans).toBe(first.plans + 1);
  const dark = await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-dark.png');
  await storeDesign(popup, forDescription(dark));
  await expect(description.locator('span')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await presentedFrames(youtube);
  const changed = await inkAudit(youtube);
  expect(changed.plans).toBeGreaterThan(first.plans + 1);
  await presentedFrames(youtube);
  const settled = await inkAudit(youtube);
  expect(settled.plans).toBe(changed.plans);
  expect(settled.frames).toBeGreaterThanOrEqual(240);
  expect(settled.exposedFrames).toBe(0);
  expect(settled.mutations).toBe(settled.plans * 2);
  expect(settled.events.every((event) => !event.present)).toBe(true);
  await info.attach('ink-lifecycle.json', { body: JSON.stringify(settled), contentType: 'application/json' });
});
