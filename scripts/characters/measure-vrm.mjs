#!/usr/bin/env node
// Runs a VRM through Around's own import check and body measure (src/assets/glb.ts inspectGlb,
// src/characters/humanoid.ts classifyBody): whether Around accepts the file within its limits, its
// proportions, and whether the standard motions apply (stage 2) or only the simple ones (stage 1).
//   node scripts/characters/measure-vrm.mjs <model.vrm>
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const file = process.argv[2];
if (!file) {
  console.error('Usage: measure-vrm.mjs <model.vrm>');
  process.exit(2);
}
const bundle = await build({
  stdin: {
    contents:
      "export { inspectGlb } from './src/assets/glb'; export { classifyBody, BODY_THRESHOLDS } from './src/characters/humanoid';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const { inspectGlb, classifyBody, BODY_THRESHOLDS } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const bytes = new Uint8Array(await readFile(file));
const started = performance.now();
const { info, gpuBytes } = inspectGlb(bytes);
const inspectMs = performance.now() - started;
const body = info.model?.vrm?.body;
console.log(
  JSON.stringify(
    {
      bytes: bytes.length,
      inspectMs: Math.round(inspectMs * 10) / 10,
      gpuBytes,
      model: {
        ...info.model,
        vrm: info.model?.vrm && { ...info.model.vrm, humanoid: info.model.vrm.humanoid?.length },
      },
      body,
      classification: body ? classifyBody(body) : 'unmeasured',
      thresholds: BODY_THRESHOLDS,
    },
    null,
    1,
  ),
);
