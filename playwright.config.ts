import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './.work/test-results',
  fullyParallel: false,
  workers: 1,
  maxFailures: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
});
