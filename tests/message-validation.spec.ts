import { build } from 'esbuild';
import { test, expect } from './fixtures';
import { OPEN_CREATOR_EDITOR, OPEN_INPAGE_STUDIO, OPEN_SIDE_PANEL_TOOLS } from '../src/editor/messages';

test('content messages ignore array types and still accept a string command', async ({ popup, youtube }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await youtube.bringToFront();
  const tabId = await popup.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
  );
  for (const type of [OPEN_CREATOR_EDITOR, OPEN_INPAGE_STUDIO, OPEN_SIDE_PANEL_TOOLS]) {
    const response = await popup.evaluate(async ({ type, tabId }) => chrome.tabs.sendMessage(tabId, { type: [type] }), {
      type,
      tabId,
    });
    expect(response).toBeUndefined();
    await expect(youtube.locator('#web-world-themes-creator')).toHaveCount(0);
  }
  const response = await popup.evaluate(async ({ type, tabId }) => chrome.tabs.sendMessage(tabId, { type }), {
    type: OPEN_CREATOR_EDITOR,
    tabId,
  });
  expect(response).toMatchObject({ ok: true });
  await expect(youtube.locator('#web-world-themes-creator')).toBeVisible();
});

test('workspace preferences reject an array area and retain the default active tab', async ({ youtube }) => {
  const bundle = await build({
    entryPoints: ['src/editor/panel.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'WorkspaceValidationTest',
    loader: { '.css': 'text' },
  });
  await youtube.addScriptTag({ content: bundle.outputFiles[0]!.text });
  for (const area of [['properties'], ['help'], 'properties']) {
    await youtube.evaluate((area) => {
      (globalThis as any).__testPanel?.destroy();
      const panel = (globalThis as any).WorkspaceValidationTest.createCreatorPanel(
        document,
        {
          thumbnail: async () => undefined,
        },
        [],
        {
          persistWorkspace: true,
          preferences: { read: async () => ({ area }), write: async () => undefined },
        },
      );
      (globalThis as any).__testPanel = panel;
      document.body.append(panel.host);
    }, area);
    const panel = youtube.locator('#web-world-themes-creator');
    await expect(
      panel.getByRole('tab', { name: typeof area === 'string' ? 'プロパティ' : 'レイヤー', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  }
});
