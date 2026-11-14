import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const built = new Map<string, Promise<string>>();

/** The way the normal build (dist) keeps the player's character clear: the AROUND_LAYERING default of
 * scripts/build.mjs. Changed together with it. */
export const DEFAULT_LAYERING = true;

/** A development build with the player's character kept clear of the controls one way
 * (docs/layering-plan.md): layering true puts it under them by stacking order, false cuts the
 * bands out as before. Built once per worker and setting, inside .work only (the build refuses any
 * other output). `variant` adds another development switch of scripts/build.mjs (as
 * AROUND_NO_IDLE_RECHECK=1) to the same build. */
export function layeringBuild(layering: boolean, variant: Record<string, string> = {}): Promise<string> {
  // Keys and values: AROUND_SPACE_BREAK=names and =density are different builds.
  const suffix = Object.keys(variant).length
    ? `-${Object.entries(variant)
        .map(([k, v]) => (v === '1' ? k : `${k}-${v}`))
        .join('-')
        .toLowerCase()}`
    : '';
  const output = `.work/test-dist-${layering ? 'layering' : 'cutout'}${suffix.replaceAll('_', '-')}`;
  let build = built.get(output);
  if (!build) {
    build = promisify(execFile)(process.execPath, ['scripts/build.mjs'], {
      env: { ...process.env, ...variant, AROUND_LAYERING: layering ? '1' : '0', AROUND_BUILD_OUT: output },
    }).then(() => path.resolve(output));
    built.set(output, build);
  }
  return build;
}
