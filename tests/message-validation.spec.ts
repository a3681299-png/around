import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { PROBE_EDITOR_TARGET } from '../src/editor/messages';

test('content messages ignore array types and still accept a string command', async ({ popup, youtube }) => {
  await showArtwork(popup);
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  await youtube.bringToFront();
  const tabId = await popup.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
  );
  // UI0-d: the page's one message is the editor-target probe; the editor is the side panel or its
  // window. The retired in-page editors' messages open nothing, as strings or arrays.
  const retired = ['around:open-creator-editor', 'around:open-inpage-studio', 'around:open-side-panel-tools'];
  for (const type of [PROBE_EDITOR_TARGET, ...retired].flatMap((value) => [
    [value],
    ...(retired.includes(value) ? [value] : []),
  ])) {
    const response = await popup.evaluate(async ({ type, tabId }) => chrome.tabs.sendMessage(tabId, { type }), {
      type,
      tabId,
    });
    expect(response, JSON.stringify(type)).toBeUndefined();
    await expect(youtube.locator('#around-creator')).toHaveCount(0);
  }
  const response = await popup.evaluate(async ({ type, tabId }) => chrome.tabs.sendMessage(tabId, { type }), {
    type: PROBE_EDITOR_TARGET,
    tabId,
  });
  expect(response).toEqual({ siteId: 'youtube' });
});
