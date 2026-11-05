import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const output = '.work/layering-test-dist';
let built: Promise<string> | undefined;

/** The chunk 4 prototype build (WW_LAYERING=1 in scripts/build.mjs, docs/layering-plan.md): the
 * player's character goes under its controls by stacking order. Built once per worker, inside
 * .work only (the build refuses any other output). */
export function layeringBuild(): Promise<string> {
  built ??= promisify(execFile)(process.execPath, ['scripts/build.mjs'], {
    env: { ...process.env, WW_LAYERING: '1', WW_BUILD_OUT: output },
  }).then(() => path.resolve(output));
  return built;
}
