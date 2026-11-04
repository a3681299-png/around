import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('scripts/g13'),
  outputDir: path.resolve('.work/fix-visual-results'),
  workers: 1,
  projects: [{ name: 'e2e', testMatch: ['fix-visual.spec.ts'] }],
});
