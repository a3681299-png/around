// The Playground is public: its output must never carry the private character (トルーシェ),
// a private model (PochibyKT_Pochi*) or Mixamo-derived motion (docs/playground-plan.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Names and byte patterns that mean a forbidden file got in (Mixamo rigs name bones mixamorig…). */
export const FORBIDDEN = Object.freeze([/trusie/i, /トルーシェ/, /pochibykt/i, /mixamo/i, /usamimi/i]);
const MODEL_FILE = /\.(vrm|vrma|glb|gltf|fbx|bvh)$/i;

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Problems in a built Playground folder. `allowedModels` are the model files the build itself wrote. */
export function playgroundOutputProblems(root, allowedModels) {
  const problems = [];
  for (const path of files(root)) {
    const label = relative(root, path).replaceAll('\\', '/');
    if (FORBIDDEN.some((pattern) => pattern.test(label))) problems.push(`${label}: forbidden name`);
    if (MODEL_FILE.test(label) && !allowedModels.includes(label))
      problems.push(`${label}: a model or motion the Playground build did not make`);
    // Text and glTF JSON chunks are readable as latin1; this finds bone names, metadata and paths.
    const text = readFileSync(path).toString('latin1');
    const utf8 = readFileSync(path).toString('utf8');
    for (const pattern of FORBIDDEN)
      if (pattern.test(text) || pattern.test(utf8)) {
        problems.push(`${label}: contains ${pattern}`);
        break;
      }
  }
  return problems;
}
