import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: ['extra.spec.ts', 'live-visual.spec.ts', 'sidepanel-visual.spec.ts', 'perf.spec.ts'],
  workers: 1,
  fullyParallel: false,
  timeout: 240000,
  expect: { timeout: 10000 },
  outputDir: '../r31-extra-results',
  projects: [{ name: 'e2e', use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' } }],
});
