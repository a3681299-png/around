import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const output = '.work/no-idle-recheck';
let built: Promise<string> | undefined;

/** The explicit development build without the guard's idle recheck (G1.4, WW_NO_IDLE_RECHECK=1 in
 * scripts/build.mjs). For tests that must keep a stale clip on purpose until an input arrives, so
 * they check the input-time defence alone; the recheck itself is tested in g14-idle-recheck. Built
 * once per worker, inside .work only (the build refuses any other output). */
export function noIdleRecheckBuild(): Promise<string> {
  built ??= promisify(execFile)(process.execPath, ['scripts/build.mjs'], {
    env: { ...process.env, WW_NO_IDLE_RECHECK: '1', WW_BUILD_OUT: output },
  }).then(() => path.resolve(output));
  return built;
}
