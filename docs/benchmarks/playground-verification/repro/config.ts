import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 10000 },
  outputDir: '../evidence/custom-results',
  projects: [
    { name: 'unit', testMatch: '**/*unit.spec.ts' },
    { name: 'e2e', testIgnore: '**/*unit.spec.ts', use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' } },
  ],
});
