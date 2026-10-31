import { build } from 'esbuild';
import { test, expect } from './fixtures';
import { PROBE_EDITOR_TARGET } from '../src/editor/messages';

test('content messages ignore array types and still accept a string command', async ({ popup, youtube }) => {
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await youtube.bringToFront();
  const tabId = await popup.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
  );
  // UI0-d: the page's one message is the editor-target probe; the editor is the side panel or its
  // window. The retired in-page editors' messages open nothing, as strings or arrays.
  const retired = [
    'web-world-themes:open-creator-editor',
    'web-world-themes:open-inpage-studio',
    'web-world-themes:open-side-panel-tools',
  ];
  for (const type of [PROBE_EDITOR_TARGET, ...retired].flatMap((value) => [
    [value],
    ...(retired.includes(value) ? [value] : []),
  ])) {
    const response = await popup.evaluate(async ({ type, tabId }) => chrome.tabs.sendMessage(tabId, { type }), {
      type,
      tabId,
    });
    expect(response, JSON.stringify(type)).toBeUndefined();
    await expect(youtube.locator('#web-world-themes-creator')).toHaveCount(0);
  }
  const response = await popup.evaluate(async ({ type, tabId }) => chrome.tabs.sendMessage(tabId, { type }), {
    type: PROBE_EDITOR_TARGET,
    tabId,
  });
  expect(response).toEqual({ siteId: 'youtube' });
});

test('workspace preferences reject an array area and retain the default active tab', async ({ youtube }) => {
  // UI0-d round 3 (stopped, not deleted): this checks the in-page Studio's saved workspace (its
  // `persistWorkspace` tab, width and folds). The in-page Studio and that saving went with it; the
  // editor page keeps its workbench preferences under its own key (docs/ui0d-3.md).
  test.fixme(true, 'UI0-d round 3: the in-page Studio workspace this checks was removed; awaiting a decision.');
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
