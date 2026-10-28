import { test, expect } from './fixtures';
import {
  allPartsDesign,
  importSkinArt,
  nativeFixtureParts,
  partLocator,
  partSnapshot,
  plainSkinDesign,
  storeDesign,
} from './helpers/skin-verification';

for (const mode of ['light', 'dark'] as const)
  test(`search currentColor icons with a native wrapper colour participate in ink decisions (${mode})`, async ({
    youtube,
    popup,
  }) => {
    await storeDesign(popup, plainSkinDesign);
    await nativeFixtureParts(youtube);
    await youtube.locator('html').evaluate((node, dark) => node.toggleAttribute('dark', dark), mode === 'dark');
    await expect(youtube.locator('html')).toHaveAttribute('data-ww-mode', mode);
    const expected = mode === 'light' ? '#ffffff' : '#000000';
    const native = mode === 'light' ? '#0f0f0f' : '#f1f1f1';
    const search = partLocator(youtube, 'search-box').first();
    await search.evaluate(
      (node, { expected, native }) => {
        // Real YouTube CSS assigns its text-primary colour to the clear icon's SPAN.
        // Its nested SVG uses currentColor. The surrounding text already reads well, so
        // changing the SVG selector alone cannot fix a decision that never samples it.
        (node as HTMLElement).style.color = expected;
        (node.querySelector('input') as HTMLElement).style.color = expected;
        const wrapper = document.createElement('span');
        wrapper.style.color = native;
        wrapper.innerHTML =
          '<svg width="24" height="24" viewBox="0 0 24 24"><path id="fixture-native-clear" fill="currentColor" d="M4 3 12 11 20 3 21 4 13 12 21 20 20 21 12 13 4 21 3 20 11 12 3 4Z"/></svg>';
        node.append(wrapper);
      },
      { expected, native },
    );
    const art = mode === 'light' ? 'dark' : 'light';
    const asset = await importSkinArt(youtube, popup, `tests/fixtures/skins/frame-${art}.png`);
    await storeDesign(popup, plainSkinDesign);
    const before = await partSnapshot(search);
    const design = allPartsDesign(asset);
    await storeDesign(popup, { ...design, rules: design.rules.filter((rule) => rule.target === 'search-box') });
    await expect(search).toHaveCSS('border-image-source', /blob:/);
    const clear = search.locator('#fixture-native-clear');
    await expect(clear).toHaveCSS('fill', mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
    await expect(clear).toHaveAttribute('fill', 'currentColor');
    const after = await partSnapshot(search);
    expect(after.box).toEqual(before.box);
    expect(after.hits).toEqual(before.hits);
  });
