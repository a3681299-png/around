import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('.work/g12v-probes'),
  outputDir: path.resolve('.work/g12v-evidence/probe-results'),
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'unit', testMatch: 'unit.spec.ts' },
    {
      name: 'e2e',
      testMatch: ['browser.spec.ts', 'perf.spec.ts'],
      use: { screenshot: 'only-on-failure' },
    },
  ],
});
