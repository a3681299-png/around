import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('.work/g14-perf'),
  outputDir: path.resolve('.work/perf-results'),
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  projects: [{ name: 'e2e', testMatch: ['perf.spec.ts'] }],
});
