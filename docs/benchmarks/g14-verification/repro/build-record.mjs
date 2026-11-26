import { build } from 'esbuild';
import { cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(),
  site = path.resolve('src/sites/youtube-operations.ts'),
  out = path.resolve('.work/g14-record');
await cp('.work/g14-normal', out, { recursive: true });
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
  dropLabels: ['AROUND_TEST_PAGE_CHANGE'],
  define: {
    __AROUND_WORLD_MODE__: '"runtime"',
    __AROUND_WORLD_DEVTOOLS__: 'false',
    __AROUND_ASSET_PROFILE__: 'false',
    __AROUND_PAGE_CHANGE_LEGACY__: 'false',
  },
  plugins: [
    {
      name: 'g14-recheck-record-only',
      setup(b) {
        b.onResolve({ filter: /^g14-original$/ }, () => ({ path: site }));
        b.onResolve({ filter: /(?:^|\/)youtube-operations(?:\.ts)?$/ }, (a) => {
          if (path.resolve(a.resolveDir, a.path).replace(/\.ts$/, '') === site.slice(0, -3))
            return { path: 'wrapper', namespace: 'g14-record' };
        });
        b.onLoad({ filter: /.*/, namespace: 'g14-record' }, () => ({
          loader: 'js',
          contents: `
    export * from 'g14-original'; import {youtubeOperations as original} from 'g14-original';
    export function youtubeOperations(doc){const source=original(doc),capture=source.capture.bind(source),rows=[];
      source.capture=(options)=>{const stack=new Error().stack??'',start=performance.now(),snapshot=capture(options);
        if(/\\brecheck\\b/.test(stack)){rows.push({at:start,ms:performance.now()-start,options,generation:snapshot.generation,stack});
          if(rows.length>100)rows.shift();doc.documentElement.setAttribute('data-around-g14-rechecks',JSON.stringify(rows));}
        return snapshot;};return source;}`,
        }));
      },
    },
  ],
});
await writeFile(
  path.join(out, 'record.json'),
  JSON.stringify(
    {
      revision: 'ed03b29',
      method:
        'esbuild public source wrapper; records capture only when the caller stack names recheck; no behaviour overridden',
    },
    null,
    2,
  ),
);
