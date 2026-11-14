// The Playground (docs/playground-plan.md): the Around page runtime on our own video site, with no
// extension. Only this entry and its two ports differ from the extension's content script; the
// renderers, world, operation safety and artwork validation are the same code.
import { createPageController } from '../host/page-controller';
import { createPlaygroundAdapter, playgroundControls } from '../sites/playground';
import { createMemoryTakeStorage } from '../timeline/memory-takes';
import { parseDesign } from '../design/schema';
import { createFetchAssets, type PlaygroundManifest } from './assets';
import { mountPlayer } from './player';
import { openSpatial } from './spatial';
import { mountDesktopShell } from './desktop';
import { parseDesktopLayout } from './desktop-layout';

declare const __AROUND_PLAYGROUND_TEST__: boolean;
declare const __AROUND_PLAYGROUND_MIRDO__: boolean;

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
  const video = document.querySelector<HTMLVideoElement>('video[data-around-video]')!;
  const openDesktop = document.querySelector<HTMLButtonElement>('#open-desktop')!;
  const closeDesktop = document.querySelector<HTMLButtonElement>('#close-desktop')!;
  const shell = mountDesktopShell(video);
  const layout = parseDesktopLayout(manifest.desktop);
  if (layout.room) void assets.load(layout.room.asset).catch(() => undefined);
  const desktopHash = () => location.hash === '#desktop';
  const basicOnly = __AROUND_PLAYGROUND_TEST__ && new URLSearchParams(location.search).has('basic');
  // The demo opens on the plain site and the viewer presses「Around を適用」(design, demo scene 1→2);
  // only a direct #desktop link starts applied.
  let applied = desktopHash(),
    stopped = false;
  let spatial: ReturnType<typeof openSpatial> = null;
  const render = () => {
    const desktop = desktopHash() && applied && !stopped;
    openDesktop.hidden = !applied || stopped || desktop;
    shell.show(desktop ? (spatial ? 'spatial' : 'basic') : undefined);
    spatial?.setDesktop(desktop);
    controller.update({ enabled: applied && !spatial, creatorMode: false });
    apply.setAttribute('aria-pressed', String(applied));
    apply.textContent = applied ? '元に戻す' : 'Around を適用';
    document.documentElement.toggleAttribute('data-around-applied', applied);
    // Set only after enter() had its chance: the 3D board measures the page without the
    // basic layout's extra room for the seated feet (style.css).
    document.documentElement.toggleAttribute('data-around-basic', applied && !spatial && !stopped);
  };
  function enter(preferCanvas = true) {
    if (basicOnly || stopped || spatial || !applied) return;
    spatial = openSpatial(
      page,
      video,
      assets,
      manifest.resident,
      layout,
      (reason) => {
        spatial = null;
        if (reason === 'resize') enter();
        if (reason === 'graphics' && preferCanvas) enter(false);
        render();
      },
      preferCanvas,
    );
  }
  function route() {
    if (desktopHash()) {
      applied = true;
      if (spatial) spatial.cancelExit();
      else enter();
    }
    render();
  }
  function returnToBrowser() {
    if (history.state?.fromPlaygroundBrowser) history.back();
    else {
      history.replaceState(null, '', location.pathname + location.search);
      route();
    }
  }
  openDesktop.addEventListener('click', () => {
    if (desktopHash()) return;
    history.pushState({ fromPlaygroundBrowser: true }, '', '#desktop');
    route();
    closeDesktop.focus({ preventScroll: true });
  });
  closeDesktop.addEventListener('click', returnToBrowser);
  window.addEventListener('hashchange', route);
  apply.addEventListener('click', () => {
    applied = !applied;
    if (applied) {
      if (spatial) spatial.cancelExit();
      else enter();
    } else {
      spatial?.exit();
      if (desktopHash()) returnToBrowser();
    }
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
  document.querySelector<HTMLElement>('#mirdo-credits')!.hidden = !__AROUND_PLAYGROUND_MIRDO__;
  route();
  apply.disabled = false;
  if (__AROUND_PLAYGROUND_TEST__)
    Object.assign(globalThis, {
      __aroundPlayground: { controls: () => playgroundControls(document) },
    });
}

void start().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>('#status');
  if (status) status.textContent = error instanceof Error ? error.message : '読み込めませんでした。';
  console.error('[Around Playground]', error);
});
