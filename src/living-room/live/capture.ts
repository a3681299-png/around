/**
 * The picture and the sound of the player, read (docs/living-live.md).
 *
 * The player is YouTube's own, in a frame of another origin: this page cannot look into it, and
 * that is as it should be. What the page may do, with the viewer's leave, is what any screen
 * share does: ask the browser for a capture of this tab (the browser asks the viewer, every
 * time), crop that capture to the player's own box, and read it. So the room's light is the
 * colour of the video that is really playing, and the resident hears the music that is really
 * playing. Nothing is kept, recorded or sent anywhere: each frame is scaled down to a grid of
 * 16 × 9 colours and thrown away, and of the sound only how loud its low, middle and high parts
 * are is read.
 *
 * Where the browser cannot do this (no tab capture, no cropping), or the viewer says no, the
 * page falls back to the video's still (its thumbnail, which YouTube serves to any page): the
 * room takes its colours, unmoving, and there is no sound to hear.
 */
import { GRID_H, GRID_W } from './frame-light';
import type { Bands } from './beat';

export type CaptureState = 'off' | 'asking' | 'on' | 'refused' | 'unsupported';

export interface LiveCapture {
  readonly state: CaptureState;
  /** Whether the tab's sound came with the picture (the viewer may share the picture only). */
  readonly hears: boolean;
  /** Asks the browser (and so the viewer) for this tab, cropped to `box`. */
  start(box: HTMLElement): Promise<void>;
  stop(): void;
  /**
   * The picture now, as GRID_W × GRID_H cells of RGBA bytes; undefined when there is none. Read
   * at most some fifteen times a second (the same bytes are given again in between).
   */
  frame(now: number): Uint8ClampedArray | undefined;
  /** How loud the sound's low, middle and high parts are now (0–1 each); undefined without sound. */
  bands(dt: number): Bands | undefined;
}

interface CropTargetStatic {
  fromElement(element: Element): Promise<unknown>;
}
type CroppableTrack = MediaStreamTrack & { cropTo?(target: unknown): Promise<void> };

/** The analyser's range, decibels, and each of its bytes as an amplitude (1 at the top of it). */
const DB = { min: -85, max: -15 };
const AMPLITUDE = Float32Array.from({ length: 256 }, (_, byte) => 10 ** (((byte / 255 - 1) * (DB.max - DB.min)) / 20));
/** Milliseconds between two readings of the picture: light may lag a frame or two, cheaply. */
const FRAME_MS = 66;

export function liveCapture(changed: (state: CaptureState) => void): LiveCapture {
  const cropTarget = (globalThis as { CropTarget?: CropTargetStatic }).CropTarget;
  let state: CaptureState =
    navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && cropTarget ? 'off' : 'unsupported';
  let stream: MediaStream | undefined;
  // The captured picture plays in a video that is never shown; the browser scales it down onto a
  // tiny canvas kept on the CPU (it is read back), which is the whole of what is looked at.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const probe = document.createElement('canvas');
  probe.width = GRID_W;
  probe.height = GRID_H;
  const pen = probe.getContext('2d', { willReadFrequently: true });
  let readAt = -Infinity;
  let cells: Uint8ClampedArray | undefined;
  let audio: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let spectrum: Uint8Array<ArrayBuffer> | undefined;
  const set = (next: CaptureState) => {
    state = next;
    changed(next);
  };
  const stop = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    video.srcObject = null;
    cells = undefined;
    void audio?.close();
    audio = analyser = spectrum = undefined;
    if (state === 'on' || state === 'asking') set('off');
  };
  return {
    get state() {
      return state;
    },
    get hears() {
      return Boolean(analyser);
    },
    async start(box) {
      if (state === 'unsupported' || state === 'asking' || state === 'on' || !cropTarget) return;
      set('asking');
      let track: CroppableTrack | undefined;
      try {
        // This tab only (the browser's dialog offers nothing else), with its sound, untouched by
        // the voice-call processing a microphone would get.
        // (A small picture, asked for as such: it is only ever read as 16 × 9 colours, and a
        // full-size capture read back to the page every frame costs far more than the room does.)
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 20 }, width: { max: 256 }, height: { max: 144 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          systemAudio: 'exclude',
          surfaceSwitching: 'exclude',
        } as DisplayMediaStreamOptions);
        track = stream.getVideoTracks()[0];
        // Anything but this tab (a window, a screen) is not what was asked for and is not read.
        if (!track?.cropTo || track.getSettings().displaySurface !== 'browser') throw new Error('not this tab');
        await track.cropTo(await cropTarget.fromElement(box));
      } catch {
        for (const t of stream?.getTracks() ?? []) t.stop();
        stream = undefined;
        set('refused');
        return;
      }
      // "Stop sharing" in the browser's own bar ends it here too.
      track.addEventListener('ended', stop);
      video.srcObject = new MediaStream([track]);
      try {
        await video.play();
      } catch {
        stop();
        set('refused');
        return;
      }
      // The sound, if the viewer shared it: only an analyser hears it (it is not played again:
      // the player itself is what is heard).
      const [sound] = stream.getAudioTracks();
      if (sound) {
        try {
          audio = new AudioContext();
          analyser = audio.createAnalyser();
          analyser.fftSize = 1024;
          analyser.minDecibels = DB.min;
          analyser.maxDecibels = DB.max;
          analyser.smoothingTimeConstant = 0.2;
          audio.createMediaStreamSource(new MediaStream([sound])).connect(analyser);
          spectrum = new Uint8Array(analyser.frequencyBinCount);
        } catch {
          audio = analyser = spectrum = undefined;
        }
      }
      set('on');
    },
    stop,
    frame(now) {
      if (state !== 'on' || !pen || video.readyState < 2) return undefined;
      if (now - readAt < FRAME_MS) return cells;
      readAt = now;
      pen.drawImage(video, 0, 0, GRID_W, GRID_H);
      cells = pen.getImageData(0, 0, GRID_W, GRID_H).data;
      return cells;
    },
    bands(dt) {
      if (!analyser || !spectrum || !audio) return undefined;
      analyser.getByteFrequencyData(spectrum);
      // Bins by frequency: the kick and the bass under 150 Hz, voices and most instruments up to
      // 2 kHz, cymbals and air above.
      const hz = audio.sampleRate / analyser.fftSize;
      // (The analyser gives decibels as bytes, which flatten a kick into its bed: they are turned
      // back into amplitudes, where a beat stands well clear of what is around it.)
      const mean = (from: number, to: number) => {
        const a = Math.max(1, Math.round(from / hz)),
          b = Math.min(spectrum!.length, Math.max(a + 1, Math.round(to / hz)));
        let sum = 0;
        for (let i = a; i < b; i++) sum += AMPLITUDE[spectrum![i]!]!;
        return sum / (b - a);
      };
      return { dt, bass: mean(30, 150), mid: mean(150, 2000), high: mean(2000, 9000) };
    },
  };
}

/**
 * The video's still as a frame of the grid (the fallback's light): YouTube serves thumbnails to
 * any page, so this needs no leave. Undefined if it cannot be had.
 */
export async function thumbnailFrame(id: string): Promise<Uint8ClampedArray | undefined> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return undefined;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    const pen = canvas.getContext('2d', { willReadFrequently: true });
    if (!pen) return undefined;
    // (The still is 4:3 with the 16:9 picture in its middle: the bars above and below are cut.)
    const bar = image.naturalHeight * 0.125;
    pen.drawImage(image, 0, bar, image.naturalWidth, image.naturalHeight - bar * 2, 0, 0, GRID_W, GRID_H);
    return pen.getImageData(0, 0, GRID_W, GRID_H).data;
  } catch {
    return undefined;
  }
}
