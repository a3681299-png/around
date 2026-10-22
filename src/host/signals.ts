import type { PlaybackSource, SignalSnapshot } from '../signals/types';
import type { WorldEvent } from '../world/types';
import type { SignalId } from '../signals/registry';

/** A shared lazy subscription per tab. No polling, page API calls or pixel reads. */
export function createSignalSources(
  doc: Document,
  playback: PlaybackSource | undefined,
  changed: (source: SignalId, frameTime?: number) => void,
  occurred?: () => void,
) {
  const snapshot: SignalSnapshot = { pointer: undefined, playing: false };
  let pointer = false,
    clicks = false,
    overflow = false;
  let scroll = false,
    resize: ResizeObserver | undefined;
  let scrollDirty = false,
    scrollFrame: number | undefined;
  let events: WorldEvent[] = [];
  let video: ReturnType<PlaybackSource['connect']> | undefined;
  const onPointer = (event: PointerEvent) => {
    if (!event.isPrimary || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    // Authoring controls keep the last canvas position so numeric edits stay visible.
    if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-ww-signal-control')))
      return;
    snapshot.pointer = { x: event.clientX, y: event.clientY };
    snapshot.pointerTimeMs = doc.defaultView!.performance.now();
    changed('pointer.position');
  };
  const onClick = (event: MouseEvent) => {
    if (
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY) ||
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            (node.hasAttribute('data-ww-signal-control') || node.matches('input,textarea,select,[contenteditable]')),
        )
    )
      return;
    if (events.length === 64) {
      overflow = true;
      events.shift();
    }
    events.push({ type: 'pointer.click', point: { x: event.clientX, y: event.clientY } });
    occurred?.();
  };
  const sampleScroll = (notify = true, frameTime?: number) => {
    const root = doc.scrollingElement ?? doc.documentElement;
    const next = {
      x: root.scrollLeft,
      y: root.scrollTop,
      maxX: Math.max(0, root.scrollWidth - root.clientWidth),
      maxY: Math.max(0, root.scrollHeight - root.clientHeight),
    };
    const before = snapshot.scroll;
    snapshot.scroll = next;
    if (
      notify &&
      (!before || Object.keys(next).some((key) => next[key as keyof typeof next] !== before[key as keyof typeof next]))
    )
      changed('page.scroll.progress', frameTime);
  };
  const markScroll = () => {
    scrollDirty = true;
    if (scrollFrame === undefined)
      scrollFrame = doc.defaultView!.requestAnimationFrame((time) => {
        scrollFrame = undefined;
        if (scroll && scrollDirty) {
          scrollDirty = false;
          sampleScroll(true, time);
        }
      });
  };
  const cancelScroll = () => {
    if (scrollFrame !== undefined) doc.defaultView!.cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    scrollDirty = false;
  };
  const onScroll = (event: Event) => {
    if (event.target === doc || event.target === doc.scrollingElement) markScroll();
  };
  const onResize = () => markScroll();
  return {
    snapshot,
    get overflowed() {
      return overflow;
    },
    takeEvents() {
      const next = events;
      events = [];
      overflow = false;
      return next;
    },
    recordClicks(value: boolean) {
      if (clicks === value) return;
      clicks = value;
      if (value) doc.addEventListener('click', onClick, { capture: true, passive: true });
      else doc.removeEventListener('click', onClick, true);
    },
    configure(needed: { pointer: boolean; video: boolean; scroll?: boolean }) {
      if (scroll !== Boolean(needed.scroll)) {
        scroll = Boolean(needed.scroll);
        if (scroll) {
          doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
          doc.defaultView!.addEventListener('resize', onResize);
          resize = new ResizeObserver(onResize);
          resize.observe(doc.documentElement);
          if (doc.body) resize.observe(doc.body);
        } else {
          doc.removeEventListener('scroll', onScroll, true);
          doc.defaultView!.removeEventListener('resize', onResize);
          resize?.disconnect();
          resize = undefined;
          cancelScroll();
          delete snapshot.scroll;
        }
      }
      if (scroll) sampleScroll(false);
      if (pointer !== needed.pointer) {
        pointer = needed.pointer;
        if (pointer) doc.addEventListener('pointermove', onPointer, { capture: true, passive: true });
        else doc.removeEventListener('pointermove', onPointer, true);
      }
      if (!needed.video) {
        video?.destroy();
        video = undefined;
        snapshot.playing = false;
      } else if (!video && playback)
        video = playback.connect((signal) => {
          if (signal.event) {
            if (events.length === 64) {
              overflow = true;
              events.shift();
            }
            events.push({ type: signal.event });
            occurred?.();
          }
          if (snapshot.playing === signal.playing) return;
          snapshot.playing = signal.playing;
          changed('video.playing');
        });
      else video?.refresh();
    },
    destroy() {
      doc.removeEventListener('pointermove', onPointer, true);
      if (clicks) doc.removeEventListener('click', onClick, true);
      clicks = false;
      if (scroll) {
        doc.removeEventListener('scroll', onScroll, true);
        doc.defaultView!.removeEventListener('resize', onResize);
      }
      resize?.disconnect();
      resize = undefined;
      scroll = false;
      cancelScroll();
      delete snapshot.scroll;
      pointer = false;
      video?.destroy();
      video = undefined;
      snapshot.playing = false;
      events = [];
    },
  };
}
