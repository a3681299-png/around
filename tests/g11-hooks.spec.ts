import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { G11_ENABLED, g11GuardDisabled, g11RegisterRefresh } from '../src/diagnostics/g11-hooks';

/** The hooks module bundled the way a build would, then run in a fresh global with a probe. */
async function bundled(define: Record<string, string>) {
  const { outputFiles } = await build({
    stdin: {
      contents: `import * as hooks from './src/diagnostics/g11-hooks'; globalThis.result = (() => {
        globalThis.__g11DisableGuard = true;
        hooks.g11RegisterRefresh(() => 'redraw');
        return { enabled: hooks.G11_ENABLED, guardDisabled: hooks.g11GuardDisabled(), refresh: typeof globalThis.__g11Probe.refresh };
      })();`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define,
  });
  const sandbox: Record<string, unknown> = { __g11Probe: {}, performance };
  sandbox.globalThis = sandbox;
  runInNewContext(outputFiles[0]!.text, sandbox);
  return sandbox.result as { enabled: boolean; guardDisabled: boolean; refresh: string };
}

test('without the build flag the hooks are off: the guard cannot be switched off from a global', () => {
  (globalThis as { __g11DisableGuard?: boolean }).__g11DisableGuard = true;
  (globalThis as { __g11Probe?: { refresh?: unknown } }).__g11Probe = {};
  try {
    expect(G11_ENABLED).toBe(false);
    expect(g11GuardDisabled()).toBe(false);
    g11RegisterRefresh(() => undefined);
    expect((globalThis as { __g11Probe?: { refresh?: unknown } }).__g11Probe!.refresh).toBeUndefined();
  } finally {
    delete (globalThis as { __g11DisableGuard?: boolean }).__g11DisableGuard;
    delete (globalThis as { __g11Probe?: unknown }).__g11Probe;
  }
});

test('the product builds define the flag false; only the measurement build turns the hooks on', async () => {
  expect(await bundled({ __WW_G11__: 'false' })).toEqual({
    enabled: false,
    guardDisabled: false,
    refresh: 'undefined',
  });
  expect(await bundled({})).toEqual({ enabled: false, guardDisabled: false, refresh: 'undefined' });
  expect(await bundled({ __WW_G11__: 'true' })).toEqual({ enabled: true, guardDisabled: true, refresh: 'function' });
});
