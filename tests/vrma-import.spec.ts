import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor } from './helpers/editor';
import { vrmFixture } from './helpers/vrm-fixture';
import { vrmaFixture, overflowingHipsVrma } from './helpers/vrma-fixture';
import type { DesignDocument } from '../src/design/types';

for (const [name, buffer] of [
  [
    'scene',
    vrmaFixture({}, (j) => {
      j.scene = 999;
    }),
  ],
  [
    'root',
    vrmaFixture({}, (j) => {
      j.scenes[0].nodes = [999];
    }),
  ],
  ['hips', overflowingHipsVrma()],
] as const)
  test(`Studio refuses invalid motion ${name} before attaching or saving`, async ({ popup, youtube }) => {
    await showArtwork(popup);
    const { panel } = await openEditor(popup, youtube);
    await panel.locator('.model-file').setInputFiles({
      name: 'Original.vrm',
      mimeType: 'model/gltf-binary',
      buffer: vrmFixture(),
    });
    await expect(panel.locator('.layer')).toHaveCount(1);
    await panel
      .locator('.character-file')
      .setInputFiles({ name: `${name}.vrma`, mimeType: 'model/gltf-binary', buffer });
    await expect(panel.locator('.status')).toHaveAttribute('data-error', 'true');
    await expect(panel.locator('.character-motions li')).toHaveCount(0);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    const saved = await popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
    expect(saved.decorations).toHaveLength(1);
    expect(saved.decorations[0]).not.toHaveProperty('character');
  });
