import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { DesignDocument } from '../src/design/types';
import { beginCanvasGesture } from './helpers/editor-workspace';

const key = 'webWorldThemes.design.youtube',
  overlay = '#web-world-themes-decorations';
const layers = `${overlay} [data-image-id]`;
async function open(popup: Page, page: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await page.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.getByRole('dialog', { name: 'デザインエディター' });
  await expect(panel).toBeVisible();
  return panel;
}
async function add(panel: Locator, page: Page) {
  const buffers = await page.evaluate(() =>
    ['#e9a7df', '#74cbda', '#deb770'].map((color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(15, 15, 70, 70);
      return canvas.toDataURL().split(',')[1]!;
    }),
  );
  await panel.getByLabel('画像素材を追加').setInputFiles(
    buffers.map((data, i) => ({
      name: `素材${i + 1}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    })),
  );
  await expect(page.locator(layers)).toHaveCount(3);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
}
async function selectThree(panel: Locator) {
  await panel.getByRole('button', { name: '選択解除', exact: true }).click();
  for (const check of await panel.locator('[data-multiselect]').all()) await check.check();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
}
async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
}

test('mouse-only first creation: import, check selection, group, mask, behavior, save, reload and ungroup', async ({
  popup,
  youtube,
}, info) => {
  const panel = await open(popup, youtube);
  await expect(panel.locator('.empty-layers')).toBeVisible();
  await expect(panel.locator('.quick-guide')).toBeVisible();
  await expect(panel.getByRole('button', { name: '選択をグループ化', exact: true })).toBeDisabled();
  await expect(panel.locator('.grouping-help')).toContainText('2枚以上');
  await add(panel, youtube);
  // The owned canvas gesture must start outside native guide/chip columns.
  for (let i = 0; i < 3; i++) {
    await panel.getByRole('button', { name: `素材${i + 1}.png`, exact: true }).click();
    await panel.getByRole('button', { name: 'プロパティを編集', exact: true }).click();
    await panel.getByLabel('画像のX位置', { exact: true }).fill(String(60 + i * 10));
    await panel.getByLabel('画像のX位置', { exact: true }).press('Tab');
    await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  }
  await selectThree(panel);
  await expect(panel.locator('.thumbnail img')).toHaveCount(3);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeInViewport();
  await youtube.screenshot({ path: info.outputPath('01-mouse-selection.png') });
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await expect(panel.locator('[data-parent-id]')).toHaveCount(3);
  const first = youtube.locator(layers).first(),
    before = (await first.boundingBox())!;
  await beginCanvasGesture(first);
  await youtube.mouse.move(before.x + before.width / 2 - 40, before.y + before.height / 2 + 15, { steps: 8 });
  await youtube.mouse.up();
  expect((await first.boundingBox())!.x).toBeCloseTo(before.x - 40, 2);
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByRole('checkbox', { name: '円形マスクを使う', exact: true }).check();
  await panel.getByLabel('光の半径', { exact: true }).fill('180');
  await panel.getByRole('checkbox', { name: 'マウスに追従', exact: true }).check();
  await panel.getByRole('checkbox', { name: '動画の一時停止で隠す', exact: true }).check();
  await expect(panel.getByLabel('画像の幅', { exact: true })).toBeHidden();
  await expect(panel.locator('.dirty')).toHaveText('未保存');
  await save(panel);
  const saved = await stored(popup);
  expect(saved.schemaVersion).toBe(13);
  expect(saved.groups?.[0]?.effects?.[0]).toMatchObject({ enabled: true, radiusPx: 180 });
  await youtube.screenshot({ path: info.outputPath('02-group-inspector.png') });
  await youtube.reload();
  const again = await open(popup, youtube);
  await again.locator('[data-kind="group"] [data-action="select"]').click();
  await again.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await expect(again.getByLabel('光の半径', { exact: true })).toHaveValue('180');
  await again.getByRole('button', { name: 'グループを解除', exact: true }).click();
  await expect(again.locator('.selected-count')).toHaveText('3個選択中');
  await save(again);
  expect((await stored(popup)).decorations.map((x) => x.placement)).toEqual(saved.decorations.map((x) => x.placement));
});

test('group reasons stay visible for mixed anchors, interleaving and locks; menu preserves multi-selection', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await youtube.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await panel.getByRole('button', { name: '素材2.png', exact: true }).click();
  await panel.getByRole('button', { name: 'プロパティを編集', exact: true }).click();
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  await selectThree(panel);
  await expect(panel.locator('.grouping-help')).toContainText('画面基準');
  await panel.getByRole('button', { name: '素材2.png', exact: true }).click();
  await panel.getByRole('button', { name: 'プロパティを編集', exact: true }).click();
  await panel.getByLabel('配置の基準').selectOption('viewport');
  await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  await panel.getByRole('button', { name: '選択解除', exact: true }).click();
  await panel.getByLabel('素材1.pngを複数選択', { exact: true }).check();
  await panel.getByLabel('素材3.pngを複数選択', { exact: true }).check();
  await expect(panel.locator('.grouping-help')).toContainText('連続');
  await panel.getByLabel('素材2.pngを複数選択', { exact: true }).check();
  await panel.getByRole('button', { name: '素材2.png', exact: true }).click({ button: 'right' });
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('menuitem', { name: '選択をグループ化', exact: true }).click();
  const group = panel.locator('[data-kind="group"]');
  await group.getByRole('button', { name: 'ロック', exact: true }).click();
  await expect(panel.getByRole('button', { name: '画像を削除', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '複製', exact: true })).toBeDisabled();
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(layers)).toHaveCount(3);
  await group.getByRole('button', { name: 'ロック解除', exact: true }).click();
  await group.getByRole('button', { name: 'グループを折りたたむ' }).click();
  await expect(panel.locator('[data-parent-id]')).toHaveCount(0);
  await group.getByRole('button', { name: 'グループを展開' }).click();
  await expect(panel.locator('[data-parent-id]')).toHaveCount(3);
});

test('workspace width, docking, collapse, tabs and menu keys keep selection and page shortcuts independent', async ({
  popup,
  youtube,
}, info) => {
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await panel.getByRole('button', { name: '素材1.png', exact: true }).dblclick();
  await panel.getByLabel('一覧でレイヤー名を変更').fill('とても長い名前の花びらと光の装飾素材をキャンバスで使う.png');
  await panel.getByLabel('一覧でレイヤー名を変更').press('Enter');
  const row = panel.locator('[data-layer-id]').filter({ hasText: 'とても長い名前' });
  await expect(row).toHaveAttribute('title', /とても長い/);
  const selectedId = await row.getAttribute('data-layer-id');
  await panel.getByRole('button', { name: '並べる', exact: true }).click();
  await expect(panel.locator('.layers-pane')).toBeVisible();
  await expect(panel.locator('.inspector-pane')).toBeVisible();
  await panel.getByLabel('レイヤー名', { exact: true }).fill('名前を入力中');
  await youtube.keyboard.press('Control+d');
  await expect(youtube.locator(layers)).toHaveCount(3);
  await panel.getByLabel('レイヤー名', { exact: true }).press('Tab');
  const before = await panel.boundingBox();
  await panel.getByRole('separator', { name: 'パネルの幅' }).focus();
  await youtube.keyboard.press('ArrowRight');
  expect((await panel.boundingBox())!.width).toBe(before!.width + 20);
  await panel.getByRole('button', { name: 'パネルを左へ', exact: true }).click();
  // Docked space-20 in from the page edge (WWT Studio design system).
  expect((await panel.boundingBox())!.x).toBe(20);
  await panel.getByRole('button', { name: 'パネルを折りたたむ' }).click();
  expect((await panel.boundingBox())!.height).toBeLessThan(100);
  await panel.getByRole('button', { name: 'パネルを展開する' }).click();
  await panel.getByRole('tab', { name: '使い方', exact: true }).click();
  await expect(panel.getByText('Ctrl ＋ D', { exact: true })).toBeVisible();
  await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  await panel.locator(`[data-layer-id="${selectedId}"]`).getByRole('button', { name: 'レイヤーの操作' }).click();
  await youtube.keyboard.press('ArrowDown');
  await youtube.keyboard.press('Escape');
  await expect(panel.getByRole('menu', { name: 'レイヤーの操作' })).toBeHidden();
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await youtube.setViewportSize({ width: 430, height: 650 });
  await panel.getByRole('tab', { name: 'プロパティ', exact: true }).click();
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(410);
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await youtube.screenshot({ path: info.outputPath('03-small-workspace.png') });
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', '');
});

test('animation thumbnails are static and independent of playback; error feedback survives tab switches', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles(
      ['gif', 'webm', 'json'].map((type) =>
        path.resolve(`tests/fixtures/motion/${type === 'webm' ? 'alpha1080' : 'petal'}.${type}`),
      ),
    );
  await expect(youtube.locator(layers)).toHaveCount(3);
  await expect(panel.locator('.thumbnail img')).toHaveCount(3);
  await expect
    .poll(() =>
      panel
        .locator('.thumbnail img')
        .evaluateAll((nodes) =>
          nodes.every((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await expect(panel.locator('.thumbnail video, .thumbnail canvas')).toHaveCount(0);
  await panel.getByRole('button', { name: 'プロパティを編集', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'アニメーションの再生', exact: true })).toBeVisible();
  await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('broken') });
  await expect(panel.locator('.status')).toHaveAttribute('role', 'alert');
  // The header chip carries the save state only; an operation error is told, visibly, in the footer.
  await expect(panel.locator('.status')).toHaveAttribute('data-error', 'true');
  await expect(panel.locator('.status')).toBeVisible();
  await expect(panel.locator('.status')).not.toBeEmpty();
  await expect(panel.locator('.dirty')).not.toContainText('保存済み');
  await panel.getByRole('tab', { name: '使い方', exact: true }).click();
  await expect(panel.locator('.status')).toHaveAttribute('data-error', 'true');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(panel).toHaveCount(0);
  await expect(youtube.locator(overlay)).toHaveCount(0);
});

test('32 layers keep one list scroll, shared thumbnails, lock protection, Undo/discard and dismissed onboarding', async ({
  popup,
  youtube,
}, info) => {
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await save(panel);
  const design = await stored(popup),
    source = design.decorations[0]!;
  await panel.getByRole('button', { name: '操作ガイドを閉じる', exact: true }).click();
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  design.decorations = Array.from({ length: 32 }, (_, i) => ({
    ...source,
    id: `ux-${i}`,
    name: `装飾素材 ${i + 1}`,
    zIndex: i,
    locked: i === 0,
    visible: i !== 1,
    placement: {
      ...source.placement,
      widthPx: 60,
      heightPx: 60,
      x: 0.15 + (i % 8) * 0.07,
      y: 0.3 + Math.floor(i / 8) * 0.12,
    },
  }));
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  const again = await open(popup, youtube);
  await expect(again.locator('.quick-guide')).toBeHidden();
  await again.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(again.locator('.selected-count')).toHaveText('32個選択中');
  await expect(again.locator('[data-multiselect]:checked')).toHaveCount(32);
  await expect(again.locator('.thumbnail img')).toHaveCount(32);
  await expect(again.locator('.grouping-help')).toContainText('ロック解除');
  await again.locator('.layers').hover();
  await youtube.mouse.wheel(0, 2000);
  await expect(again.getByRole('button', { name: '装飾素材 1', exact: true })).toBeInViewport();
  expect(await again.locator('.editor-body').evaluate((node) => node.scrollTop)).toBe(0);
  await expect(again.getByRole('button', { name: '元に戻す', exact: true })).toBeInViewport();
  await expect(again.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await youtube.screenshot({ path: info.outputPath('04-32-layers.png') });
  await again.getByRole('button', { name: '画像を削除', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(1);
  await expect(youtube.locator(layers)).toHaveAttribute('data-image-id', 'ux-0');
  await again.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(32);
  await again.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await again.getByRole('button', { name: '画像を削除', exact: true }).click();
  await again.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(32);
  expect((await stored(popup)).decorations).toEqual(design.decorations);
  await again.getByRole('tab', { name: '使い方', exact: true }).click();
  await again.getByRole('button', { name: '操作ガイドをもう一度表示', exact: true }).click();
  await expect(again.locator('.quick-guide')).toBeVisible();
});

test('on a low window (1366×657) the guide folds to its title and the first layer row shows without scrolling', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1366, height: 657 });
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await save(panel);
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  await expect(panel).toHaveCount(0);
  const again = await open(popup, youtube);
  await expect(again.locator('.layer')).toHaveCount(3);
  const guide = again.locator('.quick-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute('data-folded', '');
  const toggle = again.getByRole('button', { name: 'はじめての制作', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(guide.locator('ol')).toBeHidden();
  // Straight after opening, nothing scrolled: the first row is whole on screen and is the row itself.
  expect(await again.locator('.layers-pane').evaluate((pane) => pane.scrollTop)).toBe(0);
  const first = again.locator('.layer').first();
  await expect(first).toBeInViewport({ ratio: 1 });
  expect(
    await again.evaluate((host) => {
      const row = host.shadowRoot!.querySelector('.layer')!,
        box = row.querySelector('.layer-select')!.getBoundingClientRect();
      return row.contains(host.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    }),
  ).toBe(true);
  // Pressing the title opens the steps, and again folds them.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(guide.locator('ol')).toBeVisible();
  await toggle.click();
  await expect(guide.locator('ol')).toBeHidden();
});

test('a low window (1366×657) with the guide shown still lets the bottom of three layer rows be picked', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1366, height: 657 });
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await expect(panel.locator('.quick-guide')).toBeVisible();
  const bottom = panel.locator('.layer').last();
  await expect(bottom).toHaveAttribute('title', '素材1.png');
  // Reach the bottom row the way a person does, with the browser's own scroll chaining: the wheel
  // over the guide brings the list up, then the wheel over the list. The page itself stays put.
  const pageY = await youtube.evaluate(() => scrollY);
  await panel.locator('.quick-guide').hover();
  await youtube.mouse.wheel(0, 600);
  await expect(panel.locator('.layers')).toBeInViewport({ ratio: 1 });
  await panel.locator('.layers').hover();
  await youtube.mouse.wheel(0, 600);
  const probe = () =>
    panel.evaluate((host) => {
      const root = host.shadowRoot!,
        list = root.querySelector('.layers')!.getBoundingClientRect(),
        row = [...root.querySelectorAll('.layer')].at(-1)!,
        target = row.querySelector('.layer-select')!.getBoundingClientRect(),
        x = target.left + target.width / 2,
        y = target.top + target.height / 2;
      return {
        list: list.height,
        row: row.getBoundingClientRect().height,
        x,
        y,
        hit: row.contains(root.elementFromPoint(x, y)),
      };
    });
  await expect.poll(async () => (await probe()).hit).toBe(true);
  const { list, row, x, y } = await probe();
  expect(list).toBeGreaterThanOrEqual(row);
  await youtube.mouse.click(x, y);
  await expect(bottom).toHaveAttribute('data-selected', '');
  expect(await youtube.evaluate(() => scrollY)).toBe(pageY);
  await expect(panel.getByRole('button', { name: '元に戻す', exact: true })).toBeInViewport();
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  // The row menu stays open over its row, and a scroll after it opened still closes it.
  await bottom.getByRole('button', { name: 'レイヤーの操作' }).click();
  const menu = panel.getByRole('menu', { name: 'レイヤーの操作' });
  await expect(menu).toBeVisible();
  await youtube.waitForTimeout(100);
  await expect(menu).toBeVisible();
  // The wheel over the list's top-left corner, away from the menu that opened at the row's end.
  const listBox = (await panel.locator('.layers').boundingBox())!;
  await youtube.mouse.move(listBox.x + 20, listBox.y + 8);
  await youtube.mouse.wheel(0, -200);
  await expect(menu).toBeHidden();
  await expect(bottom).toHaveAttribute('data-selected', '');
  // Taller, the list still scrolls but the pane has nothing to scroll: the list's leftover wheel
  // must not reach the page.
  await youtube.setViewportSize({ width: 1366, height: 800 });
  // Unfolded, the guide takes the room that leaves the list scrolling inside a pane that does not.
  if (await panel.locator('.quick-guide[data-folded]').count())
    await panel.getByRole('button', { name: 'はじめての制作', exact: true }).click();
  await expect(panel.locator('.layers')).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() => panel.locator('.layers-pane').evaluate((pane) => pane.scrollHeight - pane.clientHeight))
    .toBe(0);
  expect(await panel.locator('.layers').evaluate((list) => list.scrollHeight - list.clientHeight)).toBeGreaterThan(0);
  // The page can still scroll down from here, so a leak would show.
  const tallY = await youtube.evaluate(() => scrollY);
  expect(await youtube.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeGreaterThan(
    0,
  );
  await panel.locator('.layers').hover();
  await youtube.mouse.wheel(0, 600);
  await youtube.waitForTimeout(300);
  expect(await youtube.evaluate(() => scrollY)).toBe(tallY);
});

test('dropping onto the workspace places material in the visible preview, including split mode', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByRole('button', { name: '並べる', exact: true }).click();
  const rect = (await panel.boundingBox())!,
    bytes = await readFile(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.evaluate(
    (host, { data, x, y }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'panel-drop.png', { type: 'image/png' }),
      );
      host.shadowRoot!.querySelector('main')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: transfer,
          clientX: x,
          clientY: y,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    },
    { data: bytes.toString('base64'), x: rect.x + 120, y: rect.y + 240 },
  );
  await expect(youtube.locator(layers)).toHaveCount(1);
  const image = (await youtube.locator(layers).boundingBox())!;
  expect(image.x + image.width / 2).toBeLessThan(rect.x);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(0);
});
