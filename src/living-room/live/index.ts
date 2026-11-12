/**
 * Live mode, put together (docs/living-live.md): the player's card as a screen in the room, the
 * picture's colours in the room's light, the music in the resident's body.
 *
 *   capture.ts      the tab's picture and sound, with the viewer's leave (or the video's still)
 *   frame-light.ts  the picture as light: where its colours are, eased
 *   beat.ts         the music: how lively, where the beats are
 *   stage.ts        the room as a live: the screen, the house lights, the spill, the beams
 *   homography.ts   the card drawn in the room's perspective
 *
 * The capture is asked for when live mode is entered (a press of its button) and let go when it
 * is left: the tab is read only while a live is on.
 */
import type { PerspectiveCamera } from 'three';
import type { DesktopState } from '../desktop/state';
import { LIVE_H, LIVE_W, type DesktopView } from '../desktop/view';
import type { LiveCue } from '../resident';
import { startBeat, stepBeat, type Bands, type BeatState } from './beat';
import { liveCapture, thumbnailFrame } from './capture';
import { DARK, easeLight, readFrame, startLight, type FrameLight } from './frame-light';
import { quadMatrix } from './homography';
import type { LiveViewName } from './player';
import { liveStage, type LiveStageEnv, type LiveView } from './stage';

export interface Live {
  /** The desktop's state changed (called at once, inside the press that changed it). */
  changed(state: DesktopState): void;
  setView(view: LiveViewName): void;
  setLight(on: boolean): void;
  /** One frame, after the camera is where it will be drawn from. */
  update(dt: number, now: number, state: DesktopState, camera: PerspectiveCamera): void;
  /** What the resident is to know of the live (undefined when there is none). */
  cue(): LiveCue | undefined;
  /** Where the camera is to be while the live is on. */
  camera(): LiveView | undefined;
  /** 0 the room as it is, 1 a live; the picture's light; the beat's pulse (1 on a beat). */
  readonly amount: number;
  readonly light: FrameLight;
  readonly pulse: number;
  /** For the checks: a picture and a sound given by hand instead of read from the tab. */
  feed(cells: Uint8ClampedArray | undefined, bands: Omit<Bands, 'dt'> | undefined): void;
  readout(): {
    capture: string;
    hears: boolean;
    energy: number;
    bpm: number;
    confidence: number;
    level: number;
    loud: number;
    peak: number;
    stage: Record<string, number>;
  };
}

export function startLive(env: LiveStageEnv & { wake(): void }, view: DesktopView): Live {
  const stage = liveStage(env);
  let on = false;
  let video: string | undefined;
  let viewName: LiveViewName = 'stage';
  let light = startLight();
  let beat: BeatState = startBeat();
  let still: Uint8ClampedArray | undefined;
  let stillOf: string | undefined;
  let fed: { cells: Uint8ClampedArray | undefined; bands: Omit<Bands, 'dt'> | undefined } | undefined;
  const status = () => view.player.status({ capture: capture.state, hears: capture.hears, view: viewName });
  const capture = liveCapture(() => {
    status();
    env.wake();
  });
  status();

  return {
    changed(state) {
      video = state.video;
      if (state.live === on) return;
      on = state.live;
      if (on) {
        beat = startBeat();
        // The viewer pressed "live mode": the browser asks them for this tab.
        if (!fed) void capture.start(view.player.box);
      } else capture.stop();
      env.wake();
    },
    setView(next) {
      viewName = next;
      status();
      env.wake();
    },
    setLight(wanted) {
      if (wanted && on) void capture.start(view.player.box);
      else capture.stop();
    },
    update(dt, now, state, camera) {
      // The picture: the tab's, or failing that the video's still (fetched once a video).
      if (on && video && stillOf !== video) {
        stillOf = video;
        still = undefined;
        const asked = video;
        void thumbnailFrame(asked).then((cells) => {
          if (stillOf === asked) still = cells;
        });
      }
      const cells = on ? (fed ? fed.cells : (capture.frame(now) ?? still)) : undefined;
      light = easeLight(light, cells ? readFrame(cells) : DARK, dt);
      // The music: the tab's sound; without it, a steady middling pulse while the player plays
      // (the resident sways, and does not pretend to hear what it cannot).
      const bands = on ? (fed ? fed.bands : capture.bands(dt)) : undefined;
      if (bands) beat = stepBeat(beat, { ...bands, dt });
      else {
        const playing = on && view.player.playing;
        beat = {
          ...beat,
          energy: beat.energy + ((playing ? 0.45 : 0.08) - beat.energy) * (1 - Math.exp(-dt / 1.2)),
          onset: false,
          pulse: 0,
          bpm: 104,
          beat: beat.beat + (dt * 104) / 60,
          confidence: 0,
        };
      }
      stage.update(dt, { on, light: light.light, cells, energy: beat.energy, pulse: beat.pulse, beat: beat.beat });
      if (state.live) {
        const corners = stage.corners(camera);
        view.setScreen(corners && quadMatrix(LIVE_W, LIVE_H, corners));
      }
    },
    cue: () =>
      on ? { spot: stage.spot, look: stage.look, energy: beat.energy, beat: beat.beat, bpm: beat.bpm } : undefined,
    camera: () => (on ? stage.view(viewName) : undefined),
    get amount() {
      return stage.amount;
    },
    get light() {
      return light.light;
    },
    get pulse() {
      return on ? beat.pulse : 0;
    },
    feed(cells, bands) {
      fed = cells || bands ? { cells, bands } : undefined;
      if (fed) capture.stop();
    },
    readout: () => ({
      capture: capture.state,
      hears: capture.hears,
      energy: beat.energy,
      bpm: beat.bpm,
      confidence: beat.confidence,
      level: light.light.level,
      loud: beat.level,
      peak: beat.peak,
      stage: stage.metrics,
    }),
  };
}
