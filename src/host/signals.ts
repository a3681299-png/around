import type { PlaybackSource, SignalSnapshot } from '../signals/types';

/** A shared lazy subscription per tab. No polling, page API calls or pixel reads. */
export function createSignalSources(doc: Document, playback: PlaybackSource | undefined, changed: (source: 'pointer.position' | 'video.playing') => void) {
  const snapshot: SignalSnapshot = { pointer: undefined, playing: false };
  let pointer = false;
  let video: ReturnType<PlaybackSource['connect']> | undefined;
  const onPointer = (event: PointerEvent) => {
    if (!event.isPrimary || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    // Authoring controls keep the last canvas position so numeric edits stay visible.
    if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-ww-signal-control'))) return;
    snapshot.pointer = { x: event.clientX, y: event.clientY }; changed('pointer.position');
  };
  return {
    snapshot,
    configure(needed: { pointer: boolean; video: boolean }) {
      if (pointer !== needed.pointer) {
        pointer = needed.pointer;
        if (pointer) doc.addEventListener('pointermove', onPointer, { capture: true, passive: true });
        else doc.removeEventListener('pointermove', onPointer, true);
      }
      if (!needed.video) { video?.destroy(); video = undefined; snapshot.playing = false; }
      else if (!video && playback) video = playback.connect((signal) => {
        if (snapshot.playing === signal.playing) return;
        snapshot.playing = signal.playing; changed('video.playing');
      });
      else video?.refresh();
    },
    destroy() { doc.removeEventListener('pointermove', onPointer, true); pointer = false; video?.destroy(); video = undefined; snapshot.playing = false; },
  };
}
