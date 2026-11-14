/**
 * Measurement hooks for the G1 harness (scripts/g11). Off in every product build: they turn on
 * only when a build defines `__AROUND_G11__` as true (scripts/g11/build.mjs). The product builds define
 * it as false and a build that defines nothing is off too (`typeof`), so every hook is a no-op at
 * runtime there. The small hook bodies stay in an unminified bundle; nothing in them runs. The harness itself prepends the frame probe (`globalThis.__g11Probe`); these hooks only hand
 * it what it cannot reach from outside: the controller, the guard switch, the full redraw and the
 * recapture timing. Before this module, the harness rewrote source text to the same effect.
 */
declare const __AROUND_G11__: boolean | undefined;
export const G11_ENABLED: boolean = typeof __AROUND_G11__ !== 'undefined' && __AROUND_G11__ === true;

interface G11Probe {
  recording?: boolean;
  captures?: { time: number; ms: number; surfaces: number }[];
  refresh?: () => void;
  controller?: unknown;
  snapshot?: () => unknown;
  hooks?: number;
}
/** Bumped when the hooks change, so the harness can refuse a build with older hooks. */
export const G11_HOOKS_VERSION = 1;

function probe(): G11Probe | undefined {
  if (!G11_ENABLED) return undefined;
  const value = (globalThis as { __g11Probe?: G11Probe }).__g11Probe;
  if (value) value.hooks = G11_HOOKS_VERSION;
  return value;
}

/** The harness's comparison switch: build the page without the operation guard. */
export function g11GuardDisabled(): boolean {
  return G11_ENABLED && Boolean((globalThis as { __g11DisableGuard?: boolean }).__g11DisableGuard);
}

/** The harness forces a full redraw every frame through this (steady mode). */
export function g11RegisterRefresh(refresh: () => void): void {
  const target = probe();
  if (target) target.refresh = refresh;
}

/** The controller and a snapshot reader for the harness's area and state checks. */
export function g11ExposeController(controller: unknown, snapshot: () => unknown): void {
  const target = probe();
  if (!target) return;
  target.controller = controller;
  target.snapshot = snapshot;
}

/** Start time of one full recapture of the operation surfaces (0 when off). */
export function g11CaptureStart(): number {
  return G11_ENABLED ? performance.now() : 0;
}
export function g11CaptureEnd(start: number, surfaces: number): void {
  const target = probe();
  if (target?.recording) target.captures?.push({ time: start, ms: performance.now() - start, surfaces });
}
