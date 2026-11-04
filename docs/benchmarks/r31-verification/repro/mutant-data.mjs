import {
  inspectAsset,
  inspectVrma,
  vrmaFixture,
  vrmFixture,
  parseDesign,
  defaultModelSettings,
  validateDesignAssets,
} from './after.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bad = vrmaFixture({}, (j) => (j.meshes = [])),
  info = inspectVrma(vrmaFixture()).info,
  source = inspectAsset(vrmFixture()).model,
  asset = (n) => 'asset-' + n.toString(16).padStart(64, '0');
const history = JSON.parse(await readFile('tests/fixtures/designs/history-v13.json', 'utf8'));
const layer = {
  ...parseDesign(history).decorations[0],
  source,
  assetId: asset(1),
  model: defaultModelSettings(source),
  character: {
    standardMotions: 'auto',
    motions: [
      {
        id: 'idle',
        assetId: asset(2),
        role: 'idle',
        origin: 'character',
        loop: true,
        source: { ...info, duration: 2 },
      },
    ],
  },
};
const assets = new Map([
    [asset(1), { model: source }],
    [asset(2), { vrmAnimation: info }],
  ]),
  results = [];
assert.throws(() => inspectAsset(new Uint8Array(bad)));
assert.throws(() => validateDesignAssets([layer], assets));
for (const fault of ['vrma', 'facts']) {
  const module = await import(`../r31-no-${fault}/probe.mjs`);
  let message = '';
  try {
    if (fault === 'vrma') assert.throws(() => module.inspectAsset(new Uint8Array(bad)));
    else assert.throws(() => module.validateDesignAssets([layer], assets));
  } catch (e) {
    message = e.message;
  }
  results.push({
    fault,
    test: fault === 'vrma' ? 'mesh motion must be refused' : 'measured duration must match asset',
    failed: !!message,
    error: message,
  });
}
await writeFile('.work/evidence/data-mutants.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
assert.ok(
  results.every((r) => r.failed),
  'Every guard mutant must fail its rejection assertion',
);
