// The Playground (docs/playground-plan.md): the WWT page runtime on our own video site, with no
// extension. Only this entry and its two ports differ from the extension's content script; the
// renderers, world, operation safety and artwork validation are the same code.
import { createPageController } from '../host/page-controller';
import { createPlaygroundAdapter, playgroundControls } from '../sites/playground';
import { createMemoryTakeStorage } from '../timeline/memory-takes';
import { parseDesign } from '../design/schema';
import { createFetchAssets, type PlaygroundManifest } from './assets';
import { mountPlayer } from './player';
import { openSpatial } from './spatial';

declare const __WW_PLAYGROUND_TEST__: boolean;

async function start() {
  mountPlayer(document);
  const base = new URL('content/', document.baseURI);
  const manifest = (await (
    await fetch(new URL('manifest.json', base), { credentials: 'omit' })
  ).json()) as PlaygroundManifest;
  // The artwork is untrusted data even here: the same parser and limits as the extension.
  const design = parseDesign(await (await fetch(new URL(manifest.design, base), { credentials: 'omit' })).json());
  const site = createPlaygroundAdapter(document);
  if (design.siteId !== site.id) throw new Error('作品の対象サイトが一致しません。');
  const assets = createFetchAssets(base, manifest);
  const controller = createPageController(document, site, {
    assets,
    takes: createMemoryTakeStorage(),
  });
  controller.updateDesign(design);
  const apply = document.querySelector<HTMLButtonElement>('#apply')!;
  const page = document.querySelector<HTMLElement>('#watch-page')!;
  const video = document.querySelector<HTMLVideoElement>('video[data-ww-video]')!;
  const basicOnly = __WW_PLAYGROUND_TEST__ && new URLSearchParams(location.search).has('basic');
  let applied = false,
    stopped = false;
  let spatial: ReturnType<typeof openSpatial> = null;
  const render = () => {
    controller.update({ enabled: applied && !spatial, creatorMode: false });
    apply.setAttribute('aria-pressed', String(applied));
    apply.textContent = applied ? '元に戻す' : 'WWT を適用';
    document.documentElement.toggleAttribute('data-ww-applied', applied);
  };
  function enter(preferCanvas = true) {
    if (basicOnly || stopped || spatial || !applied) return;
    spatial = openSpatial(
      page,
      video,
      assets,
      manifest.resident,
      (reason) => {
        spatial = null;
        if (reason === 'resize') enter();
        if (reason === 'graphics' && preferCanvas) enter(false);
        render();
      },
      preferCanvas,
    );
  }
  apply.addEventListener('click', () => {
    applied = !applied;
    if (applied) {
      if (spatial) spatial.cancelExit();
      else enter();
    } else spatial?.exit();
    render();
  });
  // Emergency OFF, as in the extension: the same shortcut stops every effect until pressed again.
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyQ') {
      stopped = !stopped;
      controller.suspend(stopped);
      if (stopped) spatial?.exit(true);
      else enter();
      render();
    }
  });
  render();
  apply.disabled = false;
  if (__WW_PLAYGROUND_TEST__)
    Object.assign(globalThis, {
      __wwPlayground: { controls: () => playgroundControls(document) },
    });
}

void start().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>('#status');
  if (status) status.textContent = error instanceof Error ? error.message : '読み込めませんでした。';
  console.error('[WWT Playground]', error);
});
