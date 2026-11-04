import { build } from 'esbuild';
import { test, expect } from './fixtures';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

test('resume folds the report, keeps the overlay and restrictions, and allows reopening; failure stays open', async ({
  popup,
}, info) => {
  const bundle = await build({
    stdin: { contents: "export {mountEditorSafety} from './src/settings/safety-controls';", resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'G13SafetyUI',
  });
  // Extension pages allow self-hosted scripts; keep the test bundle inside the isolated build.
  await writeFile(path.resolve('.work/fix-build/popup/verification-safety.js'), bundle.outputFiles[0]!.text);
  await popup.addScriptTag({ url: new URL('./verification-safety.js', popup.url()).href });
  await popup.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'g13-safety-ui';
    document.body.append(root);
    let listener: (value: any) => void;
    const state: any = {
      issues: [
        {
          layerId: 'witness',
          surfaceId: 'control.1',
          action: 'clip',
          severity: 'enforced',
          reason: '切り抜きの確認',
          remedy: '位置を変える',
        },
      ],
      stopped: '停止の確認',
      remedy: '再開の確認',
      latched: true,
      overlay: true,
      approaching: false,
      surfaces: {},
    };
    const witness: any = ((window as any).__safetyUI = { state, fail: false, log: [] });
    witness.publish = () => listener({ ...state });
    const connection = {
      safety: {
        subscribe: (next: any) => {
          listener = next;
          next({ ...state });
          return () => {};
        },
        overlay: async (value: boolean) => {
          state.overlay = value;
          witness.publish();
        },
        resume: async () => {
          if (witness.fail) throw new Error('再開できませんでした');
          state.stopped = '';
          state.latched = false;
          witness.publish();
        },
      },
    };
    const mounted = (window as any).G13SafetyUI.mountEditorSafety(root, connection);
    root.append(mounted.header);
    new MutationObserver(() => {
      const check = root.querySelector<HTMLDetailsElement>('details')!;
      witness.log.push({
        open: check.open,
        hidden: check.hidden,
        overlay: root.querySelector<HTMLInputElement>('input')!.checked,
        focused: document.activeElement?.tagName,
        report: root.querySelector('ul')!.textContent,
      });
    }).observe(root, { attributes: true, childList: true, subtree: true });
  });
  const root = popup.locator('#g13-safety-ui');
  const check = root.locator('details');
  const summary = root.locator('summary');
  await summary.click();
  await expect(check).toHaveJSProperty('open', true);
  await root.getByRole('button', { name: '描画を再開', exact: true }).click();
  await expect(check).toHaveJSProperty('open', false);
  await expect(summary).toBeFocused();
  await summary.click();
  await expect(root.getByLabel('操作面の保護範囲を表示')).toBeChecked();
  await expect(root.locator('li[data-issue-layer]')).toContainText('切り抜きの確認');
  await popup.evaluate(() => {
    const w = (window as any).__safetyUI;
    w.publish();
    w.publish();
  });
  await expect(check).toHaveJSProperty('open', true);
  await root.getByLabel('操作面の保護範囲を表示').uncheck();
  await expect(check).toHaveJSProperty('open', true);
  await popup.evaluate(() => {
    const w = (window as any).__safetyUI;
    w.fail = true;
    w.state.stopped = 'もう一度停止';
    w.state.latched = true;
    w.publish();
  });
  const restart = root.getByRole('button', { name: '描画を再開', exact: true });
  await restart.click();
  await expect(root.locator('.safety-state')).toHaveText('再開できませんでした');
  await expect(check).toHaveJSProperty('open', true);
  await expect(restart).toBeEnabled();
  await summary.press('Escape');
  await expect(check).toHaveJSProperty('open', false);
  await expect(summary).toBeFocused();
  await info.attach('safety-ui.json', {
    body: JSON.stringify(await popup.evaluate(() => (window as any).__safetyUI.log), null, 2),
    contentType: 'application/json',
  });
});
