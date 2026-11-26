import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const evidence = path.resolve('.work/verify-evidence');
await mkdir(evidence, { recursive: true });
const probes = {
  dot: 'void chrome.storage;',
  bracket: 'void chrome["storage"];',
  alias: 'const c = chrome; void c.storage;',
  optional: 'void chrome?.storage;',
  globalThis: 'void globalThis.chrome.storage;',
  window: 'void window.chrome.storage;',
  self: 'void self.chrome.storage;',
  windowBracket: 'void window["chrome"].storage;',
  computed: 'void window["ch" + "rome"].storage;',
  objectAlias: 'const w = window; void w.chrome.storage;',
  typeOnly: 'export type Sender = chrome.runtime.MessageSender;',
  local: 'export function local(chrome: object) { return chrome; }',
};
const boundary = {};
for (const side of ['fix', 'head']) {
  const cwd = path.resolve(side === 'head' ? '.' : '../verify-chunk2-fix');
  const lint = new ESLint({ cwd });
  const rows = [];
  for (const [name, source] of Object.entries(probes)) {
    // ESLint's type-aware parser needs a real tsconfig member. The source text is virtual.
    const [result] = await lint.lintText(source, { filePath: 'src/host/world-session.ts' });
    rows.push({ name, source, errors: result.messages.map(({ ruleId, message }) => ({ ruleId, message })) });
  }
  const [allowed] = await lint.lintText(probes.dot, { filePath: 'src/browser/take-storage.ts' });
  boundary[side] = { rows, browserAllowed: allowed.errorCount === 0 };
  for (const name of ['dot', 'bracket', 'alias', 'optional', 'globalThis', 'window', 'self'])
    if (
      !rows
        .find((row) => row.name === name)
        .errors.some((error) => /^no-restricted-(globals|properties)$/.test(error.ruleId ?? ''))
    )
      process.exitCode = 1;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
const show = (sha, file) => git('show', `${sha}:${file}`);
const files = git('diff', '--name-only', '7688942', '842e42f', '--', 'tests').trim().split(/\r?\n/);
const artworkCall =
  /getByRole\(\s*'switch',\s*\{\s*name:\s*'作品を表示する'(?:\s*,\s*exact:\s*true)?\s*\}\s*\)\s*\.check\(\)/g;
const baselineFiles = new Set(git('ls-tree', '-r', '--name-only', '7688942', '--', 'tests').trim().split(/\r?\n/));
const edits = files
  .filter((file) => baselineFiles.has(file))
  .map((file) => {
    const before = show('7688942', file);
    const after = show('842e42f', file);
    return {
      file,
      before: [...before.matchAll(artworkCall)].length,
      after: [...after.matchAll(artworkCall)].length,
      showArtwork: [...after.matchAll(/await showArtwork\(/g)].length,
    };
  })
  .filter((row) => row.before || row.after || row.showArtwork);
const history = git('log', '--all', '--stat', '--', '*PochibyKT_Pochi*').trim();
const switchDiff = git('show', '--format=', '7793d5f', '--', 'tests');
const replacements = {
  removedCheck: [...switchDiff.matchAll(/^-(?!-).*作品を表示する.*\.check\(/gm)].length,
  addedHelper: [...switchDiff.matchAll(/^\+(?!\+).*await showArtwork\(/gm)].length,
  helper: show('842e42f', 'tests/helpers/artwork.ts'),
};
const fileProof = async (file) => {
  const bytes = await readFile(file);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const modules = [
  'src/world/body-motion.ts',
  'src/world/models.ts',
  'src/characters/two-bone-ik.ts',
  'src/renderers/three/vrm-player.ts',
];
const names = /youtube|playground|ytp[-_]|ytd[-_]|video-player|masthead/i;
const siteNames = {};
for (const file of modules)
  siteNames[file] = (await readFile(file, 'utf8')).split(/\r?\n/).filter((line) => names.test(line));
await writeFile(
  path.join(evidence, 'static.json'),
  JSON.stringify(
    {
      boundary,
      edits,
      replacements,
      siteNames,
      history,
      manifestDiff: git(
        'diff',
        '447b2bf',
        '842e42f',
        '--',
        'manifest.json',
        'src/design/schema.ts',
        'src/design/migrations.ts',
      ),
      ordinary: await fileProof('.work/extension/content/index.js'),
      ui1: await fileProof('.work/perf/content/index.js'),
      g11: await fileProof('.work/g11-measurement-dist/content/index.js'),
    },
    null,
    2,
  ),
);
