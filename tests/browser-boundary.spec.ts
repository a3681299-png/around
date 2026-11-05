import { test, expect } from '@playwright/test';
import { ESLint } from 'eslint';
// @ts-expect-error -- a plain .mjs config module without type declarations
import { browserBoundaryConfig } from '../scripts/browser-boundary.mjs';

/** Only the boundary rules (scripts/browser-boundary.mjs), the same entries eslint.config.mjs uses. */
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: browserBoundaryConfig as never });
const problems = async (filePath: string, code: string) =>
  (await eslint.lintText(code, { filePath }))
    .flatMap((result) => result.messages)
    // A boundary file matches no entry of this boundary-only config ("no matching configuration");
    // that notice is not a rule's finding. Parse errors (fatal) still count.
    .filter((message) => message.ruleId !== null || message.fatal)
    .map((message) => `${message.ruleId}: ${message.message}`);

test('no source outside src/browser/ and the extension entry points uses chrome', async () => {
  const results = await eslint.lintFiles(['src/**/*.ts']);
  const found = results.flatMap((result) =>
    result.messages.map((message) => `${result.filePath}:${message.line} ${message.ruleId}`),
  );
  expect(found).toEqual([]);
});

test('every way of reaching chrome outside the boundary is refused: dot, bracket, alias, optional, via globals', async () => {
  // Deliberately broken: a renderer and a host module reading storage directly.
  const writings = [
    'export const read = () => chrome.storage.local.get("a");',
    'export const read = () => chrome["storage"].local.get("a");',
    'const c = chrome; export const read = () => c.storage.local.get("a");',
    'export const read = () => chrome?.storage.local.get("a");',
    'export const read = () => globalThis.chrome.storage.local.get("a");',
    'export const read = () => window.chrome.storage.local.get("a");',
    'export const read = () => self["chrome"].storage.local.get("a");',
  ];
  for (const code of writings)
    for (const file of ['src/renderers/three/x.ts', 'src/host/x.ts', 'src/content/other.ts'])
      expect(await problems(file, code), `${file}: ${code}`).not.toEqual([]);
});

test('comments, strings, types and local names called chrome are not uses; the boundary files may use it', async () => {
  expect(await problems('src/host/x.ts', '// chrome.storage is read in src/browser/\nexport const a = 1;')).toEqual([]);
  expect(await problems('src/host/x.ts', 'export const url = "chrome://extensions/shortcuts";')).toEqual([]);
  expect(
    await problems('src/host/x.ts', 'export type S = chrome.runtime.MessageSender; export const a = (s: S) => s;'),
  ).toEqual([]);
  expect(await problems('src/host/x.ts', 'export const f = (chrome: { id: number }) => chrome.id;')).toEqual([]);
  for (const file of [
    'src/browser/x.ts',
    'src/background/index.ts',
    'src/popup/index.ts',
    'src/content/index.ts',
    'src/diagnostics/x.ts',
  ])
    expect(await problems(file, 'export const read = () => chrome.storage.local.get("a");'), file).toEqual([]);
});
