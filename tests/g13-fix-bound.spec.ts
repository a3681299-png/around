import { build } from 'esbuild';
import { test, expect } from './fixtures';

// Codex's sparse-read repro (docs/g13-fix-verification.md, 古い位置の上限), unchanged but for running
// both of its clocks: a controlled performance.now and real time. A whole read, then the first group
// checked, then that group's control moved with no mutation, then the remaining groups caught up:
// a read 200ms later must not return the moved control's old box.
for (const realtime of [false, true])
  test(`independent sparse reads keep each control within 200ms plus one round (${realtime ? 'real time' : 'controlled clock'})`, async ({
    youtube,
  }, info) => {
    const bundle = await build({
      stdin: {
        contents: "export {youtubeOperations} from './src/sites/youtube-operations';",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'G13Bound',
      dropLabels: ['WW_GUARD_TRACE', 'WW_TEST_PAGE_CHANGE'],
    });
    await youtube.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const result = await youtube.evaluate(async (realtime) => {
      await new Promise((r) => setTimeout(r, 450));
      const source = (window as any).G13Bound.youtubeOperations(document);
      await new Promise((r) => setTimeout(r, 450));
      const nativeNow = performance.now.bind(performance);
      const origin = nativeNow();
      const rect = Element.prototype.getBoundingClientRect;
      let clock = 0;
      let reads: Element[] = [];
      const readTimes = new Map<Element, number>();
      if (!realtime) Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
      Element.prototype.getBoundingClientRect = function () {
        reads.push(this);
        readTimes.set(this, realtime ? nativeNow() - origin : clock);
        return rect.call(this);
      };
      try {
        const initial = source.capture({ fresh: true });
        reads = [];
        const waitUntil = async (at: number) => {
          if (realtime) await new Promise((r) => setTimeout(r, Math.max(0, at - (nativeNow() - origin))));
          else clock = at;
        };
        const firstAt = realtime ? 380 : 400;
        await waitUntil(firstAt);
        source.capture({ coalesce: true });
        const candidates = reads.filter((e) => e.matches('button,a,input'));
        const target = candidates.find((e) => {
          const r = rect.call(e);
          return (
            r.width > 0 &&
            r.height > 0 &&
            initial.surfaces.some(
              (s: any) =>
                Math.abs(s.shape.left - r.left) < 0.1 &&
                Math.abs(s.shape.top - r.top) < 0.1 &&
                Math.abs(s.shape.width - r.width) < 0.1,
            )
          );
        });
        if (!target)
          throw new Error(
            'No visible control in the first group: ' + candidates.map((e) => e.outerHTML.slice(0, 100)).join(','),
          );
        const lastConfirmed = readTimes.get(target)!;
        const before = rect.call(target);
        const surface = initial.surfaces.find(
          (s: any) =>
            Math.abs(s.shape.left - before.left) < 0.1 &&
            Math.abs(s.shape.top - before.top) < 0.1 &&
            Math.abs(s.shape.width - before.width) < 0.1,
        )!;
        const animation = target.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(150px)' }], {
          duration: 1,
          fill: 'forwards',
        });
        animation.pause();
        animation.currentTime = 1;
        const mutations: any[] = [];
        const observer = new MutationObserver((records) => {
          mutations.push(
            ...records.map((r) => ({
              at: nativeNow() - origin,
              type: r.type,
              attribute: r.attributeName,
              target: (r.target as Element).outerHTML?.slice(0, 180),
            })),
          );
        });
        observer.observe(document, { attributes: true, childList: true, subtree: true });
        const rows: any[] = [];
        for (const at of realtime ? [381, 779, 880, 1000] : [401, 799, 900, 1000]) {
          await waitUntil(at);
          reads = [];
          const snapshot = source.capture({ coalesce: true });
          const value = snapshot.surfaces.find((s: any) => s.id === surface.id);
          const sampled = realtime ? nativeNow() - origin : at;
          rows.push({
            at: sampled,
            targetRead: reads.includes(target),
            snapshot: value?.shape.left,
            actual: rect.call(target).left,
            lastConfirmed,
            age: sampled - lastConfirmed,
            pending: source.pending(),
            mutations: mutations.length,
          });
        }
        observer.disconnect();
        animation.cancel();
        return { realtime, target: target.outerHTML.slice(0, 250), bound: 200 + 6 * 34, rows, mutations };
      } finally {
        source.destroy();
        Element.prototype.getBoundingClientRect = rect;
        Object.defineProperty(performance, 'now', { configurable: true, value: nativeNow });
      }
    }, realtime);
    await info.attach('sparse-bound.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    console.log('SPARSE_BOUND', JSON.stringify(result));
    expect(result.rows.filter((r) => r.age > result.bound && Math.abs(r.snapshot - r.actual) > 1)).toEqual([]);
  });
