import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runs between measured blocks, never inside a CPU/frame capture. Read-only; kills nothing. */
export async function auditHost() {
  if (process.env.UI1_HOST_AUDIT !== '1') return undefined;
  if (process.platform !== 'win32') throw new Error('Host audit currently requires Windows.');
  const script = fileURLToPath(new URL('./host-audit.ps1', import.meta.url));
  const { stdout } = await promisify(execFile)(
    path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', script, '-OwnerPid', String(process.pid)],
    { windowsHide: true, timeout: 30_000 },
  );
  return JSON.parse(stdout.trim());
}
