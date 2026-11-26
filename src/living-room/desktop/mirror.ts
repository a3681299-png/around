/**
 * Mirror mode (docs/living-desktop.md): the user may share a screen, a window or a tab with this
 * page (the browser asks every time; nothing is asked before the button is pressed). The picture
 * goes to the room's monitor and its average colour to the room's light. It never leaves the
 * page: no upload, no storage, no recording.
 */
import type { Rgb } from './state';

export type MirrorState = 'off' | 'asking' | 'on' | 'refused' | 'unsupported';

export interface Mirror {
  readonly state: MirrorState;
  start(): Promise<void>;
  stop(): void;
  /** The picture's average colour (linear RGB), sampled a few times a second; undefined when off. */
  color(now: number): Rgb | undefined;
}

/** How often the picture's colour is read (milliseconds): light may lag a little, cheaply. */
const SAMPLE_MS = 250;

export function mirror(video: HTMLVideoElement, changed: (state: MirrorState) => void): Mirror {
  let state: MirrorState =
    navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices ? 'off' : 'unsupported';
  let stream: MediaStream | undefined;
  // A tiny canvas kept on the CPU (it is read back): the browser scales the frame down to it.
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 8;
  const pen = probe.getContext('2d', { willReadFrequently: true });
  let sampledAt = -Infinity;
  let sampled: Rgb | undefined;
  const set = (next: MirrorState) => {
    state = next;
    changed(next);
  };
  const stop = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    video.srcObject = null;
    sampled = undefined;
    if (state === 'on' || state === 'asking') set('off');
  };
  return {
    get state() {
      return state;
    },
    async start() {
      if (state === 'unsupported' || state === 'asking' || state === 'on') return;
      set('asking');
      try {
        // A modest size and rate: it is a picture on a monitor across a room, and a light.
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 20 }, width: { max: 1280 }, height: { max: 720 } },
          audio: false,
        });
      } catch {
        stream = undefined;
        set('refused');
        return;
      }
      // "Stop sharing" in the browser's own bar ends it here too.
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', stop);
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        stop();
        set('refused');
        return;
      }
      set('on');
    },
    stop,
    color(now) {
      if (state !== 'on' || !pen || video.readyState < 2) return undefined;
      if (now - sampledAt < SAMPLE_MS) return sampled;
      sampledAt = now;
      pen.drawImage(video, 0, 0, 8, 8);
      const { data } = pen.getImageData(0, 0, 8, 8);
      let r = 0,
        g = 0,
        b = 0;
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      for (let i = 0; i < data.length; i += 4) {
        r += lin(data[i]!);
        g += lin(data[i + 1]!);
        b += lin(data[i + 2]!);
      }
      const n = data.length / 4;
      sampled = [r / n, g / n, b / n];
      return sampled;
    },
  };
}
