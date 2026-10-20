import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';

test('World Runtime compiles without browser globals and never imports a host or renderer', async () => {
  const files = (await readdir('src/world')).filter((name) => name.endsWith('.ts')).map((name) => `src/world/${name}`);
  const result = await build({
    entryPoints: files,
    bundle: true,
    write: false,
    outdir: 'unused',
    platform: 'neutral',
    metafile: true,
    logLevel: 'silent',
  });
  for (const path of Object.keys(result.metafile!.inputs)) {
    expect(path).not.toMatch(/src\/(host|renderers|sites|media|editor|storage)\//);
    const source = await readFile(path, 'utf8');
    expect(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toMatch(
      /\b(?:window|document|HTMLElement|requestAnimationFrame|performance|chrome|globalThis|process)\b|\bDate\s*[.(]|\bMath\s*\.\s*random\s*\(|\beval\s*\(|\bnew\s+Function\b/,
    );
  }
});

test('Host sessions do not import the DOM renderer or media decoder', async () => {
  const result = await build({
    entryPoints: ['src/host/world-session.ts', 'src/host/media-clock.ts', 'src/host/anchors.ts'],
    bundle: true,
    write: false,
    outdir: 'unused',
    platform: 'neutral',
    metafile: true,
    logLevel: 'silent',
  });
  expect(Object.keys(result.metafile!.inputs).some((path) => /src\/(renderers|media|sites)\//.test(path))).toBe(false);
});
