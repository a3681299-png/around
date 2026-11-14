// Dependency injection only: product sources and normal builds stay byte-identical.
import { build } from 'esbuild';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectVrma, vrmaFixture } from './after.mjs';
const root = process.cwd();
const definitions = {
  __AROUND_WORLD_MODE__: '"runtime"',
  __AROUND_WORLD_DEVTOOLS__: 'false',
  __AROUND_ASSET_PROFILE__: 'false',
  __AROUND_PAGE_CHANGE_LEGACY__: 'false',
};
for (const fault of ['vrma', 'facts', 'clip', 'input', 'approach', 'hold']) {
  const out = path.resolve('.work/r31-no-' + fault);
  if (path.dirname(out) !== path.resolve('.work')) throw Error('Mutant outside .work');
  await cp('.work/r31-normal', out, { recursive: true });
  const original = path.resolve(
    fault === 'vrma'
      ? 'src/assets/vrma.ts'
      : fault === 'facts'
        ? 'src/assets/design-assets.ts'
        : fault === 'clip' || fault === 'approach'
          ? 'src/world/operations.ts'
          : 'src/sites/youtube-operations.ts',
  );
  const info = inspectVrma(vrmaFixture()).info;
  const body =
    fault === 'vrma'
      ? `export * from 'r31-original';
    export function inspectVrma(data){const view=new DataView(data.buffer,data.byteOffset,data.byteLength),n=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(data.subarray(20,20+n)));return{info:${JSON.stringify(info)},json,bin:data.subarray(28+n)};}`
      : fault === 'facts'
        ? `export * from 'r31-original';import{validateDesignAssets as base,validateSkinAsset}from'r31-original';export function validateDesignAssets(layers,assets){base(layers.map(l=>({...l,character:undefined})),assets)}export function validateDocumentAssets(d,a){validateDesignAssets(d.decorations,a);for(const r of d.rules){if(!r.skin)continue;for(const f of Object.values(r.skin.states))validateSkinAsset(f,a);if(r.skin.compact?.kind==='frame')validateSkinAsset(r.skin.compact.frame,a)}};`
        : fault === 'clip'
          ? `export * from 'r31-original';export function protectionClip(s){const v=s.viewport;return{regions:[{left:0,top:0,width:v.width,height:v.height}],path:'M0 0h'+v.width+'v'+v.height+'h'+(-v.width)+'Z'}};`
          : fault === 'approach'
            ? `export * from 'r31-original';import{initialApproach}from'r31-original';export function stepApproach(){return initialApproach()}`
            : `export * from 'r31-original';import{youtubeOperations as base}from'r31-original';export function youtubeOperations(doc){const s=base(doc);${fault === 'input' ? `const v=s.validate.bind(s);s.validate=(snapshot,event)=>event?true:v(snapshot,event);` : `s.deferredFor=()=>0;`}return s;}`;
  const plugin = {
    name: 'r31-mutant-' + fault,
    setup(b) {
      b.onResolve({ filter: /^r31-original$/ }, () => ({ path: original }));
      b.onResolve({ filter: /(?:vrma|design-assets|operations|youtube-operations)(?:\.ts)?$/ }, (args) => {
        if (path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== original.slice(0, -3)) return;
        return { path: 'wrapper', namespace: 'r31-mutant' };
      });
      b.onLoad({ filter: /.*/, namespace: 'r31-mutant' }, () => ({ contents: body, loader: 'js' }));
    },
  };
  const entries =
    fault === 'vrma' || fault === 'facts'
      ? [
          ['src/content/index.ts', 'content/index.js'],
          ['src/background/index.ts', 'background/index.js'],
          ['src/assets/read-frame.ts', 'assets/read-frame.js'],
          ['src/browser/studio-page.ts', 'studio/index.js'],
          ['src/backup/page.ts', 'backup/index.js'],
        ]
      : [['src/content/index.ts', 'content/index.js']];
  const hashes = {};
  if (fault === 'vrma' || fault === 'facts')
    await build({
      stdin: {
        contents: `export * from ${JSON.stringify(path.resolve(fault === 'vrma' ? 'src/assets/inspect.ts' : 'src/assets/design-assets.ts'))};`,
        resolveDir: root,
      },
      outfile: path.join(out, 'probe.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [plugin],
      logLevel: 'silent',
    });
  for (const [entry, file] of entries) {
    await build({
      absWorkingDir: root,
      entryPoints: [entry],
      outfile: path.join(out, file),
      bundle: true,
      format: 'iife',
      target: 'chrome120',
      loader: { '.css': 'text' },
      dropLabels: ['AROUND_TEST_PAGE_CHANGE', 'AROUND_GUARD_TRACE'],
      define: definitions,
      plugins: [plugin],
      logLevel: 'silent',
    });
    hashes[file] = createHash('sha256')
      .update(await readFile(path.join(out, file)))
      .digest('hex');
  }
  await writeFile(
    path.join(out, 'fault.json'),
    JSON.stringify({ fault, source: '8003738', method: 'esbuild dependency wrapper', hashes }, null, 2),
  );
  console.log(fault, hashes);
}
