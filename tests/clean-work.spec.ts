import { test, expect } from '@playwright/test';
// @ts-expect-error A plain ESM script without types; only its rules are tested here.
import { decide, decideTemp, familyOf, unlinkLinksInside } from '../scripts/clean-work.mjs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const hour = 3600e3;
const now = Date.UTC(2026, 10, 3, 12);
const entry = (name: string, ageHours: number, extra: Record<string, unknown> = {}) => ({
  name,
  kind: 'dir',
  newestMs: now - ageHours * hour,
  bytes: 1e6,
  ...extra,
});
const run = (entries: unknown[], options: Record<string, unknown> = {}) =>
  Object.fromEntries(
    (
      decide(entries, { now, keep: 3, recentMs: 12 * hour, referenced: new Set(['g12v-probes']), ...options }) as any[]
    ).map((d) => [d.name, `${d.action}:${d.reason}`]),
  );

test('a family is the name up to its first separator', () => {
  expect(familyOf('g13r0-trace')).toBe('g13r0');
  expect(familyOf('g-lint-final-3.log')).toBe('g');
  expect(familyOf('ab3.sh')).toBe('ab3');
  expect(familyOf('run-AbC123')).toBe('run');
});

test('the browsers, patches, files the docs use and recent writes are always kept', () => {
  const result = run([
    entry('browsers', 400),
    entry('oplive-wip.patch', 400, { kind: 'file' }),
    entry('g12v-probes', 400),
    entry('g13r3-trace', 2),
  ]);
  expect(result).toEqual({
    browsers: 'keep:browsers',
    'oplive-wip.patch': 'keep:patch',
    'g12v-probes': 'keep:docs',
    'g13r3-trace': 'keep:recent',
  });
});

test('each family keeps its newest three; older ones are deleted', () => {
  const result = run([
    entry('g13r0-trace', 100),
    entry('g13r0-normal', 90),
    entry('g13r0-evidence', 80),
    entry('g13r0-head-dist', 70),
    entry('g13r0-probes', 60),
    entry('ui1-a', 100),
  ]);
  expect(result).toEqual({
    'g13r0-probes': 'keep:latest',
    'g13r0-head-dist': 'keep:latest',
    'g13r0-evidence': 'keep:latest',
    'g13r0-normal': 'delete:older',
    'g13r0-trace': 'delete:older',
    'ui1-a': 'keep:latest',
  });
});

test('protected entries do not count towards a family’s newest three', () => {
  const result = run([
    entry('g13-recent', 1),
    entry('g13-a', 50),
    entry('g13-b', 60),
    entry('g13-c', 70),
    entry('g13-d', 80),
  ]);
  expect(result['g13-recent']).toBe('keep:recent');
  expect(result['g13-c']).toBe('keep:latest');
  expect(result['g13-d']).toBe('delete:older');
});

test('worktrees are removed through git only when unused, and never by the automatic clean-up', () => {
  const worktrees = [
    entry('g12-557', 100, { kind: 'worktree', inUse: false }),
    entry('main-base', 100, { kind: 'worktree', inUse: true }),
  ];
  expect(run(worktrees)).toEqual({ 'g12-557': 'remove-worktree:unused', 'main-base': 'keep:worktree in use' });
  expect(run(worktrees, { automatic: true })).toEqual({
    'g12-557': 'keep:worktree (manual only)',
    'main-base': 'keep:worktree in use',
  });
});

test('a worktree with a branch checked out is kept, even run from another checkout and in the automatic clean-up', () => {
  // The main checkout's .work holds the working checkout on its branch (creator-editor) beside
  // the verifier's detached ones; run from main, none of them is "this checkout".
  const worktrees = [
    entry('creator-editor', 100, { kind: 'worktree', inUse: false, branch: 'codex/creator-editor-spike' }),
    entry('g13-fix-verify', 100, { kind: 'worktree', inUse: false }),
  ];
  expect(run(worktrees)).toEqual({
    'creator-editor': 'keep:worktree on a branch',
    'g13-fix-verify': 'remove-worktree:unused',
  });
  expect(run(worktrees, { automatic: true })['creator-editor']).toBe('keep:worktree on a branch');
});

test('only the comparison bases are kept among unused worktrees, even when docs name the others or they are recent', () => {
  const result = run(
    [
      entry('g13-g12head', 100, { kind: 'worktree', inUse: false }),
      entry('g13-before', 100, { kind: 'worktree', inUse: false }),
      entry('main-base', 100, { kind: 'worktree', inUse: false }),
      entry('g12-recent', 1, { kind: 'worktree', inUse: false }),
    ],
    { referenced: new Set(['main-base']) },
  );
  expect(result).toEqual({
    'g13-g12head': 'keep:comparison base',
    'g13-before': 'keep:comparison base',
    'main-base': 'remove-worktree:unused',
    'g12-recent': 'remove-worktree:unused',
  });
});

test('before a worktree is removed, every link inside it is cut, however deep, and what they point at stays', () => {
  // git worktree remove --force follows a Windows junction and empties its target: a worktree's
  // .work/browsers/chromium-1243 → the user-wide Playwright Chromium was lost that way (2026-11-07).
  const root = mkdtempSync(path.join(tmpdir(), 'around-clean-links-'));
  try {
    const target = path.join(root, 'shared');
    mkdirSync(target);
    writeFileSync(path.join(target, 'chrome.exe'), 'x');
    const tree = path.join(root, 'tree');
    mkdirSync(path.join(tree, '.work', 'browsers'), { recursive: true });
    symlinkSync(target, path.join(tree, 'node_modules'), 'junction');
    symlinkSync(target, path.join(tree, '.work', 'browsers', 'chromium-1243'), 'junction');
    expect(unlinkLinksInside(tree)).toBe(2);
    expect(existsSync(path.join(tree, '.work', 'browsers', 'chromium-1243'))).toBe(false);
    expect(existsSync(path.join(tree, 'node_modules'))).toBe(false);
    rmSync(tree, { recursive: true, force: true });
    expect(existsSync(path.join(target, 'chrome.exe'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('browser profiles the tests and measurements left in the system temp folder go after a few hours; nothing else there is touched', () => {
  const result = Object.fromEntries(
    (
      decideTemp(
        [
          entry('around-space-live-AbC123', 30),
          entry('around-chunk3-perf-profiles', 50),
          entry('c34-run-xY9z', 7),
          entry('playwright_chromiumdev_profile-Qw12', 10),
          // A run in progress (written in the last hours) stays.
          entry('around-r32-perf-Zz99', 1),
          // Not ours: other programs' temp folders and the session's own.
          entry('hd2lgjud.abc', 400),
          entry('claude', 400),
          entry('codex-artifact-session-1', 400),
          entry('ScreenToGif', 400),
        ],
        { now, recentMs: 6 * hour },
      ) as any[]
    ).map((d) => [d.name, d.action]),
  );
  expect(result).toEqual({
    'around-space-live-AbC123': 'delete',
    'around-chunk3-perf-profiles': 'delete',
    'c34-run-xY9z': 'delete',
    'playwright_chromiumdev_profile-Qw12': 'delete',
    'around-r32-perf-Zz99': 'keep',
  });
});
