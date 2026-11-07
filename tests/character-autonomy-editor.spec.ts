import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor } from './helpers/editor';
import { MANNEQUIN_POSES, mannequinPoseVrma, mannequinVrm } from './helpers/mannequin';
import type { DesignDocument, ModelDecoration } from '../src/design/types';

/** v15 in the editor (chunk 3): the character's switches and personality are shown and saved. */
test('the editor shows and saves the computed motion and autonomy switches and the personality', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  const { panel } = await openEditor(popup, youtube);
  await panel.locator('.model-file').setInputFiles({
    name: 'mannequin.vrm',
    mimeType: 'model/gltf-binary',
    buffer: mannequinVrm(),
  });
  await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
  await panel.locator('.character-file').setInputFiles({
    name: 'sit.vrma',
    mimeType: 'model/gltf-binary',
    buffer: mannequinPoseVrma('sit', MANNEQUIN_POSES.sit),
  });
  await expect(panel.locator('.character-motions li')).toHaveCount(1, { timeout: 30000 });
  const computed = panel.getByLabel('計算の動き', { exact: true }),
    autonomy = panel.getByLabel('自律', { exact: true }),
    shyness = panel.getByLabel('臆病さ');
  // A character made by reading motions moves by itself at once (2026-11-07, "reading is enough"):
  // computed motion and autonomy on. Older artwork without the key keeps the autonomy off.
  await expect(computed).toBeChecked();
  await expect(autonomy).toBeChecked();
  await expect(shyness).toBeEnabled();
  // Off and on again: the personality greys out with it.
  await autonomy.uncheck();
  await expect(shyness).toBeDisabled();
  await autonomy.check();
  await expect(shyness).toBeEnabled();
  await shyness.fill('80');
  await shyness.dispatchEvent('change');
  // The behaviour → motion table: off until a motion is picked, then its part and speed.
  const doze = panel.getByLabel('居眠りの動作'),
    dozeSpeed = panel.getByLabel('居眠りの速さ');
  await expect(doze).toBeEnabled();
  await expect(dozeSpeed).toBeDisabled();
  await doze.selectOption('sit');
  await expect(dozeSpeed).toBeEnabled();
  await expect(dozeSpeed).toHaveValue('1');
  await dozeSpeed.fill('0.5');
  await dozeSpeed.dispatchEvent('change');
  await expect(dozeSpeed).toHaveValue('0.5');
  await computed.uncheck();
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const saved = (await popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  )) as DesignDocument;
  expect(saved.schemaVersion).toBe(16);
  const character = (saved.decorations[0] as ModelDecoration).character!;
  expect(character).toMatchObject({
    computedMotion: false,
    autonomy: true,
    personality: { shyness: 0.8, curiosity: 0.5, sleepiness: 0.5 },
    // The pose is held (length 0): its part is 0…0.
    behaviourMotions: { doze: { motion: 'sit', from: 0, to: 0, speed: 0.5 } },
  });
});
