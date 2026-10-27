import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('normal output contains no page-change or CPU measurement code; the explicit development build contains counters', async () => {
  await mkdir('.work', { recursive: true });
  for (const enabled of [false, true]) {
    const output = await mkdtemp(path.resolve('.work/ui1-probe-test-'));
    try {
      execFileSync(process.execPath, ['scripts/build.mjs'], {
        env: {
          ...process.env,
          WW_ASSET_PROFILE: '0',
          WW_BUILD_OUT: '.work/' + path.basename(output),
          WW_PAGE_CHANGE_PROBE: enabled ? '1' : '0',
          WW_PAGE_CHANGE_LEGACY: '0',
        },
        stdio: 'pipe',
      });
      const code = await readFile(path.join(output, 'content/index.js'), 'utf8');
      expect(code.includes('__pageChanges')).toBe(enabled);
      expect(code).not.toContain('__ui1Probe');
      expect(code).not.toContain('calibrationMs');
    } finally {
      // This test owns the generated direct .work child, never a user path.
      if (path.dirname(output) !== path.resolve('.work') || !path.basename(output).startsWith('ui1-probe-test-'))
        throw new Error('Unexpected test output');
      await rm(output, { recursive: true, force: true });
    }
  }
});

test('development counters cannot be written to the normal dist', () => {
  expect(() =>
    execFileSync(process.execPath, ['scripts/build.mjs'], {
      env: { ...process.env, WW_ASSET_PROFILE: '0', WW_BUILD_OUT: 'dist', WW_PAGE_CHANGE_PROBE: '1' },
      stdio: 'pipe',
    }),
  ).toThrow(/Development page-change probes must stay inside .work/);
});

test('CPU measurement build refuses a destination outside .work before building', () => {
  expect(() => execFileSync(process.execPath, ['scripts/ui1/build.mjs', '.', 'dist'], { stdio: 'pipe' })).toThrow(
    /Measurement builds must stay inside/,
  );
});
