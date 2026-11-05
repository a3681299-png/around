declare const __WW_WORLD_MODE__: 'legacy' | 'compare' | 'runtime';
declare const __WW_WORLD_DEVTOOLS__: boolean;
declare const __WW_LAYERING__: boolean | undefined;
/** Chunk 4 (docs/layering-plan.md): the player's character goes into the player's own stacking,
 * under its controls. The default in every build; a WW_LAYERING=0 development build (scripts/build.mjs)
 * keeps the earlier cut-out way, which also stays as the way out where a part cannot be proven. */
export const LAYERING = typeof __WW_LAYERING__ === 'undefined' || __WW_LAYERING__;
/** Build-time developer switches, never read from artwork or the web page. */
export const WORLD_MODE = typeof __WW_WORLD_MODE__ === 'undefined' ? 'runtime' : __WW_WORLD_MODE__;
export const WORLD_DEVTOOLS = typeof __WW_WORLD_DEVTOOLS__ !== 'undefined' && __WW_WORLD_DEVTOOLS__;
