// Verification-only fault builds (Claude Code, R3-1 fix check). Dependency substitution with
// esbuild; product sources and the normal build stay untouched. Output: .work/rv-no-<fault>.
import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(),
  before = path.resolve(root, '../r31v-before');
const slash = (p) => p.split(path.sep).join('/');
const abs = (p) => slash(path.resolve(root, p));
const faults = {
  // R31-1: body never takes part in the model match (both sides stripped).
  body: {
    target: 'src/models/types.ts',
    contents: `export * from 'rv-original';
      const strip = (m) => (m && m.vrm ? { ...m, vrm: (({ body, ...rest }) => rest)(m.vrm) } : m);
      export function sameModelInfo(source, measured) {
        return Boolean(measured) && JSON.stringify(strip(source)) === JSON.stringify(strip(measured));
      }`,
  },
  // R31-2: the motion inspector as it was before the fix (no scene/root/unused-reference checks).
  refs: { target: 'src/assets/vrma.ts', redirect: path.join(before, 'src/assets/vrma.ts') },
  // R31-3: re-import no longer refreshes the layer source (session as before the fix).
  'refresh-session': {
    target: 'src/editor-core/session.ts',
    redirect: path.join(before, 'src/editor-core/session.ts'),
  },
  // R31-3: re-import no longer writes body into the existing record (worker as before the fix).
  'refresh-record': {
    target: 'src/background/index.ts',
    redirect: path.join(before, 'src/background/index.ts'),
    entryOnly: true,
  },
};
const entries = [
  ['src/backup/page.ts', 'backup/index.js', true],
  ['src/assets/read-frame.ts', 'assets/read-frame.js', false],
  ['src/browser/studio-page.ts', 'studio/index.js', true],
  ['src/background/index.ts', 'background/index.js', false],
  ['src/content/index.ts', 'content/index.js', true],
  ['src/popup/index.ts', 'popup/index.js', true],
];
for (const [name, fault] of Object.entries(faults)) {
  const out = path.resolve('.work/rv-no-' + name);
  await cp('.work/rv-dist', out, { recursive: true });
  const target = abs(fault.target).replace(/\.ts$/, '');
  let substituted = 0;
  const plugin = {
    name: 'rv-' + name,
    setup(b) {
      b.onResolve({ filter: /^rv-original$/ }, () => ({ path: abs(fault.target) }));
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point' || !args.path.startsWith('.')) return;
        const resolved = slash(path.resolve(args.resolveDir, args.path)).replace(/\.ts$/, '');
        if (resolved !== target) return;
        substituted++;
        return fault.redirect ? { path: fault.redirect } : { path: 'wrapper', namespace: 'rv' };
      });
      b.onLoad({ filter: /.*/, namespace: 'rv' }, () => ({ contents: fault.contents, loader: 'js', resolveDir: root }));
    },
  };
  for (const [entry, file, css] of entries) {
    const point = fault.entryOnly && abs(entry).replace(/\.ts$/, '') === target ? fault.redirect : entry;
    if (point !== entry) substituted++;
    await build({
      absWorkingDir: root,
      entryPoints: [point],
      outfile: path.join(out, file),
      bundle: true,
      format: 'iife',
      target: 'chrome120',
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'error',
      dropLabels: ['AROUND_TEST_PAGE_CHANGE', 'AROUND_GUARD_TRACE'],
      define: {
        __AROUND_PAGE_CHANGE_LEGACY__: 'false',
        __AROUND_WORLD_MODE__: '"runtime"',
        __AROUND_WORLD_DEVTOOLS__: 'false',
        __AROUND_ASSET_PROFILE__: 'false',
      },
      ...(css ? { loader: { '.css': 'text' } } : {}),
      plugins: [plugin],
    });
  }
  console.log(name, 'substitutions', substituted, '->', out);
}
