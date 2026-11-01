// Independent check: run the unchanged v12 parser/compiler in its own historical worktree.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const source = path.resolve(process.argv[2] ?? '.work/ui1-base');
const result = await build({
  stdin: {
    contents: `export {parseDesign} from ${JSON.stringify(path.join(source, 'src/design/schema.ts'))}; export {compileDesign} from ${JSON.stringify(path.join(source, 'src/design/renderer.ts'))};`,
    resolveDir: source,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE'],
});
const historical = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const expected = JSON.parse(await readFile('tests/fixtures/designs/chain-expected.json', 'utf8'));
const css = JSON.parse(await readFile('tests/fixtures/designs/css-expected.json', 'utf8'));
for (const [file, parsed] of Object.entries(expected.documents)) {
  const input = JSON.parse(await readFile('tests/fixtures/designs/' + file, 'utf8'));
  const actual = historical.parseDesign(input);
  assert.deepEqual({ ...actual, schemaVersion: parsed.schemaVersion }, parsed, file);
  assert.equal(historical.compileDesign(actual, css.targets), css.css[file], file + ' CSS');
}
console.log(
  JSON.stringify({
    source,
    documents: Object.keys(expected.documents).length,
    css: Object.keys(css.css).length,
    baseline: expected.baseline,
    pass: true,
  }),
);
