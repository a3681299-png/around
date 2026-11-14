import { build } from 'esbuild';
import { test, expect } from './fixtures';

async function probe() {
  return (
    await build({
      stdin: {
        contents: "export {youtubeOperations} from './src/sites/youtube-operations';",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Bound2',
      dropLabels: ['AROUND_GUARD_TRACE', 'AROUND_TEST_PAGE_CHANGE'],
    })
  ).outputFiles[0]!.text;
}

test('independent source oracle: irregular reads and changing control populations', async ({ youtube }, info) => {
  test.setTimeout(90_000);
  await youtube.addScriptTag({ content: await probe() });
  const result = await youtube.evaluate(async () => {
    const source = (window as any).Bound2.youtubeOperations(document);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const rect = Element.prototype.getBoundingClientRect;
    const nativeNow = performance.now.bind(performance);
    let clock = 0;
    const readTimes = new Map<Element, number>();
    Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
    Element.prototype.getBoundingClientRect = function () {
      readTimes.set(this, clock);
      return rect.call(this);
    };
    const box = document.createElement('div');
    document.querySelector('ytd-app')!.append(box);
    const populations: any[] = [],
      trials: any[] = [],
      violations: any[] = [];
    let seed = 0x2752026;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    try {
      source.capture({ fresh: true });
      // Repartition the same source, including removing most controls after the largest set.
      for (const count of [1, 5, 6, 7, 31, 120, 240, 3]) {
        box.replaceChildren();
        const controls: HTMLElement[] = [];
        for (let i = 0; i < count; i++) {
          const button = document.createElement('button');
          button.id = `bound2-${i}`;
          button.textContent = String(i);
          button.style.cssText = `position:fixed;left:${250 + (i % 12) * 55}px;top:${150 + Math.floor(i / 12) * 25}px;width:37px;height:19px`;
          box.append(button);
          controls.push(button);
        }
        clock += 1500;
        // A population change must be discovered without a test-requested fresh read.
        let population = source.capture({ coalesce: true });
        clock += 205;
        population = source.capture({ coalesce: true });
        const discovered = controls.filter((element) => {
          const r = rect.call(element);
          return population.surfaces.some(
            (s: any) =>
              Math.abs(s.shape.left - r.left) < 0.1 &&
              Math.abs(s.shape.top - r.top) < 0.1 &&
              Math.abs(s.shape.width - r.width) < 0.1,
          );
        }).length;
        populations.push({
          count,
          discovered,
          surfaceCount: population.surfaces.length,
          generation: population.generation,
        });
        for (let trial = 0; trial < 12; trial++) {
          clock += 1500;
          const base = clock;
          const initial = source.capture({ fresh: true });
          const target = controls[[0, Math.floor(count / 2), count - 1][trial % 3]!]!;
          const before = rect.call(target);
          const surface = initial.surfaces.find(
            (s: any) =>
              Math.abs(s.shape.left - before.left) < 0.1 &&
              Math.abs(s.shape.top - before.top) < 0.1 &&
              Math.abs(s.shape.width - before.width) < 0.1,
          );
          if (!surface) throw new Error(`Missing witness ${count}/${trial}`);
          clock += 201 + Math.floor(random() * 203);
          source.capture({ coalesce: true });
          const lastConfirmed = readTimes.get(target)!;
          const animation = target.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(150px)' }], {
            duration: 1,
            fill: 'forwards',
          });
          animation.pause();
          animation.currentTime = 1;
          const movedAt = clock,
            rows: any[] = [];
          let foundAt: number | null = null;
          const gaps = [1, 7, 8, 9, 16, 33, 34, 50, 199, 200, 201, 403, 404, 405, 699, 1301];
          for (let read = 0; read < 24; read++) {
            clock += gaps[Math.floor(random() * gaps.length)]!;
            const snapshot = source.capture({ coalesce: true });
            const value = snapshot.surfaces.find((s: any) => s.id === surface.id);
            const actual = rect.call(target).left;
            const stale = value && Math.abs(value.shape.left - actual) > 0.5;
            const row = {
              t: clock - base,
              gap: read ? clock - (base + rows.at(-1).t) : clock - movedAt,
              age: clock - lastConfirmed,
              stale: Boolean(stale),
              snapshot: value?.shape.left,
              actual,
              pending: source.pending(),
              targetReadAt: readTimes.get(target)! - base,
            };
            rows.push(row);
            if (!stale && foundAt === null) foundAt = clock - movedAt;
            // Pending layout boxes are held by the guard; the contract here is a trusted read.
            if (stale && source.pending() !== 'layout' && row.age > 404)
              violations.push({ count, trial, target: target.id, lastConfirmed: lastConfirmed - base, row });
          }
          trials.push({
            count,
            trial,
            target: target.id,
            movedAt: movedAt - base,
            lastConfirmed: lastConfirmed - base,
            foundAt,
            rows,
          });
          animation.cancel();
        }
      }
      return { populations, trials, violations };
    } finally {
      source.destroy();
      box.remove();
      Element.prototype.getBoundingClientRect = rect;
      Object.defineProperty(performance, 'now', { configurable: true, value: nativeNow });
    }
  });
  await info.attach('irregular-populations.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  console.log('POPULATIONS', JSON.stringify(result.populations));
  console.log(
    'IRREGULAR',
    JSON.stringify({
      trials: result.trials.length,
      reads: result.trials.reduce((n, t) => n + t.rows.length, 0),
      violations: result.violations,
    }),
  );
  expect(result.populations.every((p) => p.count === p.discovered)).toBe(true);
  expect(result.trials.every((t) => t.foundAt !== null)).toBe(true);
  expect(result.violations).toEqual([]);
});
