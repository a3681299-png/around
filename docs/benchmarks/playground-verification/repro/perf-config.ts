import { defineConfig } from '@playwright/test';
// The collector owns CDP Tracing and its files. Do not add Playwright's automatic trace ZIP.
export default defineConfig({
  testDir: '.',
  testMatch: 'perf.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 3600000,
  expect: { timeout: 10000 },
  outputDir: '../evidence/perf-test-results',
  projects: [{ name: 'e2e', use: { trace: 'off', screenshot: 'off' } }],
});
