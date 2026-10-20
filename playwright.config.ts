import { defineConfig } from '@playwright/test';

// These specs use in-memory ports, data fixtures and document stubs only.
// fullyParallel gives each test a worker-isolated module/global environment.
const unitSpecs = [
  'asset-import-validation', 'asset-profile', 'asset-runtime', 'asset-shared-pool',
  'comment-timestamps', 'design', 'editor-core', 'effect-data', 'features', 'group-data', 'host-signals',
  'image-data', 'layer-data', 'layout', 'media-sampler', 'media2-data',
  'model-animation', 'model-data', 'model-motion', 'model-rig', 'motion-data', 'palette',
  'signal-motion', 'signal-rules', 'signal-takes', 'timeline-host', 'vrm-data',
  'world-boundaries', 'world-compatibility', 'world-media-time', 'world-recording', 'world-runtime', 'world-timeline-host', 'youtube-details',
].map((name) => `**/${name}.spec.ts`);

export default defineConfig({
  testDir: './tests',
  outputDir: './.work/test-results',
  fullyParallel: false,
  workers: 4,
  maxFailures: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  projects: [
    { name: 'unit', testMatch: unitSpecs, fullyParallel: true, outputDir: './.work/test-results/unit' },
    // Browser benchmarks and native Chrome windows share host resources.
    { name: 'e2e', testIgnore: unitSpecs, fullyParallel: false, workers: 1, outputDir: './.work/test-results/e2e' },
  ],
});
