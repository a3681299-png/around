declare const __AROUND_WORLD_MODE__: 'legacy' | 'compare' | 'runtime';
declare const __AROUND_WORLD_DEVTOOLS__: boolean;
declare const __AROUND_LAYERING__: boolean | undefined;
/** Chunk 4 (docs/layering-plan.md): the player's character goes into the player's own stacking,
 * under its controls. The default in every build; a AROUND_LAYERING=0 development build (scripts/build.mjs)
 * keeps the earlier cut-out way, which also stays as the way out where a part cannot be proven. */
export const LAYERING = typeof __AROUND_LAYERING__ === 'undefined' || __AROUND_LAYERING__;
declare const __AROUND_SPACE_PROBE__: boolean | undefined;
declare const __AROUND_SPACE_BREAK__: '' | 'stacking' | 'density' | 'names' | undefined;
/** The depth foundation's test probe (scripts/build.mjs AROUND_SPACE_PROBE=1, .work builds only). */
export const SPACE_PROBE = typeof __AROUND_SPACE_PROBE__ !== 'undefined' && __AROUND_SPACE_PROBE__;
/** A .work build that breaks one of the depth foundation's protections on purpose (AROUND_SPACE_BREAK). */
export const SPACE_BREAK = typeof __AROUND_SPACE_BREAK__ === 'undefined' ? '' : __AROUND_SPACE_BREAK__;
/** Build-time developer switches, never read from artwork or the web page. */
export const WORLD_MODE = typeof __AROUND_WORLD_MODE__ === 'undefined' ? 'runtime' : __AROUND_WORLD_MODE__;
export const WORLD_DEVTOOLS = typeof __AROUND_WORLD_DEVTOOLS__ !== 'undefined' && __AROUND_WORLD_DEVTOOLS__;
