import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('scripts/g13'),
  outputDir: path.resolve('.work/g13-no-extension-results'),
  workers: 1,
  reporter: 'list',
  projects: [{ name: 'e2e', testMatch: ['verify-no-extension.spec.ts'] }],
});
