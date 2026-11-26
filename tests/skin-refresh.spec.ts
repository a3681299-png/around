import { test, expect } from './fixtures';
import { allPartsDesign, importSkinArt, partLocator, plainSkinDesign, storeDesign } from './helpers/skin-verification';

test('SPA replacement rereads the native ink of an already present kind', async ({ youtube, popup }) => {
  await storeDesign(popup, plainSkinDesign);
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.getByRole('button', { name: 'Like video', exact: true }).evaluate((button) => {
    const model = document.createElement('like-button-view-model');
    button.before(model);
    model.append(button);
    (button as HTMLElement).style.color = '#000000';
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  const assetId = await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-light.png');
  const design = allPartsDesign(assetId);
  await storeDesign(popup, { ...design, rules: design.rules.filter((rule) => rule.target === 'like-button') });
  const like = partLocator(youtube, 'like-button');
  await expect(like).toHaveCSS('border-image-source', /blob:/);
  await expect(like).toHaveCSS('color', 'rgb(0, 0, 0)');
  // Same kind and same art, but the next native page gives it white text. Its opaque light
  // centre now needs black ink. The adapter's navigation notification must invalidate the plan.
  await like.evaluate((button) => {
    const next = button.cloneNode(true) as HTMLElement;
    next.removeAttribute('data-around-surface');
    next.style.color = '#ffffff';
    button.replaceWith(next);
    history.pushState({}, '', '/watch?v=fixture-next');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await expect(like).toHaveCSS('border-image-source', /blob:/);
  await expect(like).toHaveCSS('color', 'rgb(0, 0, 0)');
});
