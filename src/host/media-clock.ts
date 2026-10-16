export interface MediaClockInstance { running(): boolean; tick(deltaMs: number): void; refresh(): void; destroy(): void }

/** Browser lifecycle and shared RAF cadence, separate from frame/time calculation. */
export function createMediaClockHost(doc: Document, instances: ReadonlySet<MediaClockInstance>, fps: number) {
  const view = doc.defaultView!, reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let closed = false, raf: number | undefined, previous: number | undefined;
  const canRun = () => !closed && !doc.hidden && !reduced.matches;
  const schedule = () => {
    const active = canRun() && [...instances].some((instance) => instance.running());
    if (!active) { if (raf !== undefined) view.cancelAnimationFrame(raf); raf = previous = undefined; }
    else if (raf === undefined) raf = view.requestAnimationFrame(tick);
  };
  function tick(time: number) {
    raf = undefined;
    if (!canRun()) { previous = undefined; instances.forEach((instance) => instance.refresh()); return; }
    const delta = previous === undefined ? 0 : time - previous;
    if (previous === undefined || delta >= 1000 / fps - .5) { previous = time; instances.forEach((instance) => instance.tick(delta)); }
    schedule();
  }
  const lifecycle = () => { instances.forEach((instance) => instance.refresh()); schedule(); };
  doc.addEventListener('visibilitychange', lifecycle); reduced.addEventListener('change', lifecycle);
  return { canRun, schedule, hidden: () => doc.hidden, reducedMotion: () => reduced.matches,
    destroy() {
      closed = true; if (raf !== undefined) view.cancelAnimationFrame(raf); raf = previous = undefined;
      doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle);
    } };
}
