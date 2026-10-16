import type { PlaybackSource, SignalSnapshot } from '../signals/types';
import type { WorldEvent } from '../world/types';

/** A shared lazy subscription per tab. No polling, page API calls or pixel reads. */
export function createSignalSources(doc: Document, playback: PlaybackSource | undefined, changed: (source: 'pointer.position' | 'video.playing') => void, occurred?: () => void) {
  const snapshot: SignalSnapshot = { pointer: undefined, playing: false };
  let pointer = false;
  let events: WorldEvent[] = [];
  let video: ReturnType<PlaybackSource['connect']> | undefined;
  const onPointer = (event: PointerEvent) => {
    if (!event.isPrimary || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    // Authoring controls keep the last canvas position so numeric edits stay visible.
    if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-ww-signal-control'))) return;
    snapshot.pointer = { x: event.clientX, y: event.clientY }; changed('pointer.position');
  };
  return {
    snapshot,
    takeEvents() { const next = events; events = []; return next; },
    configure(needed: { pointer: boolean; video: boolean }) {
      if (pointer !== needed.pointer) {
        pointer = needed.pointer;
        if (pointer) doc.addEventListener('pointermove', onPointer, { capture: true, passive: true });
        else doc.removeEventListener('pointermove', onPointer, true);
      }
      if (!needed.video) { video?.destroy(); video = undefined; snapshot.playing = false; }
      else if (!video && playback) video = playback.connect((signal) => {
        if (signal.event) { if (events.length === 64) events.shift(); events.push({ type: signal.event }); occurred?.(); }
        if (snapshot.playing === signal.playing) return;
        snapshot.playing = signal.playing; changed('video.playing');
      });
      else video?.refresh();
    },
    destroy() { doc.removeEventListener('pointermove', onPointer, true); pointer = false; video?.destroy(); video = undefined; snapshot.playing = false; events = []; },
  };
}
