// Puts the living room into the R2 bucket, file by file (docs/living-room-hosting.md).
//
//   node scripts/build-living-room.mjs
//   node scripts/living-room/host/upload.mjs            the public build, dist-living-room/
//   node scripts/living-room/host/upload.mjs --dry-run  lists what would go, touches nothing
//
// The public build never holds the private character: this refuses anything that looks like it
// (a character/ folder, .vrm, .vrma, .fbx, .psd, .blend…) before the first file is sent.
//
// With the character (翔太's decision, 2026-11-13: "規約上問題ない", and no sign-in on the
// address, so anyone with the address can fetch the model and its motions):
//   node scripts/living-room/host/upload.mjs --from .work/living-room-felis --allow-character
// `--from` takes a build in a `.work` folder (never a source folder), and the character is only
// put when `--allow-character` says so in so many words.
//
// Going back to a room without it:
//   node scripts/living-room/host/upload.mjs --remove-character   (deletes the character's files)
//   node scripts/living-room/host/upload.mjs                      (the public build over it)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BUCKET = process.env.WW_LIVING_BUCKET ?? 'living-room';
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const allowCharacter = args.includes('--allow-character');
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined;
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  glb: 'model/gltf-binary',
  vrm: 'model/gltf-binary',
  vrma: 'model/gltf-binary',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
};
/** What a public room is made of; anything else is not uploaded (and a character is refused). */
const FORBIDDEN = /(^|\/)(character|motions)(\/|$)|\.(vrm|vrma|fbx|unitypackage|psd|blend1?)$/i;
/** What a character's files are (the same names scripts/build-living-room.mjs writes). */
const CHARACTER_KEYS = [
  'content/character/character.json',
  'content/character/character.vrm',
  ...['Dance_Loop', 'Idle_Loop', 'Jog_Fwd_Loop', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop', 'Walk_Loop'].map(
    (name) => `content/character/${name}.vrma`,
  ),
];

const windows = process.platform === 'win32';
// (Fixed arguments only; `shell` is for Windows' npx.cmd, which splits an argument at a space or
// a semicolon ("text/html; charset=utf-8") unless it is quoted.)
const quote = (value) => (windows ? `"${value}"` : value);
const wrangler = (...parts) =>
  spawnSync('npx', ['wrangler@4', ...parts].map(quote), { stdio: 'inherit', shell: windows });

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

if (args.includes('--remove-character')) {
  for (const key of CHARACTER_KEYS) {
    console.log(`${dry ? 'would delete' : 'delete'} ${key}`);
    if (!dry && wrangler('r2', 'object', 'delete', `${BUCKET}/${key}`, '--remote').status !== 0)
      throw new Error(`Deleting ${key} failed.`);
  }
  process.exit(0);
}

// The folder to send: the public build, or (with the character) a build in a `.work` folder.
const folder = from ? resolve(root, from) : join(root, 'dist-living-room');
const inWork = relative(join(root, '.work'), folder);
if (from && (!allowCharacter || inWork.startsWith('..') || inWork.includes('/') || inWork.includes('\\') || !inWork))
  throw new Error('--from takes a direct .work child and goes with --allow-character.');
if (!existsSync(join(folder, 'index.html')))
  throw new Error(`${relative(root, folder)}/ is not built (node scripts/build-living-room.mjs).`);
const files = walk(folder).map((file) => ({ file, key: relative(folder, file).split(sep).join('/') }));
const refused = allowCharacter ? [] : files.filter(({ key }) => FORBIDDEN.test(key));
if (refused.length)
  throw new Error(`A public build must not hold these, and none was uploaded: ${refused.map((f) => f.key).join(', ')}`);
const unknown = files.filter(({ key }) => !TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()]);
if (unknown.length)
  throw new Error(`A file of a kind the room does not serve: ${unknown.map((f) => f.key).join(', ')}`);
// (Nothing that is not the room and the character's own files: no blend, no psd, no fbx.)
const strays = files.filter(({ key }) => /\.(fbx|unitypackage|psd|blend1?)$/i.test(key));
if (strays.length) throw new Error(`Not for any address: ${strays.map((f) => f.key).join(', ')}`);

let total = 0;
for (const { file, key } of files) {
  const size = statSync(file).size;
  total += size;
  console.log(`${dry ? 'would put' : 'put'} ${key} (${(size / 1048576).toFixed(1)} MiB)`);
  if (dry) continue;
  const type = TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()];
  const result = wrangler(
    'r2',
    'object',
    'put',
    `${BUCKET}/${key}`,
    '--file',
    file,
    '--content-type',
    type,
    '--remote',
  );
  if (result.status !== 0) throw new Error(`Uploading ${key} failed (nothing after it was sent).`);
}
console.log(
  `${dry ? 'would upload' : 'uploaded'} ${files.length} files, ${(total / 1048576).toFixed(1)} MiB, to ${BUCKET}`,
);
