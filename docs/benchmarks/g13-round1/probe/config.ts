import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('.work/g13r0-probes'),
  outputDir: path.resolve('.work/g13r0-evidence/probe-results'),
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  projects: [{ name: 'e2e', testMatch: ['trace.spec.ts'], use: { screenshot: 'only-on-failure' } }],
});
