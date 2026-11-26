import { defineConfig } from '@playwright/test';
import path from 'node:path';
// G1.3 measurement scenes only (scripts/g13/perf.spec.ts). Run through scripts/test.mjs:
// npm run test:e2e -- --config=scripts/g13/config.ts
export default defineConfig({
  testDir: path.resolve('scripts/g13'),
  outputDir: path.resolve('.work/g13-perf/test-results'),
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  projects: [{ name: 'e2e', testMatch: ['perf.spec.ts'] }],
});
