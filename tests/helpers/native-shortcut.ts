import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Page } from '@playwright/test';

const run = promisify(execFile);
/** Renderer CDP key events do not invoke Chrome's toolbar/command accelerators. */
export async function nativeShortcut(page: Page, profile: string, extension: string, key: 'E' | 'Y') {
  await page.bringToFront();
  if (process.platform === 'win32') {
    await run(
      path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.resolve('scripts/test-editor-shortcut.ps1'),
        '-OwnedProfile',
        profile,
        '-ExtensionPath',
        extension,
        '-Key',
        key,
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    return;
  }
  // CI uses an isolated Xvfb display. Focus only this test's uniquely titled window.
  const title = 'WWT-entry-' + crypto.randomUUID();
  await page.evaluate((title) => {
    document.title = title;
  }, title);
  const result = await run('xdotool', ['search', '--onlyvisible', '--name', title], { timeout: 5000 });
  const windows = result.stdout.trim().split(/\s+/);
  if (windows.length !== 1 || !/^\d+$/.test(windows[0]!)) throw new Error('Expected one owned test window.');
  await run('xdotool', ['windowfocus', '--sync', windows[0]!], { timeout: 5000 });
  await run('xdotool', ['key', '--clearmodifiers', 'alt+shift+' + key.toLowerCase()], { timeout: 5000 });
}
