// Puts the public build of the living room (dist-living-room/) into the R2 bucket, file by file
// (docs/living-room-hosting.md):
//   node scripts/build-living-room.mjs
//   node scripts/living-room/host/upload.mjs            (needs `npx wrangler@4 login` once)
//   node scripts/living-room/host/upload.mjs --dry-run  (lists what would go, touches nothing)
//
// Only dist-living-room is ever uploaded, and never with a character in it: the private
// character and its motions are not for any public place, and a build made with them goes to a
// `.work` folder, never here (scripts/build-living-room.mjs). This refuses anything that looks like
// them, before the first file is sent.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = join(root, 'dist-living-room');
const BUCKET = process.env.WW_LIVING_BUCKET ?? 'living-room';
const dry = process.argv.includes('--dry-run');
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  glb: 'model/gltf-binary',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
};
/** What a public room is made of; anything else is not uploaded (and a character is refused). */
const FORBIDDEN = /(^|\/)(character|motions)(\/|$)|\.(vrm|vrma|fbx|unitypackage|psd|blend1?)$/i;

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

if (!existsSync(join(dist, 'index.html')))
  throw new Error('dist-living-room/ is not built (node scripts/build-living-room.mjs).');
const files = walk(dist).map((file) => ({ file, key: relative(dist, file).split(sep).join('/') }));
const refused = files.filter(({ key }) => FORBIDDEN.test(key));
if (refused.length)
  throw new Error(`A public build must not hold these, and none was uploaded: ${refused.map((f) => f.key).join(', ')}`);
const unknown = files.filter(({ key }) => !TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()]);
if (unknown.length)
  throw new Error(`A file of a kind the room does not serve: ${unknown.map((f) => f.key).join(', ')}`);

let total = 0;
for (const { file, key } of files) {
  const size = statSync(file).size;
  total += size;
  console.log(`${dry ? 'would put' : 'put'} ${key} (${(size / 1048576).toFixed(1)} MiB)`);
  if (dry) continue;
  const type = TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()];
  // (Fixed arguments only; `shell` is for Windows' npx.cmd, which splits an argument at a space or
  // a semicolon ("text/html; charset=utf-8") unless it is quoted.)
  const windows = process.platform === 'win32';
  const quote = (value) => (windows ? `"${value}"` : value);
  const result = spawnSync(
    'npx',
    ['wrangler@4', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', type, '--remote'].map(
      quote,
    ),
    { stdio: 'inherit', shell: windows },
  );
  if (result.status !== 0) throw new Error(`Uploading ${key} failed (nothing after it was sent).`);
}
console.log(
  `${dry ? 'would upload' : 'uploaded'} ${files.length} files, ${(total / 1048576).toFixed(1)} MiB, to ${BUCKET}`,
);
