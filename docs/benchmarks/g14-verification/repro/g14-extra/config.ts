import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('.work/g14-extra'),
  outputDir: path.resolve('.work/g14-extra/results'),
  workers: 1,
  timeout: 90000,
  reporter: 'list',
  projects: [{ name: 'e2e' }],
});
