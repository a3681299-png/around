import { test, expect } from './fixtures';

test('ordinary extension does not expose the benchmark or accept profiling requests', async ({ popup }) => {
  test.skip(process.env.WW_ASSET_PROFILE_TEST === '1', 'Checks the ordinary build, not the opt-in diagnostics build.');
  const result = await popup.evaluate(async () => ({ manifest: chrome.runtime.getManifest(), response: await chrome.runtime.sendMessage({ type: 'ww.asset-profile.v1', action: 'snapshot' }).catch(() => undefined), runtimeLab: await chrome.runtime.sendMessage({ type: 'ww.asset-runtime.lab.v1', action: 'open', ids: [], tab: 1 }).catch(() => undefined) }));
  expect(result.manifest.permissions).toEqual(['storage', 'sidePanel']);
  expect(JSON.stringify(result.manifest.web_accessible_resources)).not.toContain('diagnostics'); expect(result.response).toBeUndefined();
  expect(result.runtimeLab).toBeUndefined();
});
