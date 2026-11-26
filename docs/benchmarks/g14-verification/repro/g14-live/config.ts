import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('.work/g14-live'),
  outputDir: path.resolve('.work/g14-live/results'),
  workers: 1,
  projects: [{ name: 'e2e', testMatch: ['live-shot.spec.ts'] }],
});
