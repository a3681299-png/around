// WWT skills live in agent-skills/ and are installed per user, so Claude Code and Codex can use
// them on every branch (including branches that do not contain agent-skills/).
//   node scripts/install-skills.mjs          copy agent-skills/* to ~/.claude/skills and ~/.agents/skills
//   node scripts/install-skills.mjs --check  fail when an installed copy is missing or out of date
// Only the folders named in agent-skills/ are replaced; other installed skills are left untouched.
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const skillSource = join(root, 'agent-skills');
const destinations = [
  { tool: 'Claude Code', directory: join(homedir(), '.claude/skills') },
  { tool: 'Codex', directory: join(homedir(), '.agents/skills') },
];

/** claude-mem writes a CLAUDE.md of notes into folders it sees; it is not part of a skill. */
const copied = (file) => basename(file) !== 'CLAUDE.md';

async function files(directory) {
  const found = new Map();
  async function walk(at) {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const file = join(at, entry.name);
      if (!copied(file)) continue;
      if (entry.isDirectory()) await walk(file);
      // Compare text with normalized line endings so a CRLF checkout matches its own copy.
      else
        found.set(
          relative(directory, file).replaceAll('\\', '/'),
          (await readFile(file, 'utf8')).replace(/\r\n/g, '\n'),
        );
    }
  }
  await walk(directory);
  return found;
}

/** Problems with the skill folders themselves (used by scripts/lint.mjs). */
export async function skillProblems() {
  const problems = [];
  for (const entry of await readdir(skillSource, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    let text;
    try {
      text = await readFile(join(skillSource, name, 'SKILL.md'), 'utf8');
    } catch {
      problems.push(`agent-skills/${name}: SKILL.md is missing`);
      continue;
    }
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const field = (key) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front)?.[1]?.trim();
    if (!/^wwt-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) problems.push(`agent-skills/${name}: name must start with wwt-`);
    if (field('name') !== name) problems.push(`agent-skills/${name}: frontmatter name must be "${name}"`);
    const description = field('description');
    if (!description) problems.push(`agent-skills/${name}: description is missing`);
    else if (description.length > 1024) problems.push(`agent-skills/${name}: description is over 1024 characters`);
  }
  return problems;
}

async function names() {
  return (await readdir(skillSource, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
}

if (/install-skills\.mjs$/.test(process.argv[1] ?? '')) {
  const problems = await skillProblems();
  if (problems.length) throw new Error(problems.join('\n'));
  if (process.argv.includes('--check')) {
    const stale = [];
    for (const name of await names()) {
      const source = await files(join(skillSource, name));
      for (const { tool, directory } of destinations) {
        const installed = await files(join(directory, name));
        const same =
          installed.size === source.size && [...source].every(([file, text]) => installed.get(file) === text);
        if (!same) stale.push(`${tool}: ${join(directory, name)}`);
      }
    }
    if (stale.length) throw new Error(`Out of date:\n${stale.join('\n')}\nRun: node scripts/install-skills.mjs`);
    console.log('WWT skills are installed and up to date for Claude Code and Codex.');
  } else {
    for (const { tool, directory } of destinations) {
      await mkdir(directory, { recursive: true });
      for (const name of await names()) {
        await rm(join(directory, name), { recursive: true, force: true });
        await cp(join(skillSource, name), join(directory, name), { recursive: true, filter: copied });
      }
      console.log(`${tool}: ${directory}`);
    }
    console.log(`Installed: ${(await names()).join(', ')}`);
  }
}
