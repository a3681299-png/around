// The living room at one fixed address on this PC (docs/living-live.md, docs/dual-pc-workflow.md):
//
//   npm run living            → builds the room with this PC's own Felis, serves it, opens it
//   npm run living -- --no-open
//
// The address is always http://127.0.0.1:4180/ on the laptop and on the desktop alike, so one
// bookmark works on both (and what the page keeps in the browser, the last video, stays with it).
// The server answers this PC only: the character is private (its terms are unconfirmed) and is
// never put anywhere another machine could reach.
//
// The character comes from the private asset repository's clone on this PC: AROUND_PRIVATE, or
// C:/wwt-private. Without it (or with its files still Git LFS pointers) the room opens without
// the character, and says why.
//
// Each start builds afresh from the checkout it is run in, into a folder of its own; a build that
// fails leaves the last good one in place and serves that.
import { spawnSync } from 'node:child_process';
import { existsSync, openSync, readSync, closeSync, renameSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlaygroundServer } from './playground/serve.mjs';

export const LIVING_PORT = 4180;
export const LIVING_URL = `http://127.0.0.1:${LIVING_PORT}/`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const served = join(root, '.work', 'living-room-live');
const next = join(root, '.work', 'living-room-live-next');
const open = !process.argv.includes('--no-open');

/** Whether a file is there with its contents (not a Git LFS pointer left by a clone without them). */
function real(file) {
  if (!existsSync(file)) return false;
  const head = Buffer.alloc(40);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, head, 0, 40, 0);
  } finally {
    closeSync(fd);
  }
  return !head.toString('latin1').startsWith('version https://git-lfs');
}

function character() {
  const assets = resolve(process.env.AROUND_PRIVATE ?? 'C:/wwt-private');
  const vrm = join(assets, 'Felis_v0.8.1', 'work', 'felis-1024.vrm');
  const motions = join(assets, 'Felis_v0.8.1', 'motions');
  if (!existsSync(assets)) return { why: `私用素材のフォルダがありません（${assets}。AROUND_PRIVATE で指定できます）` };
  if (!real(vrm) || !real(join(motions, 'Idle_Loop.vrma')))
    return { why: `フェリスの素材がまだありません（${assets} で git pull と git lfs pull をしてください）` };
  return { vrm, motions };
}

/** Whether the room is already served at the fixed address (by an earlier start). */
const running = () =>
  new Promise((done) => {
    const request = get(LIVING_URL, { timeout: 1500 }, (response) => {
      response.resume();
      done(response.statusCode === 200);
    });
    request.on('error', () => done(false));
    request.on('timeout', () => {
      request.destroy();
      done(false);
    });
  });

function openBrowser() {
  if (!open) return;
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', LIVING_URL]]
      : process.platform === 'darwin'
        ? ['open', [LIVING_URL]]
        : ['xdg-open', [LIVING_URL]];
  spawnSync(command, args, { stdio: 'ignore' });
}

const felis = character();
console.log(felis.vrm ? 'フェリス入りで作ります。' : `フェリスなしで作ります：${felis.why}`);
const built = spawnSync(process.execPath, [join(root, 'scripts', 'build-living-room.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    AROUND_LIVING_OUT: '.work/living-room-live-next',
    // (Never the test hook in the room people use.)
    AROUND_LIVING_TEST: '',
    AROUND_LIVING_CHARACTER: felis.vrm ?? '',
    AROUND_LIVING_MOTIONS: felis.motions ?? '',
  },
});
if (built.status === 0) {
  rmSync(served, { recursive: true, force: true });
  renameSync(next, served);
} else if (existsSync(join(served, 'index.html'))) {
  console.warn('作り直せませんでした。前に作った物を出します。');
} else {
  console.error('作れませんでした。上のエラーを見てください。');
  process.exit(1);
}

if (await running()) {
  // An earlier start is serving the same folder: it now has the new build.
  console.log(`もう開いています：${LIVING_URL}`);
  openBrowser();
} else {
  createPlaygroundServer(served)
    .on('error', (error) => {
      console.error(
        `${LIVING_PORT} 番を使えませんでした（${error.code}）。ほかのものが使っていないか確かめてください。`,
      );
      process.exit(1);
    })
    .listen(LIVING_PORT, '127.0.0.1', () => {
      console.log(`開きました：${LIVING_URL}（止めるときは Ctrl+C）`);
      openBrowser();
    });
}
