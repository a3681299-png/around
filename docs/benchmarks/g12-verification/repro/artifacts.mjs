import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
const base = '.work/g12v-evidence';
const out = 'docs/benchmarks/g12-verification';
await mkdir(out, { recursive: true });
const profiles = {};
for (const label of ['before', 'current']) {
  const p = JSON.parse(await readFile(`${base}/cpu-${label}.cpuprofile`, 'utf8'));
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const sums = new Map();
  let total = 0,
    extension = 0;
  p.samples.forEach((id, i) => {
    const n = nodes.get(id);
    const ms = (p.timeDeltas[i] ?? 0) / 1000;
    total += ms;
    if (!n.callFrame.url.startsWith('chrome-extension://')) return;
    extension += ms;
    const key = JSON.stringify({
      name: n.callFrame.functionName || '(anonymous)',
      url: n.callFrame.url,
      line: n.callFrame.lineNumber + 1,
    });
    sums.set(key, (sums.get(key) ?? 0) + ms);
  });
  profiles[label] = {
    sampledMs: total,
    extensionSelfMs: extension,
    top: [...sums]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, ms]) => ({ ...JSON.parse(k), ms })),
  };
}
await writeFile(`${base}/cpu-summary.json`, JSON.stringify(profiles, null, 2));
for (const file of [
  'summary.json',
  'performance.json',
  'performance-initial.json',
  'cpu-summary.json',
  'cpu-before.cpuprofile',
  'cpu-current.cpuprofile',
  'index-differential.json',
  'take-differential.json',
  'frame-cache.json',
  'protection-functions.json',
  'd11-diagonal.json',
  'visual-current.json',
  'visual-before-557b978.json',
  'signal-live-1.json',
  'signal-live-2.json',
  'signal-live-3.json',
])
  await copyFile(`${base}/${file}`, `${out}/${file}`);
await mkdir(`${out}/repro`, { recursive: true });
for (const file of [
  'unit.spec.ts',
  'browser.spec.ts',
  'perf.spec.ts',
  'config.ts',
  'diagonal.ts',
  'analyze.mjs',
  'artifacts.mjs',
])
  await copyFile(`.work/g12v-probes/${file}`, `${out}/repro/${file}`);
const html = [
  '<!doctype html><html lang="ja"><meta charset="utf-8"><title>G1.2 検証の連続画像</title><style>body{margin:20px;font:16px sans-serif;background:#eee;color:#111} .sheet{display:grid;grid-template-columns:repeat(5,288px);gap:4px;width:1456px}figure{margin:0;background:white}img{display:block;width:288px}figcaption{font:12px monospace;padding:3px}h2{margin-top:30px}a{color:#1454b0}</style><h1>G1.2 検証の連続画像</h1><p>上から下、左から右へ。画像を押すと原寸。ホイール24回（下12回、上12回）と停止後800msを含む。</p>',
];
for (const label of ['current', 'before-557b978']) {
  const r = JSON.parse(await readFile(`${base}/visual-${label}.json`, 'utf8'));
  html.push(`<h2>${label}</h2><section class="sheet" id="${label}">`);
  const first = r.captures[0].timestamp;
  for (const c of r.captures) {
    const src = `${label}/${c.name}`;
    html.push(
      `<figure><a href="${src}"><img src="${src}"></a><figcaption>${c.name} +${((c.timestamp - first) * 1000).toFixed(0)}ms</figcaption></figure>`,
    );
  }
  html.push('</section>');
  html.push(
    `<p><a href="${label}/near-0.png">接近時の最初</a> / <a href="${label}/near-4.png">接近時の最後</a> / <a href="${label}/wheel-settled.png">ホイール停止後</a></p>`,
  );
  html.push(`<section class="sheet" id="near-${label}" style="grid-template-columns:repeat(3,480px);width:1448px">`);
  for (const file of ['near-0.png', 'near-1.png', 'near-2.png', 'near-3.png', 'near-4.png', 'wheel-settled.png'])
    html.push(
      `<figure><a href="${label}/${file}"><img style="width:480px" src="${label}/${file}"></a><figcaption>${label}/${file}</figcaption></figure>`,
    );
  html.push('</section>');
}
html.push('</html>');
const gallery = path.resolve('docs/screenshots/g12-verification/index.html');
await writeFile(gallery, html.join('\n'));
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1200 },
  });
  await page.goto(pathToFileURL(gallery).href);
  await page.locator('img').evaluateAll(async (images) => Promise.all(images.map((n) => n.decode())));
  for (const label of ['current', 'before-557b978'])
    await page.locator(`#${label}`).screenshot({
      path: `docs/screenshots/g12-verification/contact-${label}.png`,
    });
  for (const label of ['current', 'before-557b978'])
    await page.locator(`#near-${label}`).screenshot({
      path: `docs/screenshots/g12-verification/contact-near-${label}.png`,
    });
} finally {
  await browser.close();
}
console.log(JSON.stringify(profiles, null, 2));
