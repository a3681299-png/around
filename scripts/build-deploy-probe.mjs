// Builds a throwaway bundle to learn what a static host (DeployNow) does with large model files,
// before the Playground goes there (docs/playground-plan.md, 「配置の確かめ」).
//   node scripts/build-deploy-probe.mjs                 → dist-deploy-probe/
//   AROUND_PROBE_OUT=.work/x AROUND_PROBE_MB=1 node scripts/build-deploy-probe.mjs   (tests: small files)
// The files are seeded noise (incompressible, like real textures), so a host that recompresses
// or rewrites them changes the hash the page shows. Nothing from the extension or the repo's
// models goes in.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.env.AROUND_PROBE_OUT ?? 'dist-deploy-probe');
const inWork = relative(join(root, '.work'), output);
if (output !== join(root, 'dist-deploy-probe') && (inWork.startsWith('..') || /[\\/]/.test(inWork) || !inWork))
  throw new Error('AROUND_PROBE_OUT must be dist-deploy-probe or a direct .work child.');
const megabytes = Number(process.env.AROUND_PROBE_MB ?? 20);
if (!(megabytes > 0 && megabytes <= 64)) throw new Error('AROUND_PROBE_MB must be 1–64.');

/** Deterministic noise (xorshift32), with a 4-byte magic so the file looks like its kind. */
function noise(bytes, seed, magic) {
  const out = Buffer.alloc(bytes);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < bytes; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out.writeUInt32LE(x >>> 0, Math.min(i, bytes - 4));
  }
  out.write(magic, 0, 'latin1');
  return out;
}

const size = Math.round(megabytes * 1024 * 1024);
const files = [
  // The two extensions the Playground ships; hosts often have no MIME type for them.
  {
    path: 'files/dummy.vrm',
    body: noise(size, 0x5eed1, 'glTF'),
    expect: 'application/octet-stream or model/gltf-binary',
  },
  { path: 'files/dummy.glb', body: noise(size, 0x5eed2, 'glTF'), expect: 'model/gltf-binary' },
  // A small JSON like the Playground's manifest and design.
  {
    path: 'files/dummy.json',
    body: Buffer.from(JSON.stringify({ probe: true, note: 'design.json の代わり' })),
    expect: 'application/json',
  },
];

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'files'), { recursive: true });
for (const file of files) writeFileSync(join(output, file.path), file.body);
const manifest = files.map((file) => ({
  path: file.path,
  bytes: file.body.length,
  sha256: createHash('sha256').update(file.body).digest('hex'),
  expect: file.expect,
}));
writeFileSync(join(output, 'probe.json'), JSON.stringify(manifest, null, 2));

// Same CSP as the Playground, so a host that adds or breaks headers shows up here first.
writeFileSync(
  join(output, 'index.html'),
  `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'" />
    <link rel="icon" href="data:," />
    <title>配置の確かめ — Around Playground</title>
    <style>
      body { font: 14px/1.6 system-ui, sans-serif; margin: 24px; background: #f6f6f2; color: #222; }
      table { border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; vertical-align: top; white-space: pre-line; }
      td.ok { background: #dff3e4; } td.ng { background: #f8dcdc; }
      code { font-size: 12px; }
    </style>
    <script src="probe.js" defer></script>
  </head>
  <body>
    <h1>配置の確かめ</h1>
    <p>この表を撮って送ってください。ページを開くと自動で読み込みます。</p>
    <p id="summary">読み込み中…</p>
    <table>
      <thead><tr><th>ファイル</th><th>結果</th><th>Content-Type</th><th>大きさ</th><th>時間</th><th>中身（SHA-256）</th><th>その他のヘッダー</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <p><button id="again" type="button">もう一度（キャッシュなし）</button></p>
  </body>
</html>
`,
);
writeFileSync(
  join(output, 'probe.js'),
  `'use strict';
const rows = document.getElementById('rows'), summary = document.getElementById('summary');
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const cell = (row, text, kind) => { const td = row.insertCell(); td.textContent = text; if (kind) td.className = kind; return td; };
async function probe(entry, cache) {
  const row = rows.insertRow();
  cell(row, entry.path);
  const started = performance.now();
  try {
    const response = await fetch(entry.path, { cache });
    const body = await response.arrayBuffer();
    const ms = Math.round(performance.now() - started);
    const sha = hex(await crypto.subtle.digest('SHA-256', body));
    const same = response.ok && body.byteLength === entry.bytes && sha === entry.sha256;
    cell(row, response.status + (same ? ' 読めた・中身一致' : ' 中身が違う'), same ? 'ok' : 'ng');
    cell(row, (response.headers.get('content-type') || '(なし)') + ' / 期待: ' + entry.expect);
    cell(row, body.byteLength + ' B（期待 ' + entry.bytes + '）');
    cell(row, ms + ' ms' + (ms > 0 ? '（' + (body.byteLength / 1048576 / (ms / 1000)).toFixed(1) + ' MB/s）' : ''));
    cell(row, sha.slice(0, 16) + '…');
    cell(row, ['content-encoding', 'cache-control', 'content-length', 'accept-ranges', 'server']
      .map((name) => name + ': ' + (response.headers.get(name) || '-')).join('\\n'));
    return same;
  } catch (error) {
    cell(row, '読めない: ' + error, 'ng');
    return false;
  }
}
async function run(cache) {
  rows.textContent = '';
  summary.textContent = '読み込み中…';
  const list = await (await fetch('probe.json', { cache: 'no-store' })).json();
  let good = 0;
  for (const entry of list) if (await probe(entry, cache)) good++;
  summary.textContent = good + ' / ' + list.length + ' 件が読めて中身も一致（' + new Date().toLocaleString() + '、' + location.origin + '）';
  document.documentElement.dataset.done = String(good === list.length);
}
document.getElementById('again').addEventListener('click', () => run('no-store'));
run('default');
`,
);
console.log(`Deploy probe: ${relative(root, output)} (${megabytes} MB × 2 + json)`);
