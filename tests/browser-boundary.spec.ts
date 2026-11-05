import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
// @ts-expect-error -- a plain .mjs build script without type declarations
import { chromeBoundaryProblem } from '../scripts/browser-boundary.mjs';

const check = chromeBoundaryProblem as (label: string, source: string) => Promise<string | undefined>;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : [],
  );
}

test('no source outside src/browser/ and the extension entry points calls chrome.*', async () => {
  const problems: string[] = [];
  for (const file of sources('src')) {
    const label = relative('.', file).replaceAll('\\', '/');
    const problem = await check(label, readFileSync(file, 'utf8'));
    if (problem) problems.push(problem);
  }
  expect(problems).toEqual([]);
});

test('the check finds a call written outside the boundary, and ignores comments and types', async () => {
  // Deliberately broken: a renderer reading storage directly.
  expect(await check('src/renderers/three/x.ts', 'export const read = () => chrome.storage.local.get("a");')).toContain(
    'src/renderers/three/x.ts',
  );
  expect(await check('src/world/x.ts', 'export const id = () => chrome?.runtime.id;')).toBeTruthy();
  expect(
    await check('src/host/x.ts', '// chrome.storage is read in src/browser/\nexport const a = 1;'),
  ).toBeUndefined();
  expect(
    await check('src/host/x.ts', 'export type S = chrome.runtime.MessageSender; export const a = (s: S) => s;'),
  ).toBeUndefined();
  expect(await check('src/browser/x.ts', 'export const read = () => chrome.storage.local.get("a");')).toBeUndefined();
  expect(await check('src/content/index.ts', 'chrome.runtime.id;')).toBeUndefined();
  expect(await check('src/content/other.ts', 'chrome.runtime.id;')).toBeTruthy();
});
