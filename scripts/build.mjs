import { context } from 'esbuild';
import { copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profiling = process.env.WW_ASSET_PROFILE === '1';
const outputName = profiling ? '.work/asset-profile-dist' : (process.env.WW_BUILD_OUT ?? 'dist');
if (!/^(dist|\.work\/[a-zA-Z0-9_-]+)$/.test(outputName))
  throw new Error('WW_BUILD_OUT must be dist or a direct .work child.');
const outDir = join(root, outputName);
const watching = process.argv.includes('--watch');
const worldMode = process.env.WW_WORLD_MODE ?? 'runtime';
if (!['legacy', 'compare', 'runtime'].includes(worldMode))
  throw new Error('WW_WORLD_MODE must be legacy, compare or runtime.');
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
  define: {
    __WW_WORLD_MODE__: JSON.stringify(worldMode),
    __WW_WORLD_DEVTOOLS__: String(process.env.WW_WORLD_DEVTOOLS === '1'),
    __WW_ASSET_PROFILE__: String(profiling),
  },
};

const builds = await Promise.all([
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
    watch(join(root, 'assets/fonts'), refresh),
    watch(join(root, 'src/studio'), (_event, file) => {
      if (file === 'index.html' || file === 'studio.css') refresh();
    }),
    watch(join(root, 'src/popup'), (_event, file) => {
      if (file === 'index.html' || file === 'popup.css') refresh();
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
