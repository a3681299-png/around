import { build } from 'esbuild';
import { test, expect } from './fixtures';

test('independent geometry witnesses for animation, resized group and external subtree', async ({ youtube }, info) => {
  const bundle = await build({
    stdin: { contents: "export {youtubeOperations} from './src/sites/youtube-operations';", resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'G13Probe',
  });
  await youtube.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const results = await youtube.evaluate(async () => {
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const style = document.createElement('style');
    style.textContent = '.g13-wide{width:180px!important}';
    document.head.append(style);
    const run = async (kind: string) => {
      // A fixed-sized layout makes the sibling move without resizing the document root.
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;left:300px;top:250px;width:500px;height:80px;display:flex;align-items:flex-start;z-index:0';
      box.innerHTML =
        '<div id="below" style="display:flex;flex:none"><button style="width:70px;height:40px">First</button></div><div id="secondary" style="flex:none"><button style="width:70px;height:40px">Second</button></div>';
      document.querySelector('ytd-app')!.append(box);
      const first = box.querySelector<HTMLButtonElement>('#below button')!;
      const second = box.querySelector<HTMLButtonElement>('#secondary button')!;
      const source = (window as any).G13Probe.youtubeOperations(document);
      await wait(450);
      const before = source.capture({ fresh: true });
      const old = second.getBoundingClientRect();
      const oldSurface = before.surfaces.find(
        (s: any) =>
          Math.abs(s.shape.left - old.left) < 0.1 &&
          Math.abs(s.shape.top - old.top) < 0.1 &&
          Math.abs(s.shape.width - old.width) < 0.1,
      );
      if (!oldSurface) throw new Error('second control was not discovered');
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.length;
      });
      observer.observe(box, { attributes: true, childList: true, subtree: true });
      if (kind === 'animation' || kind === 'animationQuiet') {
        second.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(150px)' }], {
          duration: 1,
          fill: 'forwards',
        });
        if (kind === 'animation') document.dispatchEvent(new Event('scroll'));
      } else if (kind === 'look') first.classList.add('g13-wide');
      else {
        const added = document.createElement('span');
        added.style.cssText = 'display:block;flex:none;width:110px;height:40px';
        box.querySelector('#below')!.append(added);
      }
      await wait(0);
      const at = await frame();
      if (kind === 'animation') await frame();
      if (kind === 'animationQuiet') {
        const until = performance.now() + 500;
        while (performance.now() < until) {
          await frame();
          source.capture({ coalesce: true });
        }
      }
      const snapshot = source.capture({ coalesce: true });
      const stale = snapshot.surfaces.find((s: any) => s.id === oldSurface.id);
      const actual = second.getBoundingClientRect();
      const pending = source.pending();
      const beforeInput = {
        at,
        pending,
        mutations,
        old: old.left,
        snapshot: stale?.shape.left,
        actual: actual.left,
        layout: snapshot.generation.layout,
        x: actual.left + actual.width / 2,
        y: actual.top + actual.height / 2,
      };
      const hit = document.elementFromPoint(beforeInput.x, beforeInput.y);
      const event = new PointerEvent('pointerdown', { bubbles: true, clientX: beforeInput.x, clientY: beforeInput.y });
      const valid = source.validate(snapshot, event);
      const fresh = source.capture();
      const current = fresh.surfaces.find((s: any) => s.id === oldSurface.id);
      observer.disconnect();
      source.destroy();
      box.remove();
      return {
        kind,
        ...beforeInput,
        hit: hit?.tagName,
        valid,
        fresh: current?.shape.left,
        freshLayout: fresh.generation.layout,
      };
    };
    const results = [];
    for (const kind of ['animation', 'animationQuiet', 'look', 'subtree']) results.push(await run(kind));
    style.remove();
    return results;
  });
  console.log('G13_GEOMETRY ' + JSON.stringify(results));
  await info.attach('geometry.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results).toHaveLength(4);
});
