import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from '../../tests/fixtures';
import { defaultSignalRule, defaultScrollOpacityRule } from '../../src/signals/keyframes';
import { declinePromotion, waitForAdvertToEnd, clearestPoint } from '../../tests/helpers/youtube-live';

const stats = (data: number[]) => {
  const a = data.toSorted((a, b) => a - b);
  return {
    n: a.length,
    median: (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2,
    p95: a[Math.ceil(a.length * 0.95) - 1],
    max: a.at(-1),
  };
};
function summarize(raw: any) {
  const values = Array(Math.max(0, raw.frames.length - 1)).fill(0);
  for (let i = 0; i < raw.calls.length; i += 2) {
    const t = raw.calls[i];
    let low = 0,
      high = raw.frames.length - 2,
      found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (raw.frames[mid] <= t) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (found >= 0 && t < raw.frames.at(-1)) values[found] += raw.calls[i + 1];
  }
  return {
    cpuMs: stats(values),
    intervalMs: stats(raw.frames.slice(1).map((t: number, i: number) => t - raw.frames[i])),
    kinds: raw.kinds,
  };
}
async function run(label: string, extensionPath: string, calibration = false) {
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g12v-perf-profile-')), false, {
    extensionPath,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const backup = await context.newPage();
    await backup.goto(`chrome-extension://${id}/backup/index.html`);
    await backup.locator('#backup-file').setInputFiles(path.resolve('tests/fixtures/backups/pre-removal.aroundbackup'));
    await backup.locator('#backup-inspect').click();
    await expect(backup.locator('#backup-restore')).toBeEnabled();
    await backup.locator('#backup-restore').click();
    await expect(backup.locator('.backup-status')).toContainText('読み込みが完了');
    const saved: any = await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    );
    const decorations = Array.from({ length: 32 }, (_, i) => ({
      ...saved.decorations[0],
      id: `g12-perf-${i}`,
      placement: {
        anchor: { kind: 'viewport' },
        x: 0.14 + (i % 8) * 0.1,
        y: 0.14 + Math.floor(i / 8) * 0.18,
        widthPx: 48,
        heightPx: 36,
        rotationDeg: 0,
      },
    }));
    const signalRules = decorations.slice(1).map((d) => defaultScrollOpacityRule(d.id));
    signalRules.push(
      defaultSignalRule(decorations[0].id, 'position.x', {
        signal: 'user.idle.duration',
        axis: 'y',
        space: 'page',
        inputRange: [0, 30],
      }),
    );
    await popup.evaluate(
      (design) =>
        chrome.storage.local.set({
          'around.design.youtube': design,
          'around.creatorMode': false,
        }),
      { ...saved, id: 'g12-perf-scene', decorations, signalRules },
    );
    await backup.close();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    const cdp = await context.newCDPSession(page);
    const worlds = new Set<number>();
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.add(context.id));
    cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
    await cdp.send('Runtime.enable');
    const evaluate = async (expression: string) => {
      for (const contextId of worlds) {
        try {
          const probe = await cdp.send('Runtime.evaluate', {
            contextId,
            expression: 'Boolean(globalThis.__ui1Probe)',
            returnByValue: true,
          });
          if (!probe.result.value) continue;
          const r = await cdp.send('Runtime.evaluate', {
            contextId,
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
          return r.result.value;
        } catch (e) {
          if (String(e).includes('Cannot find context')) continue;
          throw e;
        }
      }
      throw Error('Missing extension CPU probe');
    };
    const url = 'https://www.youtube.com/watch?v=LC1a-DwUhls';
    const start = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(Math.max(0, 6000 - (Date.now() - start)));
    const first = await evaluate('__ui1Probe.end()');
    const output: any = {
      label,
      build: JSON.parse(await readFile(path.join(extensionPath, 'ui1-build.json'), 'utf8')),
      browser: context.browser()?.version(),
      url,
      viewport: { width: 1920, height: 1080 },
      phases: { startup: { ...summarize(first), raw: first } },
      networkErrors: [],
    };
    page.on('requestfailed', (r) =>
      output.networkErrors.push({
        url: r.url().split('?')[0],
        error: r.failure()?.errorText,
      }),
    );
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const player = (await page.locator('#movie_player').boundingBox())!;
    const rest = await clearestPoint(page, {
      left: player.x + 100,
      top: player.y + 120,
      right: player.x + player.width - 100,
      bottom: player.y + player.height - 150,
    });
    await page.mouse.move(rest.x, rest.y);
    await page.waitForTimeout(1000);
    output.rest = rest;
    if (calibration) {
      await evaluate('__ui1Probe.begin()');
      await page.waitForTimeout(6000);
      const raw = await evaluate('__ui1Probe.end()');
      output.phases.calibration = { ...summarize(raw), raw };
      return output;
    }
    const safetyState = () => page.locator('#around-decorations').getAttribute('data-around-safety');
    await expect
      .poll(
        async () =>
          JSON.parse((await safetyState()) ?? '{}').issues?.filter((i: any) => i.surfaceId === 'native.approach')
            .length ?? 0,
      )
      .toBe(0);
    await evaluate('__ui1Probe.begin()');
    await page.waitForTimeout(6000);
    let raw = await evaluate('__ui1Probe.end()');
    output.phases.steady = {
      ...summarize(raw),
      raw,
      safety: await safetyState(),
    };
    await page.mouse.move(36, 540);
    await evaluate('__ui1Probe.begin()');
    if (process.env.G12V_PROFILE === '1') {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    for (let i = 0; i < 32; i++) {
      await page.mouse.wheel(0, i < 16 ? 120 : -120);
      await page.waitForTimeout(170);
    }
    raw = await evaluate('__ui1Probe.end()');
    output.phases.scroll = { ...summarize(raw), raw };
    if (process.env.G12V_PROFILE === '1') {
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(`.work/g12v-evidence/cpu-${label}.cpuprofile`, JSON.stringify(profile));
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(1000);
    const search = page.getByRole('combobox', { name: /Search|検索/ });
    await evaluate('__ui1Probe.begin()');
    await search.fill('lofi hip hop');
    await search.press('Enter');
    await expect(page).toHaveURL(/results\?search_query=/);
    await page.waitForTimeout(6000);
    raw = await evaluate('__ui1Probe.end()');
    output.phases.spa = { ...summarize(raw), raw };
    await cdp.detach();
    return output;
  } finally {
    await context.close();
  }
}
test('independent four alternating pairs, all extension callbacks, positive calibration', async () => {
  test.skip(process.env.G12V_PERF !== '1');
  test.setTimeout(900000);
  await mkdir('.work/g12v-evidence', { recursive: true });
  const result: any = {
    date: new Date().toISOString(),
    method: 'existing ui1 isolated-world wrappers, unmodified source modules; 32 layers',
    baseline: '557b978',
    target: '67ad03d',
    calibration: [],
    pairs: [],
  };
  const save = () => writeFile('.work/g12v-evidence/performance.json', JSON.stringify(result, null, 2));
  for (const label of ['current', 'busy']) {
    const row = await run(label, path.resolve(label === 'busy' ? '.work/g12v-perf-busy' : '.work/g12v-perf'), true);
    result.calibration.push(row);
    await save();
    console.log('CALIBRATION ' + label + ' ' + JSON.stringify(row.phases.calibration.cpuMs));
  }
  const positiveDelta =
    result.calibration[1].phases.calibration.cpuMs.median - result.calibration[0].phases.calibration.cpuMs.median;
  expect(positiveDelta).toBeGreaterThan(1.5);
  expect(positiveDelta).toBeLessThan(3.0);
  for (let pair = 0; pair < 4; pair++) {
    const order = pair % 2 ? ['current', 'before'] : ['before', 'current'];
    const rows: any = { pair, order };
    for (const label of order) {
      rows[label] = await run(
        label,
        path.resolve(label === 'before' ? '.work/g12-557/.work/g12v-perf' : '.work/g12v-perf'),
      );
      console.log(
        'PERF ' +
          pair +
          ' ' +
          label +
          ' ' +
          JSON.stringify(Object.fromEntries(Object.entries(rows[label].phases).map(([k, v]: any) => [k, v.cpuMs]))),
      );
      result.active = rows;
      await save();
    }
    result.pairs.push(rows);
    delete result.active;
    await save();
  }
});
test('one profiled diagnostic pair, excluded from timing verdict', async () => {
  test.skip(process.env.G12V_PROFILE !== '1');
  test.setTimeout(180000);
  for (const label of ['before', 'current']) {
    await run(label, path.resolve(label === 'before' ? '.work/g12-557/.work/g12v-perf' : '.work/g12v-perf'));
    console.log('PROFILE ' + label + ' captured');
  }
});
