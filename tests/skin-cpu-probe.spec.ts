import { test, expect } from '@playwright/test';
import { createContext, runInContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build, transform } from 'esbuild';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';

const probeUrl = pathToFileURL(path.resolve('scripts/ui1/probe-build.mjs')).href;

test('diagnostic dependency injection disables only the optional pixel port and preserves other exports', async () => {
  const { disableInkPlugin } = await import(probeUrl);
  await mkdir('.work', { recursive: true });
  const root = await mkdtemp(path.resolve('.work/ui1-ink-port-test-'));
  try {
    await mkdir(path.join(root, 'src/design'), { recursive: true });
    await writeFile(
      path.join(root, 'src/design/renderer.ts'),
      `
      export const compileDesign = () => 'css';
      export function createDesignRenderer(doc, targets, assets, onStatus) {
        return { doc, targets, pixels: assets.pixels, load: assets.load(), revoke: assets.revoke(), status: onStatus() };
      }
    `,
    );
    const output = await build({
      absWorkingDir: root,
      stdin: {
        contents: `
        import { compileDesign, createDesignRenderer } from './src/design/renderer';
        globalThis.result = { css: compileDesign(), renderer: createDesignRenderer('doc', ['target'], {
          pixels: () => 'pixels', load: () => 'loaded', revoke: () => 'revoked'
        }, () => 'status') };
      `,
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: 'iife',
      plugins: [disableInkPlugin(root)],
    });
    const sandbox = createContext({});
    runInContext(output.outputFiles[0]!.text, sandbox);
    expect(sandbox.result.css).toBe('css');
    expect(JSON.parse(JSON.stringify(sandbox.result.renderer))).toEqual({
      doc: 'doc',
      targets: ['target'],
      load: 'loaded',
      revoke: 'revoked',
      status: 'status',
    });
    expect(sandbox.result.renderer.pixels).toBeUndefined();
  } finally {
    if (path.dirname(root) !== path.resolve('.work') || !path.basename(root).startsWith('ui1-ink-port-test-'))
      throw new Error('Unexpected diagnostic test directory');
    await rm(root, { recursive: true, force: true });
  }
});

test('event-property CPU is included while callback identity, clearing and this stay native', async () => {
  const { probeBuildOptions } = await import(probeUrl);
  const options = await probeBuildOptions();
  let now = 0;
  type Handler = (this: object, ...args: unknown[]) => unknown;
  const listeners = new WeakMap<object, Handler | null>();
  class MessagePort {
    get onmessage() {
      return listeners.get(this) ?? null;
    }
    set onmessage(fn: Handler | null) {
      listeners.set(this, fn);
    }
  }
  const sandbox: Record<string, any> = {
    performance: { now: () => now },
    requestAnimationFrame() {},
    setTimeout,
    setInterval,
    MessagePort,
    EventTarget: class {
      addEventListener() {}
      removeEventListener() {}
    },
    HTMLVideoElement: class {},
    consume: (ms: number) => {
      now += ms;
    },
  };
  sandbox.window = sandbox;
  const context = createContext(sandbox);
  runInContext(
    options.banner.js +
      `
    globalThis.port = new MessagePort();
    globalThis.callback = function() { if (this !== port) throw new Error('lost this'); consume(2); };
    port.onmessage = callback;
    globalThis.sameCallback = port.onmessage === callback;
  `,
    context,
  );
  expect(sandbox.sameCallback).toBe(true);
  listeners.get(sandbox.port)!.call(sandbox.port);
  expect(sandbox.__ui1Probe.calls).toEqual([0, 2]);
  expect(sandbox.__ui1Probe.kinds['event-property']).toBe(1);
  runInContext('port.onmessage = null', context);
  expect(listeners.get(sandbox.port)).toBeNull();
});

test('CPU probe includes each post-await segment and rejection recovery without counting suspended time twice', async () => {
  const { probeBuildOptions } = await import(probeUrl);
  const options = await probeBuildOptions();
  let now = 0;
  const frames: Array<(time: number) => void> = [];
  const sandbox: Record<string, any> = {
    performance: { now: () => now },
    requestAnimationFrame: (callback: (time: number) => void) => frames.push(callback),
    setTimeout,
    setInterval,
    EventTarget: class {
      addEventListener() {}
      removeEventListener() {}
    },
    HTMLVideoElement: class {},
    consume: (ms: number) => {
      now += ms;
    },
  };
  sandbox.window = sandbox;
  const context = createContext(sandbox);
  const source = `
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    globalThis.release = () => release();
    async function child() { await Promise.resolve(); consume(2); }
    requestAnimationFrame(async () => {
      consume(1);
      await pending;
      consume(3);
      await child();
      try { await Promise.reject(new Error('expected')); }
      catch { consume(4); }
      finally { consume(5); }
      globalThis.finished = true;
    });
  `;
  const { code } = await transform(source, { target: 'chrome120', supported: options.supported });
  runInContext(options.banner.js + code, context);
  for (const callback of frames.splice(0)) callback(now);
  expect(sandbox.__ui1Probe.calls.filter((_: number, index: number) => index % 2)).toEqual([1]);
  // An actual asynchronous suspension, not a resolved-promise microtask. Advancing the clock
  // by a second must not turn that wait into extension CPU time.
  now += 1000;
  runInContext('release()', context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(sandbox.finished).toBe(true);
  const calls: number[] = sandbox.__ui1Probe.calls;
  const durations = calls.filter((_, index) => index % 2);
  expect(durations.reduce((sum, ms) => sum + ms, 0)).toBe(15);
  expect(Math.max(...durations)).toBeLessThanOrEqual(9);
  expect(sandbox.__ui1Probe.kinds.promise).toBeGreaterThanOrEqual(4);
});
