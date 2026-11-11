// Builds the living room page as static files only. Separate from the extension and the
// Playground: scripts/build.mjs, dist/ and dist-playground/ are not touched.
//   node scripts/build-living-room.mjs                 → dist-living-room/
//   WW_LIVING_OUT=.work/x node scripts/build-living-room.mjs
//   WW_LIVING_TEST=1 adds the read-only test hook (window.__wwLivingRoom).
//   WW_LIVING_ROOM=<dir> the baked room (room.glb, room.json, lightmap.png); default art/living-room/web
//   WW_LIVING_CHARACTER=<model.vrm> WW_LIVING_MOTIONS=<dir with Idle_Loop.vrma, Walk_Loop.vrma>
//     adds a local character (docs/living-body.md). Only into a .work output: a character whose
//     terms are not confirmed must never reach dist-living-room, which is what gets published.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.env.WW_LIVING_OUT ?? 'dist-living-room');
const inWork = relative(join(root, '.work'), output);
if (
  output !== join(root, 'dist-living-room') &&
  (inWork.startsWith('..') || inWork.includes('/') || inWork.includes('\\') || !inWork)
)
  throw new Error('WW_LIVING_OUT must be dist-living-room or a direct .work child.');
const room = resolve(root, process.env.WW_LIVING_ROOM ?? 'art/living-room/web');
const files = ['room.glb', 'room.json', 'lightmap.png'];
for (const file of files)
  if (!existsSync(join(room, file)))
    throw new Error(`The baked room is missing ${file} (scripts/living-room/80_bake.py).`);

const character = process.env.WW_LIVING_CHARACTER;
const motions = process.env.WW_LIVING_MOTIONS;
if (character && output === join(root, 'dist-living-room'))
  throw new Error('A local character is only built into a .work output (set WW_LIVING_OUT).');
if (character && (!motions || !existsSync(character)))
  throw new Error('WW_LIVING_CHARACTER needs an existing .vrm and WW_LIVING_MOTIONS.');

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'content'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/living-room/index.ts'],
  outfile: join(output, 'app.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  minify: process.env.WW_LIVING_TEST !== '1',
  logLevel: 'warning',
  define: {
    __WW_LIVING_TEST__: String(process.env.WW_LIVING_TEST === '1'),
    __WW_LIVING_CHARACTER__: String(Boolean(character)),
  },
});
for (const file of ['index.html', 'style.css']) copyFileSync(join(root, 'src/living-room', file), join(output, file));
for (const file of files) copyFileSync(join(room, file), join(output, 'content', file));
if (character) {
  const folder = join(output, 'content/character');
  mkdirSync(folder, { recursive: true });
  const clips = { idle: 'Idle_Loop.vrma', walk: 'Walk_Loop.vrma' };
  // Sitting is optional: a character without these motions stays on its feet.
  const seated = {
    run: 'Jog_Fwd_Loop.vrma',
    sitDown: 'Sitting_Enter.vrma',
    sit: 'Sitting_Idle_Loop.vrma',
    standUp: 'Sitting_Exit.vrma',
  };
  for (const [key, file] of Object.entries(seated)) if (existsSync(join(motions, file))) clips[key] = file;
  copyFileSync(character, join(folder, 'character.vrm'));
  for (const file of Object.values(clips)) copyFileSync(join(motions, file), join(folder, file));
  writeFileSync(join(folder, 'character.json'), JSON.stringify({ vrm: 'character.vrm', ...clips }));
}
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'));
mkdirSync(join(output, 'assets/licenses'), { recursive: true });
copyFileSync(join(root, 'assets/licenses/three-MIT.txt'), join(output, 'assets/licenses/three-MIT.txt'));
console.log(`Living room: ${relative(root, output) || '.'} (static files only)`);
