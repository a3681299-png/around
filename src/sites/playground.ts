import type { SiteAdapter } from './types';
import type { DesignTarget } from '../design/types';
import type { PlaybackSignal, PlaybackSource } from '../signals/types';
import { createOperationSource, type OperationCandidate } from '../host/operation-source';
import { createCompositionReader } from '../host/operation-composition';
import { SHARED_DECORATION_ANCHORS } from './anchors';

/**
 * The Playground's own video site (docs/playground-plan.md). The page carries its marks itself:
 * `data-around-surface` names a part's kind (the same kinds as on YouTube), `data-around-control` names an
 * operation surface's kind, and `data-around-video` is the main video. Everything site-specific stays
 * here: characters and artwork speak only of part kinds, anchors and common signals, so the same
 * artwork works with this adapter or the YouTube one.
 */
export const PLAYGROUND_SITE_ID = 'playground';
const CONTROL = 'data-around-control';
const KINDS = ['click', 'drag', 'text-input', 'gesture'] as const;
type ControlKind = (typeof KINDS)[number];

export const PLAYGROUND_DESIGN_TARGETS: readonly DesignTarget[] = Object.freeze([
  { id: 'video-card', surface: 'video-card', label: '動画カード' },
  { id: 'primary-heading', surface: 'primary-heading', label: '動画のタイトル' },
  { id: 'page', surface: 'page', label: 'ページ' },
]);

/** Every operation surface the page marked, in document order. */
export function playgroundControls(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(`[${CONTROL}]`)].filter((element) => !element.closest('[id^="around"]'));
}

function playgroundPlayback(doc: Document): PlaybackSource {
  return {
    connect(emit) {
      const video = doc.querySelector<HTMLVideoElement>('video[data-around-video]');
      const events = ['play', 'playing', 'pause', 'ended', 'emptied'] as const;
      let previous: boolean | undefined;
      const publish = (event?: Event) => {
        const playing = Boolean(video?.isConnected && !video.paused && !video.ended);
        const occurrence: PlaybackSignal['event'] =
          event?.type === 'play'
            ? 'video.play'
            : event?.type === 'pause'
              ? 'video.pause'
              : event?.type === 'ended'
                ? 'video.ended'
                : undefined;
        if (previous === playing && !occurrence) return;
        previous = playing;
        emit({ playing, ...(occurrence ? { event: occurrence } : {}) });
      };
      events.forEach((type) => video?.addEventListener(type, publish));
      publish();
      return {
        refresh: () => publish(),
        destroy: () => events.forEach((type) => video?.removeEventListener(type, publish)),
      };
    },
  };
}

function playgroundOperations(doc: Document) {
  const overlaySlot = () => ({ parent: doc.body, zIndex: 1 });
  // The page is ours: no element on it makes a stacking context of its own and its background is
  // the canvas's, so a negative z-index puts atmosphere between the background and the content.
  const underlaySlot = () => ({ parent: doc.body, zIndex: -1 });
  return createOperationSource(
    doc,
    () => {
      const composition = createCompositionReader(doc);
      const rows: OperationCandidate[] = playgroundControls(doc).map((element, index) => {
        const declared = element.getAttribute(CONTROL) as ControlKind;
        const r = element.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && composition.style(element).visibility !== 'hidden';
        return {
          id: `playground.${declared}.${index}`,
          // An unknown mark is treated as a click target: protected rather than ignored.
          kind: KINDS.includes(declared) ? declared : 'click',
          element,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          visible,
          scrolls: visible ? composition.scrolls(element) : true,
          // The video picture itself may be painted over (as on YouTube); its controls may not.
          ...(element.hasAttribute('data-around-video') ? { occlusion: 'allow' as const } : {}),
        };
      });
      const active = doc.activeElement;
      if (active instanceof HTMLElement && active !== doc.body && !rows.some((row) => row.element === active))
        rows.push({ id: 'native.focus', kind: 'gesture', element: active });
      return rows;
    },
    () => undefined,
    overlaySlot,
    () => undefined,
    (root, deep) => root.matches(`[${CONTROL}]`) || Boolean(deep && root.querySelector(`[${CONTROL}]`)),
    underlaySlot,
  );
}

export function createPlaygroundAdapter(doc: Document): SiteAdapter {
  return {
    id: PLAYGROUND_SITE_ID,
    designTargets: PLAYGROUND_DESIGN_TARGETS,
    // The same anchors as YouTube's: artwork placed on the player moves between sites unchanged.
    decorationAnchors: SHARED_DECORATION_ANCHORS,
    signals: { videoPlayback: playgroundPlayback(doc) },
    operationSurfaces: () => playgroundOperations(doc),
    mountSettings: () => () => undefined,
    connect(onPageChange) {
      const root = doc.documentElement;
      // Artwork CSS is scoped to html[data-around-site]; the site names itself while connected.
      root.setAttribute('data-around-site', PLAYGROUND_SITE_ID);
      root.setAttribute('data-around-mode', 'light');
      // The list is the only part that changes after load; report the inserted nodes only.
      const list = doc.querySelector('[data-around-list]');
      const observer = new MutationObserver((records) => {
        const added = records.flatMap((record) =>
          [...record.addedNodes].filter((n): n is Element => n instanceof Element),
        );
        onPageChange('content', added);
      });
      if (list) observer.observe(list, { childList: true, subtree: true });
      const resize = () => onPageChange('structure');
      doc.defaultView?.addEventListener('resize', resize);
      return () => {
        observer.disconnect();
        doc.defaultView?.removeEventListener('resize', resize);
        root.removeAttribute('data-around-site');
        root.removeAttribute('data-around-mode');
      };
    },
  };
}
