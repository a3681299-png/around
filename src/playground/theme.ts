// The Playground (docs/playground-plan.md): the WWT page runtime on our own video site, with no
// extension. Only this entry and its two ports differ from the extension's content script; the
// renderers, world, operation safety and artwork validation are the same code.
import { createPageController } from '../host/page-controller';
import { createPlaygroundAdapter, playgroundControls } from '../sites/playground';
import { createMemoryTakeStorage } from '../timeline/memory-takes';
import { parseDesign } from '../design/schema';
import { createFetchAssets, type PlaygroundManifest } from './assets';
import { prepareSpatial, type PreparedSpatial, type Spatial } from './spatial';
import { parseDesktopLayout } from './desktop-layout';

declare const __WW_PLAYGROUND_TEST__: boolean;
declare const __WW_PLAYGROUND_MIRDO__: boolean;

export async function mountTheme(connect: (toggle: () => void) => void) {
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
  const layout = parseDesktopLayout(manifest.desktop);
  const credits = document.querySelector<HTMLElement>('#mirdo-credits')!;
  const basicOnly = __WW_PLAYGROUND_TEST__ && new URLSearchParams(location.search).has('basic');
  let applied = false;
  let stopped = false;
  let pending = false;
  let spatial: Spatial | null = null;
  let preparation: { candidate: PreparedSpatial | null; ready: boolean } | undefined;
  const root = document.documentElement;
  const render = () => {
    controller.update({ enabled: applied && !spatial, creatorMode: false });
    apply.setAttribute('aria-pressed', String(applied));
    const waiting = !applied && pending && !stopped;
    apply.textContent = applied ? '元に戻す' : waiting ? '準備中…' : 'WWT を適用';
    if (waiting) apply.setAttribute('aria-busy', 'true');
    else apply.removeAttribute('aria-busy');
    root.toggleAttribute('data-ww-applied', applied && !stopped);
    root.toggleAttribute('data-ww-basic', applied && !spatial && !stopped);
    credits.hidden = !__WW_PLAYGROUND_MIRDO__ || !applied || stopped;
    apply.disabled = stopped;
  };

  function prepare(preferCanvas = true, snap = false) {
    preparation?.candidate?.dispose();
    const candidate = basicOnly
      ? null
      : prepareSpatial(
          page,
          video,
          assets,
          manifest.resident,
          layout,
          (reason) => {
            spatial = null;
            if (!stopped && (reason !== 'graphics' || preferCanvas)) prepare(reason !== 'graphics', Boolean(reason));
            render();
          },
          preferCanvas,
        );
    const job = { candidate, ready: false };
    preparation = job;
    // Basic uses the shared renderer. Its first pose and image can reuse the verified bytes.
    const warm =
      candidate?.ready ??
      Promise.allSettled(
        design.decorations.flatMap((layer) => {
          if (layer.kind === 'image') return [assets.load(layer.assetId)];
          if (layer.kind !== 'model3d') return [];
          return [
            assets.load(layer.assetId),
            ...(layer.character?.motions.map((motion) => assets.load(motion.assetId)) ?? []),
          ];
        }),
      );
    void warm.then(() => {
      if (preparation !== job) return;
      job.ready = true;
      performance.mark('playground:prepared', { detail: candidate?.mode ?? 'basic' });
      if (!stopped && (applied || pending)) enter(snap);
    });
  }

  function enter(snap = false) {
    const next = preparation;
    if (stopped || (!spatial && !next?.ready)) return;
    if (!applied) performance.mark('playground:apply');
    if (spatial) spatial.cancelExit();
    else if (next?.candidate) {
      spatial = next.candidate.activate(snap);
      preparation = undefined;
    }
    applied = true;
    pending = false;
    render();
  }

  connect(() => {
    if (stopped) return;
    if (applied) {
      applied = false;
      spatial?.exit();
    } else {
      pending = !pending;
      if (pending) enter();
    }
    render();
  });
  // Emergency OFF, as in the extension: the same shortcut stops every effect until pressed again.
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyQ') {
      stopped = !stopped;
      controller.suspend(stopped);
      if (stopped) {
        spatial?.exit(true);
        preparation?.candidate?.dispose();
        preparation = undefined;
      } else prepare();
      render();
    }
  });
  window.addEventListener('resize', () => {
    if (!stopped && !spatial) prepare(true, applied);
  });
  prepare();
  render();
  if (__WW_PLAYGROUND_TEST__)
    Object.assign(globalThis, {
      __wwPlayground: { controls: () => playgroundControls(document) },
    });
}
