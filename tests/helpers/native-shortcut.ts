import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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
  // CI uses isolated Xvfb. Match the owned browser PID rather than racing its
  // asynchronous WM title update, and verify both test paths before focusing it.
  const browser = page.context().browser();
  if (!browser) throw new Error('The owned test browser is unavailable.');
  const cdp = await browser.newBrowserCDPSession();
  let browserPid: number | undefined;
  try {
    browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(
      (entry) => entry.type === 'browser',
    )?.id;
  } finally {
    await cdp.detach();
  }
  if (!browserPid || !Number.isSafeInteger(browserPid)) throw new Error('Expected an owned browser PID.');
  const args = (await readFile('/proc/' + browserPid + '/cmdline', 'utf8')).split('\0');
  if (!args.includes('--user-data-dir=' + profile) || !args.includes('--load-extension=' + extension))
    throw new Error('Refusing keys outside the owned test browser.');
  const result = await run('xdotool', ['search', '--sync', '--onlyvisible', '--pid', String(browserPid)], {
    timeout: 5000,
  });
  const windows = result.stdout.trim().split(/\s+/);
  if (windows.length !== 1 || !/^\d+$/.test(windows[0]!)) throw new Error('Expected one owned test window.');
  await run('xdotool', ['windowfocus', '--sync', windows[0]!], { timeout: 5000 });
  await run('xdotool', ['key', '--clearmodifiers', 'alt+shift+' + key.toLowerCase()], { timeout: 5000 });
}
