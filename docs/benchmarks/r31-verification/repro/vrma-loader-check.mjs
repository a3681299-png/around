import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { inspectAsset as oldInspect } from './before.mjs';
import { inspectAsset, vrmaFixture } from './after.mjs';
await build({
  stdin: {
    contents: 'export {parseVrmAnimation} from "./src/renderers/three/vrma-clip.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: '.work/r31-tools/vrma-loader.mjs',
  logLevel: 'silent',
});
const { parseVrmAnimation } = await import('./vrma-loader.mjs'),
  results = [];
for (const name of ['valid', 'bad-scene-index', 'bad-scene-root', 'derived-hips-infinity']) {
  const bytes = vrmaFixture({}, (j) => {
    if (name === 'bad-scene-index') j.scene = 999;
    if (name === 'bad-scene-root') j.scenes[0].nodes = [999];
    if (name === 'derived-hips-infinity') {
      j.nodes[0].children = [7];
      for (let n = 0; n < 51; n++) j.nodes.push({ scale: [1, 1e6, 1], children: [n === 50 ? 1 : 8 + n] });
      j.nodes[1].translation = [0, 1e6, 0];
    }
  });
  const row = { name, bytes: bytes.length };
  for (const [label, fn] of [
    ['before', oldInspect],
    ['after', inspectAsset],
  ]) {
    try {
      const info = fn(new Uint8Array(bytes));
      row[label] = { accepted: true, restHipsHeight: String(info.vrmAnimation?.restHipsHeight) };
    } catch (e) {
      row[label] = { accepted: false, error: e.message };
    }
  }
  try {
    const animation = await parseVrmAnimation(new Uint8Array(bytes));
    row.loader = {
      accepted: true,
      duration: animation.duration,
      restHipsHeight: String(animation.restHipsPosition?.y),
    };
  } catch (e) {
    row.loader = { accepted: false, error: e.message };
  }
  results.push(row);
}
await writeFile('.work/evidence/vrma-loader.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
