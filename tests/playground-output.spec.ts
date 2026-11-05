import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error -- a plain .mjs build script without type declarations
import { playgroundOutputProblems } from '../scripts/playground/check-output.mjs';

const check = playgroundOutputProblems as (root: string, allowedModels: string[]) => string[];

/** A fake Playground output folder: index, app and the one model the build made. */
function folder(extra: Record<string, string | Uint8Array> = {}) {
  mkdirSync('.work', { recursive: true });
  const root = mkdtempSync(join('.work', 'playground-output-'));
  const files: Record<string, string | Uint8Array> = {
    'index.html': '<!doctype html><title>Playground</title>',
    'app.js': 'console.log(1)',
    'content/a1.vrm': new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]),
    ...extra,
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('a clean Playground output passes', () => {
  const root = folder();
  try {
    expect(check(root, ['content/a1.vrm'])).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the private character, a private model, an unlisted motion and a Mixamo rig are refused', () => {
  const root = folder({
    'content/trusie.vrm': 'x',
    'content/PochibyKT_Pochi.vrm': 'x',
    'content/wave.vrma': 'x',
    // A glb with Mixamo bone names in its JSON chunk, under an innocent name.
    'content/a2.glb': 'glTF....{"nodes":[{"name":"mixamorig:Hips"}]}',
  });
  try {
    const problems = check(root, ['content/a1.vrm', 'content/a2.glb']);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^content\/trusie\.vrm: forbidden name/),
        expect.stringMatching(/^content\/PochibyKT_Pochi\.vrm: forbidden name/),
        expect.stringMatching(/^content\/wave\.vrma: a model or motion the Playground build did not make/),
        expect.stringMatching(/^content\/a2\.glb: contains/),
      ]),
    );
    // The clean model the build made is not named.
    expect(problems.some((problem) => problem.startsWith('content/a1.vrm'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the forbidden names are found in text files too (a copied notice or path)', () => {
  const root = folder({ 'credits.txt': 'Character: トルーシェ' });
  try {
    expect(check(root, ['content/a1.vrm'])).toEqual([expect.stringMatching(/^credits\.txt: contains/)]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
