import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['perf.spec.ts', 'capture-strict.spec.ts'],
  workers: 1,
  fullyParallel: false,
  timeout: 3_600_000,
  expect: { timeout: 10_000 },
  outputDir: '../r31-fix-evidence/perf-test-results',
  projects: [{ name: 'e2e', use: { trace: 'retain-on-failure' } }],
});
