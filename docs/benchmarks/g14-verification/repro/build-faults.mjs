import { build } from 'esbuild';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const world = path.resolve('src/world/operations.ts'),
  site = path.resolve('src/sites/youtube-operations.ts');
for (const fault of ['clip', 'input', 'approach', 'hold']) {
  const out = path.resolve(`.work/g14-no-${fault}`);
  if (path.dirname(out) !== path.resolve('.work')) throw new Error('Fault build outside .work');
  await cp('.work/g14-normal', out, { recursive: true });
  const plugin = {
    name: `g14-disable-${fault}`,
    setup(b) {
      const isWorld = fault === 'clip' || fault === 'approach',
        original = isWorld ? world : site;
      b.onResolve({ filter: /^g14-original$/ }, () => ({ path: original }));
      b.onResolve(
        { filter: isWorld ? /(?:^|\/)world\/operations(?:\.ts)?$/ : /(?:^|\/)youtube-operations(?:\.ts)?$/ },
        (args) => {
          if (path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== original.slice(0, -3)) return;
          return { path: 'fault-wrapper', namespace: 'g14-fault' };
        },
      );
      b.onLoad({ filter: /.*/, namespace: 'g14-fault' }, () => ({
        loader: 'js',
        contents:
          fault === 'clip'
            ? `export * from 'g14-original';
        export function protectionClip(snapshot){const v=snapshot.viewport;const regions=[{left:0,top:0,width:v.width,height:v.height}];
          return {regions,path:'M0 0h'+v.width+'v'+v.height+'h'+(-v.width)+'Z'};}`
            : fault === 'approach'
              ? `export * from 'g14-original';import {initialApproach} from 'g14-original';
        export function stepApproach(){return initialApproach();}`
              : `export * from 'g14-original';import {youtubeOperations as original} from 'g14-original';
        export function youtubeOperations(doc){const source=original(doc);
          ${
            fault === 'input'
              ? `const validate=source.validate.bind(source);source.validate=(snapshot,event)=>event?true:validate(snapshot,event);`
              : `source.deferredFor=()=>0;`
          }
          return source;}`,
      }));
    },
  };
  await build({
    absWorkingDir: root,
    entryPoints: ['src/content/index.ts'],
    bundle: true,
    outfile: path.join(out, 'content/index.js'),
    format: 'iife',
    target: 'chrome120',
    charset: 'utf8',
    legalComments: 'none',
    loader: { '.css': 'text' },
    dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE'],
    define: {
      __WW_WORLD_MODE__: '"runtime"',
      __WW_WORLD_DEVTOOLS__: 'false',
      __WW_ASSET_PROFILE__: 'false',
      __WW_PAGE_CHANGE_LEGACY__: 'false',
    },
    plugins: [plugin],
  });
  const hash = createHash('sha256')
    .update(await readFile(path.join(out, 'content/index.js')))
    .digest('hex');
  await writeFile(
    path.join(out, 'fault.json'),
    JSON.stringify({ fault, source: 'ed03b29', method: 'esbuild module wrapper', contentSha256: hash }, null, 2),
  );
  console.log(fault, hash);
}
