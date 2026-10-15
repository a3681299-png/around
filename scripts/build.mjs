import { context } from 'esbuild';
import { copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'dist');
const watching = process.argv.includes('--watch');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

if (manifest.manifest_version !== 3 || manifest.version !== pkg.version) {
  throw new Error('Manifest V3とpackage.jsonのバージョンを確認してください。');
}

await mkdir(join(outDir, 'popup'), { recursive: true });
await mkdir(join(outDir, 'content'), { recursive: true });
await mkdir(join(outDir, 'background'), { recursive: true });

async function copyStaticFiles() {
  await Promise.all([
    cp(join(root, 'assets'), join(outDir, 'assets'), { recursive: true }),
    copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(outDir, 'THIRD_PARTY_NOTICES.md')),
    copyFile(join(root, 'manifest.json'), join(outDir, 'manifest.json')),
    copyFile(join(root, 'src/popup/index.html'), join(outDir, 'popup/index.html')),
    copyFile(join(root, 'src/popup/popup.css'), join(outDir, 'popup/popup.css')),
  ]);
}

const shared = {
  absWorkingDir: root,
  bundle: true,
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
};

const builds = await Promise.all([
  context({
    ...shared,
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background/index.js',
    format: 'iife',
  }),
  context({
    ...shared,
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content/index.js',
    format: 'iife',
    loader: { '.css': 'text' },
  }),
  context({
    ...shared,
    entryPoints: ['src/popup/index.ts'],
    outfile: 'dist/popup/index.js',
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
    console.log('dist/ にChromeへ読み込める拡張機能を作成しました。');
  } finally {
    await Promise.all(builds.map((build) => build.dispose()));
  }
}
