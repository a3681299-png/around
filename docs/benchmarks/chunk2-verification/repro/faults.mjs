import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const tools = path.resolve('.work/verify');
const define = {
  __WW_WORLD_MODE__: '"runtime"',
  __WW_WORLD_DEVTOOLS__: 'false',
  __WW_ASSET_PROFILE__: 'false',
  __WW_PAGE_CHANGE_LEGACY__: 'false',
  __WW_G11__: 'false',
  __WW_PLAYGROUND_TEST__: 'false',
};

function replaceImport(relative, wrapper) {
  const target = path.join(root, relative);
  let hits = 0;
  return {
    count: () => hits,
    plugin: {
      name: `verification-${relative}`,
      setup(builder) {
        builder.onResolve({ filter: /^verification-original$/ }, () => ({ path: target }));
        builder.onResolve({ filter: /^\./ }, (args) => {
          if (path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== target.slice(0, -3)) return;
          hits++;
          return { path: 'replacement', namespace: 'verification' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
          contents: wrapper,
          loader: 'ts',
          resolveDir: root,
        }));
      },
    },
  };
}

const clip = [
  'src/world/operations.ts',
  `
  export * from 'verification-original';
  export function protectionClip(snapshot) {
    const { width, height } = snapshot.viewport;
    return { regions: [{left: 0, top: 0, width, height}], path: 'M0 0h'+width+'v'+height+'h'+(-width)+'Z' };
  }
`,
];
const underlay = [
  'src/sites/playground.ts',
  `
  export * from 'verification-original';
  import { createPlaygroundAdapter as original } from 'verification-original';
  export function createPlaygroundAdapter(doc) {
    const adapter = original(doc);
    return { ...adapter, operationSurfaces: () => ({ ...adapter.operationSurfaces(), underlaySlot: () => undefined }) };
  }
`,
];
const faults = { clip, underlay };
for (const [name, [relative, wrapper]] of Object.entries(faults)) {
  const out = path.resolve(`.work/fault-${name}`);
  await cp('.work/playground', out, { recursive: true });
  const fault = replaceImport(relative, wrapper);
  await build({
    entryPoints: ['src/playground/index.ts'],
    outfile: path.join(out, 'app.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    charset: 'utf8',
    loader: { '.css': 'text' },
    dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE'],
    define,
    plugins: [fault.plugin],
  });
  if (!fault.count()) throw Error(`No fault in ${name}`);
}

const author = replaceImport(
  'src/world/body-motion.ts',
  `
  export * from 'verification-original';
  import { evaluateBodyMotion as original } from 'verification-original';
  export function evaluateBodyMotion(state, input) { return original(state, { ...input, authorActive: false }); }
`,
);
await build({
  entryPoints: ['src/world/models.ts'],
  outfile: path.join(tools, 'models-author-off.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  define,
  plugins: [author.plugin],
});
if (!author.count()) throw Error('The author priority fault was not inserted');

// An unchanged live spec plus one injected movement, between reading and pressing the volume bar.
// Remap imports because the diagnostic copy is placed two directories below the project root.
const operations = (await readFile('tests/operation-live.spec.ts', 'utf8')).replaceAll(
  "from './",
  "from '../../tests/",
);
const point = '  const volume = await settledBox();';
if (operations.split(point).length !== 2) throw Error('Volume mutation insertion point changed');
await writeFile(
  path.join(tools, 'volume-fault.spec.ts'),
  operations.replace(
    point,
    `${point}
  if (process.env.CHUNK2_VOLUME_FAULT === 'target') {
    await page.evaluate(({ x, y, width, height }) => {
      const other = document.createElement('div');
      other.id = 'verification-nonvolume';
      other.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:auto;width:12px;height:12px';
      other.style.left = (x + width * 0.3 - 6) + 'px';
      other.style.top = (y + height / 2 - 6) + 'px';
      document.documentElement.append(other);
    }, volume);
  } else await slider.evaluate((element: HTMLElement) => { element.style.translate = '0 -90px'; });
`,
  ),
);
await mkdir('.work/verify-evidence', { recursive: true });
await writeFile(
  '.work/verify-evidence/fault-builds.json',
  JSON.stringify(
    {
      clip: 'protectionClip returns viewport',
      underlay: 'adapter omits underlay slot',
      author: 'authorActive forced to false',
      volume: 'move the actual slider 90px upward after computing its stable box',
      volumeTarget: 'place a neutral hit target over the already stable native slider box',
    },
    null,
    2,
  ),
);
