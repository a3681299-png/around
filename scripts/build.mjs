import { context } from 'esbuild';
import { copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profiling = process.env.AROUND_ASSET_PROFILE === '1';
const outputName = profiling ? '.work/asset-profile-dist' : (process.env.AROUND_BUILD_OUT ?? 'dist');
if (!/^(dist|\.work\/[a-zA-Z0-9_-]+)$/.test(outputName))
  throw new Error('AROUND_BUILD_OUT must be dist or a direct .work child.');
const outDir = join(root, outputName);
const pageChangeProbe = process.env.AROUND_PAGE_CHANGE_PROBE === '1';
if (pageChangeProbe && !outputName.startsWith('.work/'))
  throw new Error('Development page-change probes must stay inside .work.');
// Logs why an input check stopped drawing (expected and actual click target); src/host/guard-trace.ts.
const guardTrace = process.env.AROUND_GUARD_TRACE === '1';
if (guardTrace && !outputName.startsWith('.work/')) throw new Error('Development guard traces must stay inside .work.');
// Breaks the guard on purpose: no idle recheck of drawn artwork (G1.4), to see its tests fail.
const noIdleRecheck = process.env.AROUND_NO_IDLE_RECHECK === '1';
if (noIdleRecheck && !outputName.startsWith('.work/'))
  throw new Error('Builds without the idle recheck must stay inside .work.');
// Chunk 4 (docs/layering-plan.md): the player's character sits inside the player's own stacking,
// under its controls. AROUND_LAYERING=0 is the earlier way (over the controls with the bands cut out),
// for development builds only: to compare, and to run the G1 specs that way too.
const layering = process.env.AROUND_LAYERING !== '0';
if (!layering && !outputName.startsWith('.work/'))
  throw new Error('Builds without layering (AROUND_LAYERING=0) must stay inside .work.');
// Breaks the layering guard on purpose: no stacking proof (every player part taken as over the
// character), to see its tests fail (docs/layering-plan.md).
const noStackingProof = process.env.AROUND_NO_STACKING_PROOF === '1';
if (noStackingProof && !outputName.startsWith('.work/'))
  throw new Error('Builds without the stacking proof must stay inside .work.');
// Development only: the autonomy's inner states (boredom, sleepiness) move this many times as
// fast, to see a doze or a change of seat without waiting minutes (docs/characters/mirdo.md).
const autonomyPace = Number(process.env.AROUND_AUTONOMY_PACE ?? '1');
if (!(autonomyPace >= 1 && autonomyPace <= 100)) throw new Error('AROUND_AUTONOMY_PACE must be 1…100.');
if (autonomyPace !== 1 && !outputName.startsWith('.work/'))
  throw new Error('Builds with a faster autonomy must stay inside .work.');
// The depth foundation (docs/depth-foundation.md): a probe for tests (the room's state on the
// document and its drawn pixels), and builds that break its protections on purpose, to see their
// tests fail: `stacking` draws room-depth artwork over the UI instead of under it, `density`
// draws the glass plates without the readability density. `names` stands in for YouTube renaming
// its parts: the adapter knows none of its text parts, so only the fallback plates are left.
const spaceProbe = process.env.AROUND_SPACE_PROBE === '1';
const spaceBreak = process.env.AROUND_SPACE_BREAK ?? '';
if (!['', 'stacking', 'density', 'names'].includes(spaceBreak))
  throw new Error('AROUND_SPACE_BREAK must be stacking, density or names.');
if ((spaceProbe || spaceBreak) && !outputName.startsWith('.work/'))
  throw new Error('Space probes and broken space builds must stay inside .work.');
const watching = process.argv.includes('--watch');
// A development build (`npm run dev`, or AROUND_DEV=1): it writes what only a developer needs to the
// console, such as the readability's way out taking over (`AROUND_DEV_LOG:` blocks). The normal build
// drops those blocks, strings and all; nothing is ever sent anywhere.
const development = watching || process.env.AROUND_DEV === '1';
const worldMode = process.env.AROUND_WORLD_MODE ?? 'runtime';
if (!['legacy', 'compare', 'runtime'].includes(worldMode))
  throw new Error('AROUND_WORLD_MODE must be legacy, compare or runtime.');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const vendor = await readFile(join(root, 'src/vendor/lottie-light.js'));
const provenance = JSON.parse(await readFile(join(root, 'src/vendor/lottie-source.json'), 'utf8'));
if (
  createHash('sha256').update(vendor).digest('hex') !== provenance.sha256 ||
  /\beval\s*\(|\bnew\s+Function\s*\(/.test(vendor.toString()) ||
  !vendor.includes('var Nt=null;')
)
  throw new Error('Lottie Lightの固定版とCSP対策を確認してください。');

if (manifest.manifest_version !== 3 || manifest.version !== pkg.version) {
  throw new Error('Manifest V3とpackage.jsonのバージョンを確認してください。');
}

await mkdir(join(outDir, 'popup'), { recursive: true });
await mkdir(join(outDir, 'content'), { recursive: true });
await mkdir(join(outDir, 'background'), { recursive: true });
await mkdir(join(outDir, 'studio'), { recursive: true });
await mkdir(join(outDir, 'assets'), { recursive: true });
await mkdir(join(outDir, 'backup'), { recursive: true });
if (profiling) await mkdir(join(outDir, 'diagnostics'), { recursive: true });

async function copyStaticFiles() {
  await Promise.all([
    cp(join(root, 'assets'), join(outDir, 'assets'), { recursive: true }),
    copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(outDir, 'THIRD_PARTY_NOTICES.md')),
    profiling
      ? import('node:fs/promises').then(({ writeFile }) =>
          writeFile(
            join(outDir, 'manifest.json'),
            JSON.stringify(
              {
                ...manifest,
                web_accessible_resources: [
                  ...manifest.web_accessible_resources,
                  {
                    resources: ['diagnostics/asset-benchmark.html', 'diagnostics/asset-runtime-lab.html'],
                    matches: ['https://www.youtube.com/*'],
                  },
                ],
              },
              null,
              2,
            ),
          ),
        )
      : copyFile(join(root, 'manifest.json'), join(outDir, 'manifest.json')),
    copyFile(join(root, 'src/popup/index.html'), join(outDir, 'popup/index.html')),
    copyFile(join(root, 'src/popup/popup.css'), join(outDir, 'popup/popup.css')),
    copyFile(join(root, 'src/studio/index.html'), join(outDir, 'studio/index.html')),
    copyFile(join(root, 'src/studio/studio.css'), join(outDir, 'studio/studio.css')),
    copyFile(join(root, 'src/assets/read-frame.html'), join(outDir, 'assets/read-frame.html')),
    copyFile(join(root, 'src/backup/index.html'), join(outDir, 'backup/index.html')),
    copyFile(join(root, 'src/backup/backup.css'), join(outDir, 'backup/backup.css')),
  ]);
  if (profiling)
    await Promise.all(
      ['asset-benchmark', 'asset-runtime-lab'].map((name) =>
        copyFile(join(root, 'src/diagnostics/' + name + '.html'), join(outDir, 'diagnostics/' + name + '.html')),
      ),
    );
}

const shared = {
  absWorkingDir: root,
  bundle: true,
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  dropLabels: [
    ...(pageChangeProbe ? [] : ['AROUND_TEST_PAGE_CHANGE']),
    ...(guardTrace ? [] : ['AROUND_GUARD_TRACE']),
    ...(noIdleRecheck ? ['AROUND_IDLE_RECHECK'] : []),
    ...(noStackingProof ? ['AROUND_STACKING_PROOF'] : []),
    ...(spaceProbe ? [] : ['AROUND_SPACE_PROBE']),
    ...(development ? [] : ['AROUND_DEV_LOG']),
  ],
  define: {
    __AROUND_PAGE_CHANGE_LEGACY__: String(pageChangeProbe && process.env.AROUND_PAGE_CHANGE_LEGACY === '1'),
    __AROUND_WORLD_MODE__: JSON.stringify(worldMode),
    __AROUND_WORLD_DEVTOOLS__: String(process.env.AROUND_WORLD_DEVTOOLS === '1'),
    __AROUND_ASSET_PROFILE__: String(profiling),
    __AROUND_LAYERING__: String(layering),
    __AROUND_AUTONOMY_PACE__: String(autonomyPace),
    __AROUND_SPACE_PROBE__: String(spaceProbe),
    __AROUND_SPACE_BREAK__: JSON.stringify(spaceBreak),
    // G1 measurement hooks (src/diagnostics/g11-hooks.ts): only scripts/g11/build.mjs turns them on.
    __AROUND_G11__: 'false',
  },
};

const builds = await Promise.all([
  context({
    ...shared,
    entryPoints: ['src/backup/page.ts'],
    outfile: join(outDir, 'backup/index.js'),
    format: 'iife',
    loader: { '.css': 'text' },
  }),
  context({
    ...shared,
    entryPoints: ['src/assets/read-frame.ts'],
    outfile: join(outDir, 'assets/read-frame.js'),
    format: 'iife',
  }),
  ...(profiling
    ? ['asset-benchmark', 'asset-runtime-lab'].map((name) =>
        context({
          ...shared,
          entryPoints: ['src/diagnostics/' + name + '.ts'],
          outfile: join(outDir, 'diagnostics/' + name + '.js'),
          format: 'iife',
        }),
      )
    : []),
  context({
    ...shared,
    entryPoints: ['src/browser/studio-page.ts'],
    outfile: join(outDir, 'studio/index.js'),
    format: 'iife',
    loader: { '.css': 'text' },
  }),
  context({
    ...shared,
    entryPoints: ['src/background/index.ts'],
    outfile: join(outDir, 'background/index.js'),
    format: 'iife',
  }),
  context({
    ...shared,
    entryPoints: ['src/content/index.ts'],
    outfile: join(outDir, 'content/index.js'),
    format: 'iife',
    loader: { '.css': 'text' },
  }),
  context({
    ...shared,
    entryPoints: ['src/popup/index.ts'],
    outfile: join(outDir, 'popup/index.js'),
    format: 'iife',
    loader: { '.css': 'text' },
  }),
]);

if (watching) {
  await copyStaticFiles();
  await Promise.all(builds.map((build) => build.watch()));
  const refresh = () => copyStaticFiles().catch((error) => console.error(error));
  const watchers = [
    watch(join(root, 'assets'), { recursive: true }, refresh),
    watch(join(root, 'src/studio'), (_event, file) => {
      if (file === 'index.html' || file === 'studio.css') refresh();
    }),
    watch(join(root, 'src/assets'), (_event, file) => {
      if (file === 'read-frame.html') refresh();
    }),
    watch(join(root, 'src/popup'), (_event, file) => {
      if (file === 'index.html' || file === 'popup.css') refresh();
    }),
    watch(join(root, 'src/backup'), (_event, file) => {
      if (file === 'index.html' || file === 'backup.css') refresh();
    }),
    watch(root, (_event, file) => {
      if (file === 'manifest.json') refresh();
    }),
  ];
  console.log('監視中: 変更後は拡張機能とYouTubeタブを再読み込みしてください。');
  const stop = async () => {
    watchers.forEach((watcher) => watcher.close());
    await Promise.all(builds.map((build) => build.dispose()));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} else {
  try {
    await Promise.all(builds.map((build) => build.rebuild()));
    await copyStaticFiles();
    console.log(`${outputName}/ にChromeへ読み込める拡張機能を作成しました。`);
  } finally {
    await Promise.all(builds.map((build) => build.dispose()));
  }
}
