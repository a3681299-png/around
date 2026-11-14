import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Global setup/teardown: specs create their own `%TEMP%\around-*` browser profiles, and some reopen
 * one after a restart, so none is removed when its browser closes. After the run, whether tests
 * passed, failed or timed out, remove every such profile created since this run started. Older
 * directories are left alone; they may belong to another run.
 */
export default function temporaryProfiles() {
  const started = Date.now();
  return async () => {
    const root = tmpdir();
    for (const name of await readdir(root).catch(() => [] as string[])) {
      if (!name.startsWith('around-')) continue;
      const directory = path.join(root, name);
      const info = await stat(directory).catch(() => undefined);
      if (!info?.isDirectory() || info.birthtimeMs < started - 1000) continue;
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error: unknown) => {
        process.stderr.write('Temporary profile sweep: ' + String(error) + '\n');
      });
    }
  };
}
