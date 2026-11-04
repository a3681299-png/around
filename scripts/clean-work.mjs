// Keeps .work from growing without bound (docs/tooling.md, ".work の整理").
//
//   node scripts/clean-work.mjs --dry-run   list what would be deleted or kept, and the space freed
//   node scripts/clean-work.mjs             delete it (worktrees through git worktree remove / prune)
//
// Rules, in order: the Playwright browsers (.work/browsers), patches (*.patch), anything the docs,
// scripts or tests name as .work/<name>, and anything with a file written in the last 12 hours are
// kept. A worktree is kept when it is in use (a tracked change, locked, or this checkout) or is a
// comparison base (KEEP_WORKTREES); any other is removed, by a manual run only. Every other output is grouped into a family (its name up to
// the first "-", "_" or ".", such as g13r0 for g13r0-trace) and each family keeps its newest
// three. Folders of browser profiles (*-profiles) are sorted the same way one level down.
//
// The test and measurement entry points call autoClean() when they finish: at most once a day,
// and only when .work is over 20 GB, it deletes by the same rules (never a worktree).
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOUR = 3600e3;
export const KEEP_PER_FAMILY = 3;
/** The worktrees measurements are compared against (G1.3: 4d3f39b and 557b978). */
export const KEEP_WORKTREES = ['g13-g12head', 'g13-before'];
export const RECENT_MS = 12 * HOUR;
export const AUTO_LIMIT_BYTES = 20 * 1024 ** 3;
const AUTO_EVERY_MS = 24 * HOUR;
const STAMP = '.clean-work-stamp';

export const familyOf = (name) => name.split(/[-_.]/)[0].toLowerCase() || name.toLowerCase();

/** What to do with each entry. Pure, so the rules are tested apart from the file system. */
export function decide(entries, { now, keep = KEEP_PER_FAMILY, recentMs = RECENT_MS, referenced, automatic = false }) {
  const decisions = new Map();
  const candidates = [];
  for (const e of entries) {
    const set = (action, reason) => decisions.set(e.name, { ...e, action, reason });
    // A worktree is judged apart: docs name old ones as the place a result came from, which the
    // commit recorded with it already identifies, so only the comparison bases stay.
    if (e.kind === 'worktree')
      if (e.inUse) set('keep', 'worktree in use');
      else if (KEEP_WORKTREES.includes(e.name)) set('keep', 'comparison base');
      else if (automatic) set('keep', 'worktree (manual only)');
      else set('remove-worktree', 'unused');
    else if (e.name === 'browsers') set('keep', 'browsers');
    else if (e.name.startsWith('.') || e.name === 'CLAUDE.md') set('keep', 'internal');
    else if (e.name.endsWith('.patch')) set('keep', 'patch');
    else if (referenced.has(e.name)) set('keep', 'docs');
    else if (now - e.newestMs < recentMs) set('keep', 'recent');
    else candidates.push(e);
  }
  const families = new Map();
  for (const e of candidates) {
    const list = families.get(familyOf(e.name)) ?? [];
    list.push(e);
    families.set(familyOf(e.name), list);
  }
  for (const list of families.values()) {
    list.sort((a, b) => b.newestMs - a.newestMs);
    list.forEach((e, i) =>
      decisions.set(e.name, { ...e, action: i < keep ? 'keep' : 'delete', reason: i < keep ? 'latest' : 'older' }),
    );
  }
  return entries.map((e) => decisions.get(e.name));
}

/** Size and newest write time of a path, never following a link (a worktree's node_modules is a
 * junction to this checkout's own). */
function measure(target) {
  let bytes = 0,
    newestMs = 0,
    files = 0;
  const stack = [target];
  while (stack.length) {
    const at = stack.pop();
    let info;
    try {
      info = lstatSync(at);
    } catch {
      continue;
    }
    newestMs = Math.max(newestMs, info.mtimeMs);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      let names = [];
      try {
        names = readdirSync(at);
      } catch {}
      for (const name of names) stack.push(path.join(at, name));
    } else {
      bytes += info.size;
      files++;
    }
  }
  return { bytes, newestMs, files };
}

/** Deletes a path without following links: a link (or a Windows junction) is unlinked, never entered. */
function remove(target) {
  const info = lstatSync(target);
  if (info.isSymbolicLink()) {
    try {
      unlinkSync(target);
    } catch {
      rmdirSync(target);
    }
    return;
  }
  if (info.isDirectory()) {
    for (const name of readdirSync(target)) remove(path.join(target, name));
    rmdirSync(target);
  } else unlinkSync(target);
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Worktrees directly inside .work, with whether each is in use. */
function worktrees(root, work) {
  const rows = [];
  let current;
  for (const line of git(root, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) rows.push((current = { path: path.resolve(line.slice(9)), locked: false }));
    else if (line.startsWith('locked') && current) current.locked = true;
  }
  const own = path.resolve(root);
  return new Map(
    rows
      .filter((row) => path.dirname(row.path).toLowerCase() === path.resolve(work).toLowerCase())
      .map((row) => {
        let changed = true;
        try {
          changed = git(row.path, ['status', '--porcelain', '--untracked-files=no']).trim().length > 0;
        } catch {}
        return [
          path.basename(row.path),
          { inUse: row.locked || changed || row.path.toLowerCase() === own.toLowerCase() },
        ];
      }),
  );
}

/** Top-level names of .work that the docs, scripts or tests mention as .work/<name>. */
function referencedNames(root) {
  const names = new Set();
  const roots = ['docs', 'scripts', 'tests', 'agent-skills'].map((d) => path.join(root, d));
  const files = [path.join(root, 'AGENTS.md'), path.join(root, 'playwright.config.ts')];
  const stack = [...roots];
  while (stack.length) {
    const at = stack.pop();
    let info;
    try {
      info = lstatSync(at);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) for (const name of readdirSync(at)) stack.push(path.join(at, name));
    else if (/\.(md|mjs|js|ts|json|html|ps1|sh)$/.test(at) && info.size < 5e6) files.push(at);
  }
  for (const file of files) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(/\.work[\\/]([A-Za-z0-9_.-]+)/g)) names.add(match[1].replace(/\.$/, ''));
  }
  return names;
}

/** The plan for .work: each top-level entry (and each profile under a *-profiles folder) decided. */
export function plan({ root, now = Date.now(), automatic = false }) {
  const work = path.join(root, '.work');
  const referenced = referencedNames(root);
  const trees = worktrees(root, work);
  const top = readdirSync(work).map((name) => {
    const at = path.join(work, name);
    const info = measure(at);
    const kind = trees.has(name) ? 'worktree' : lstatSync(at).isDirectory() ? 'dir' : 'file';
    return { name, path: at, kind, ...info, ...(trees.get(name) ?? {}) };
  });
  const decisions = decide(top, { now, referenced, automatic });
  // Profiles: one folder per run inside; the folder itself stays, its runs are sorted.
  for (const holder of decisions.filter((d) => /-profiles$/.test(d.name) && d.kind === 'dir' && d.action === 'keep')) {
    const runs = readdirSync(holder.path).map((name) => {
      const at = path.join(holder.path, name);
      return { name, path: at, kind: 'dir', ...measure(at) };
    });
    const inner = decide(runs, { now, referenced: new Set(), automatic });
    decisions.push(...inner.map((d) => ({ ...d, name: `${holder.name}/${d.name}` })));
    holder.bytes = inner.filter((d) => d.action === 'keep').reduce((sum, d) => sum + d.bytes, 0);
    holder.reason += ' (runs sorted inside)';
  }
  return decisions;
}

/** Carries out a plan: deletes, then removes worktrees through git (their links unlinked first). */
export function apply(decisions, { root }) {
  let freed = 0;
  for (const d of decisions.filter((x) => x.action === 'delete')) {
    try {
      remove(d.path);
      freed += d.bytes;
    } catch (error) {
      console.warn(`clean-work: could not delete ${d.name}: ${error.message}`);
    }
  }
  for (const d of decisions.filter((x) => x.action === 'remove-worktree')) {
    try {
      // A junction (node_modules → this checkout's) must go before git deletes the folder.
      for (const name of readdirSync(d.path)) {
        const at = path.join(d.path, name);
        if (lstatSync(at).isSymbolicLink()) remove(at);
      }
      // --force: only untracked outputs remain (tracked changes made it "in use").
      git(root, ['worktree', 'remove', '--force', d.path]);
      freed += d.bytes;
    } catch (error) {
      console.warn(`clean-work: could not remove worktree ${d.name}: ${error.message}`);
    }
  }
  git(root, ['worktree', 'prune']);
  return freed;
}

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
export function report(decisions) {
  const lines = [];
  const top = decisions.filter((d) => !d.name.includes('/') || d.action !== 'keep');
  const sum = (list) => list.reduce((s, d) => s + d.bytes, 0);
  const del = decisions.filter((d) => d.action === 'delete'),
    trees = decisions.filter((d) => d.action === 'remove-worktree'),
    kept = top.filter((d) => d.action === 'keep');
  lines.push(
    `.work: ${gb(sum(top.filter((d) => !d.name.includes('/'))) + sum(decisions.filter((d) => d.name.includes('/') && d.action !== 'keep')))}`,
  );
  lines.push(`delete: ${del.length} entries, ${gb(sum(del))}`);
  lines.push(`remove worktree: ${trees.length}, ${gb(sum(trees))}`);
  lines.push(`keep: ${kept.length} entries, ${gb(sum(kept))}`);
  lines.push(`freed: ${gb(sum(del) + sum(trees))}`);
  const byReason = new Map();
  for (const d of kept) byReason.set(d.reason, [...(byReason.get(d.reason) ?? []), d]);
  lines.push('', 'kept, by reason:');
  for (const [reason, list] of [...byReason].sort((a, b) => sum(b[1]) - sum(a[1])))
    lines.push(`  ${reason.padEnd(32)} ${String(list.length).padStart(5)}  ${gb(sum(list))}`);
  lines.push('', 'worktrees:');
  for (const d of decisions.filter((x) => x.kind === 'worktree'))
    lines.push(`  ${d.action.padEnd(16)} ${d.reason.padEnd(26)} ${gb(d.bytes).padStart(10)}  ${d.name}`);
  lines.push('', 'largest deletions:');
  for (const d of [...del].sort((a, b) => b.bytes - a.bytes).slice(0, 40))
    lines.push(`  ${gb(d.bytes).padStart(10)}  ${d.name}`);
  lines.push('', 'largest kept:');
  for (const d of [...kept].sort((a, b) => b.bytes - a.bytes).slice(0, 25))
    lines.push(`  ${gb(d.bytes).padStart(10)}  ${d.reason.padEnd(32)} ${d.name}`);
  return lines.join('\n');
}

/** Called by scripts/test.mjs and the measurement scripts when they finish. */
export function autoClean(root) {
  if (process.env.CI || process.env.WW_CLEAN_WORK === '0') return;
  const stamp = path.join(root, '.work', STAMP);
  try {
    if (Date.now() - statSync(stamp).mtimeMs < AUTO_EVERY_MS) return;
  } catch {}
  try {
    writeFileSync(stamp, new Date().toISOString());
    const decisions = plan({ root, automatic: true });
    const size = decisions.filter((d) => !d.name.includes('/')).reduce((s, d) => s + d.bytes, 0);
    if (size < AUTO_LIMIT_BYTES) return;
    const freed = apply(decisions, { root });
    console.log(
      `clean-work: .work was ${gb(size)}, over ${gb(AUTO_LIMIT_BYTES)}; freed ${gb(freed)} (docs/tooling.md)`,
    );
  } catch (error) {
    console.warn(`clean-work: skipped (${error.message})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dry = process.argv.includes('--dry-run');
  const decisions = plan({ root });
  const text = report(decisions);
  console.log(text);
  writeFileSync(
    path.join(root, '.work', 'clean-work-plan.txt'),
    text + '\n\nall:\n' + decisions.map((d) => `${d.action}\t${d.reason}\t${d.bytes}\t${d.name}`).join('\n'),
  );
  if (!dry) console.log(`\nfreed ${gb(apply(decisions, { root }))}`);
}
