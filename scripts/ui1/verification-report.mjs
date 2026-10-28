// Summarise the independent UI1.1 evidence; raw frame arrays remain in .work.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';

const root = path.resolve('.work/ui11-verification');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const optional = async (file) => {
  try {
    return await read(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
    max: sorted.at(-1) ?? null,
  };
};
function pack(data) {
  return {
    ...data,
    pairs: data.pairs.map((pair) => ({
      ...pair,
      blocks: Object.fromEntries(
        Object.entries(pair.blocks).map(([name, block]) => [
          name,
          {
            ...block,
            ...Object.fromEntries(
              ['startup', 'steady', 'spa'].map((phase) => [
                phase,
                {
                  ...block[phase],
                  frames: undefined,
                  full: undefined,
                  cpu: stats(block[phase].frames),
                  fullFrame: stats(block[phase].full),
                },
              ]),
            ),
          },
        ]),
      ),
    })),
  };
}
async function counts(file) {
  try {
    const log = (await readFile(file, 'utf8')).replace(/\x1b\[[0-9;]*m/g, '');
    return Object.fromEntries(
      ['passed', 'failed', 'skipped'].map((kind) => [
        kind,
        Number([...log.matchAll(new RegExp('(?:^|\\n)\\s*(\\d+) ' + kind + '(?:\\s|$)', 'g'))].at(-1)?.[1] ?? 0),
      ]),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
async function jsonDirectory(directory) {
  try {
    return Object.fromEntries(
      await Promise.all(
        (await readdir(directory))
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => [name.slice(0, -5), await read(path.join(directory, name))]),
      ),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
const build = pack(await read(path.join(root, 'build-v3/result.json')));
const skin = pack(await read(path.join(root, 'skin-v3/result.json')));
if (build.pairs.length !== 6 || skin.pairs.length !== 6 || !build.summary || !skin.summary)
  throw new Error('Both complete six-pair runs are required.');
const calibration = await read(path.join(root, 'await-v3/calibration.json'));
const smallCalibration = (data) => ({
  ...data,
  results: data.results.map(({ sample, ...item }) => ({
    ...item,
    sample: {
      kinds: sample.kinds,
      clock: sample.clock,
      calls: sample.calls.length / 2,
      frames: sample.frames.length - 1,
    },
  })),
});
const report = {
  verifiedAt: new Date().toISOString(),
  scope: {
    before: '29b8d5ba923c4a0a06db96678a4c27346893dd95',
    after: '2c93579f2b96d4b2f35a41b9f825e4a43803dc30',
    implementationRange: '74571be..2c93579',
    functionalFixes: ['16db4ce', '07f7d468fe6adf50490581e6dc672f871424f54d'],
    testedProductTree: '5618de6cb6ff8250036fbf3b27302ff9bec41ffb',
  },
  hostCondition:
    'The user allowed the existing web Claude/ChatGPT and browser load to remain. Every measured block has a preceding CPU audit. These are not described as quiet-PC results. No other build/test ran during the measurements.',
  performance: { build, skin },
  calibration: {
    ...calibration,
    results: calibration.results.map(({ sample, ...item }) => ({
      ...item,
      sample: {
        kinds: sample.kinds,
        clock: sample.clock,
        calls: sample.calls.length / 2,
        frames: sample.frames.length - 1,
      },
    })),
  },
  intermediate: {
    reason:
      'Earlier probes omitted pre-injection startup frames or native await continuations. Retained for audit, not used for the final gate.',
    documentIdleBuild: pack(await read(path.join(root, 'build/result.json'))),
    nativeAwaitBuild: pack(await read(path.join(root, 'build-final/result.json'))),
    nativeAwaitSkin: pack(await read(path.join(root, 'skin-final/result.json'))),
    failedPostAwaitControl: smallCalibration(await read(path.join(root, 'await-native/calibration.json'))),
    rafOnlyControl: smallCalibration(await read(path.join(root, 'native-frame-clock/calibration.json'))),
  },
  diagnostics: {
    note: 'Two-pair feature isolation and sampling profiles are diagnostic, not gate runs.',
    normal: await optional(path.join(root, 'profile-v3/profile-summary.json')),
    withoutInk: await optional(path.join(root, 'profile-no-ink-v3/profile-summary.json')),
    withoutCompact: pack(await read(path.join(root, 'no-compact-v3/result.json'))),
    profiledMeasurement: pack(await read(path.join(root, 'profile-v3/result.json'))),
    withoutInkMeasurement: pack(await read(path.join(root, 'profile-no-ink-v3/result.json'))),
  },
  hostChecks: {
    initial: await optional('.work/ui11-quiet-initial.json'),
    beforeFlakes: await optional('.work/ui11-quiet-before-flakes.json'),
    busy: await optional('.work/ui11-quiet-check-busy.json'),
    beforeFixedFlakes: await optional('.work/ui11-quiet-before-flakes-after.json'),
  },
  nativeParts: Object.fromEntries(
    Object.entries(await jsonDirectory(path.join(root, 'site-parts/parts'))).map(([id, value]) => [
      id,
      {
        ...value[id],
        ...(value.expanded ? { expanded: value.expanded } : {}),
      },
    ]),
  ),
  text: {
    light: await optional(path.join(root, 'site-parts/ink-light.json')),
    dark: await optional(path.join(root, 'site-parts/ink-dark.json')),
  },
  live: await jsonDirectory(path.join(root, 'live')),
  tests: {
    unit: await counts('.work/ui11-unit-final.log'),
    lifecycle: await counts('.work/ui11-lifecycle.log'),
    spaBefore: await counts('.work/ui11-spa-before.log'),
    spaAfter: await counts('.work/ui11-spa-after.log'),
    flakeBefore: await counts('.work/ui11-flakes-before.log'),
    rafDiagnosticFirst: await counts('.work/ui11-raf-diagnosis.log'),
    rafDiagnosticWithStacks: await counts('.work/ui11-raf-trace.log'),
    flakeAfter: await counts('.work/ui11-flakes-after.log'),
    e2e: await counts('.work/ui11-e2e-full.log'),
    e2eNote:
      'Full local run before 07f7d46: 257 passed, 44 opt-in skipped. Its two new regressions, targeted checks and latest CI are recorded separately.',
    iconBefore: await counts('.work/ui11-icons-before.log'),
    iconAfter: await counts('.work/ui11-icons-after.log'),
    targetedAfterIcons: await counts('.work/ui11-after-icons-targeted.log'),
    liveRuns: await optional(path.join(root, 'live-runs.json')),
    resumedLiveRuns: await optional(path.join(root, 'live-runs-resumed.json')),
    liveToolsFixed: await optional(path.join(root, 'live-runs-tools-fixed.json')),
    livePaintAndNativeCommand: await optional(path.join(root, 'live-runs-paint-native.json')),
    liveNativeWindow: await optional(path.join(root, 'live-runs-native-window.json')),
    liveIconsFixed: await optional(path.join(root, 'live-runs-icons-fixed.json')),
    liveAfterIcons: await optional(path.join(root, 'live-runs-after-icons.json')),
    ci: (await optional(path.join(root, 'ci.json'))) ?? {
      revision: '42aacdab5ef8a36ebb2a4fb33beb36c21cd6c519',
      run: 40463412430,
      conclusion: 'success',
      note: 'Historical UI1.1 CI only. The latest verification CI has not been recorded yet.',
    },
  },
  dist: await optional('.work/ui11-dist-check.json'),
};
let tables = '';
const phaseNames = { startup: '起動直後', steady: '定常', spa: 'SPA遷移直後' };
const f = (n) => (n == null ? '—' : n.toFixed(2));
for (const [kind, data, conditions] of [
  ['build', build, ['before', 'after']],
  ['skin', skin, ['plain', 'skinned']],
]) {
  tables += `\n${kind}\n| 場面 | 中央値 前→後 | p95 前→後 | 増分 中央値 / p95 | 判定 | 全体p95 前→後（参考） |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const [phase, label] of Object.entries(phaseNames)) {
    const row = data.summary[phase],
      [a, b] = conditions.map((name) => row[name]);
    tables += `| ${label} | ${f(a.extensionCpuPerFrameMs.median)}→${f(b.extensionCpuPerFrameMs.median)} | ${f(a.extensionCpuPerFrameMs.p95)}→${f(b.extensionCpuPerFrameMs.p95)} | ${f(row.delta.median)} / ${f(row.delta.p95)} | ${row.delta.pass ? '合格' : '不合格'} | ${f(a.fullFrameMs.p95)}→${f(b.fullFrameMs.p95)} |\n`;
  }
  tables += `\n| 組（実行順） | 場面 | 中央値 前→後 | p95 前→後 | 背景CPU 前 / 後（全CPU比） |\n| --- | --- | --- | --- | --- |\n`;
  for (const row of data.pairs)
    for (const [phase, label] of Object.entries(phaseNames)) {
      const [a, b] = conditions.map((name) => row.blocks[name][phase].cpu);
      const [ha, hb] = conditions.map((name) => row.host[name].BackgroundPercent);
      tables += `| ${row.pair + 1} (${row.order.join('→')}) | ${label} | ${f(a.median)}→${f(b.median)} | ${f(a.p95)}→${f(b.p95)} | ${f(ha)} / ${f(hb)}% |\n`;
    }
}
await writeFile(path.join(root, 'tables.md'), tables);
const output = 'docs/benchmarks/ui1-1-verification-windows.json';
await writeFile(
  output,
  await prettier.format(JSON.stringify(report), {
    ...(await prettier.resolveConfig(output)),
    filepath: output,
    parser: 'json',
  }),
);
console.log(JSON.stringify({ output, build: build.summary, skin: skin.summary, tests: report.tests }, null, 2));
