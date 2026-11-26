import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  workers: 1,
  timeout: 3_600_000,
  expect: { timeout: 15_000 },
  projects: [{ name: 'e2e', use: { trace: 'off' } }, { name: 'unit' }],
});
