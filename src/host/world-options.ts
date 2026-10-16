declare const __WW_WORLD_MODE__: 'legacy' | 'compare' | 'runtime';
declare const __WW_WORLD_DEVTOOLS__: boolean;
/** Build-time developer switches, never read from artwork or the web page. */
export const WORLD_MODE = typeof __WW_WORLD_MODE__ === 'undefined' ? 'runtime' : __WW_WORLD_MODE__;
export const WORLD_DEVTOOLS = typeof __WW_WORLD_DEVTOOLS__ !== 'undefined' && __WW_WORLD_DEVTOOLS__;
