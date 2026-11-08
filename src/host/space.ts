/**
 * The Host of the room behind the UI (docs/depth-foundation.md). It reads what the world needs —
 * pointer, scroll, reduced motion, the UI regions, the video's colour — passes it through the
 * pure functions of src/world/space.ts and asks the room renderer to draw. It draws only when
 * something moved, stops while the tab is hidden or the page is in fullscreen, and reads the
 * regions only while the page is changing (and once a second otherwise).
 */
import type { AssetPort } from '../assets/port';
import type { DesignSpace } from '../design/space';
import type { SiteBackdrop } from '../sites/types';
import {
  CAMERA_REST,
  cameraSettled,
  cameraTarget,
  glassPlates,
  projectCamera,
  samePlates,
  stepCamera,
  stepVideoLight,
  type GlassPlate,
  type SpaceCameraState,
  type VideoLight,
} from '../world/space';
import { createRoomRenderer, ROOM_SUBJECT_M, type RoomRenderer } from '../renderers/three/room';
import { SPACE_PROBE } from './world-options';

/** How long after a scroll, resize or page change the regions are read every frame. */
const ACTIVE_MS = 600;
/** Regions are read at least this often while still: YouTube moves parts without telling us. */
const IDLE_REGION_MS = 1000;
/** The video's colour is sampled this often (on the GPU); the world smooths between samples. */
// Twice a second: each read still costs a round trip to the GPU process (~0.6 ms on the notebook,
// measured), and the light moves at most 0.5 a second anyway.
const VIDEO_SAMPLE_MS = 500;
/** Only the light changing (a playing video): the room is redrawn at most this often. */
const LIGHT_ONLY_MS = 33;

export interface SpaceHost {
  update(space: DesignSpace | undefined): void;
  /** The place behind the UI for room-depth artwork while the room is shown; 'pending' while the
   * artwork has a room that is loading or hidden (fullscreen); undefined without a room. */
  place(): { parent: HTMLElement; zIndex: number; after: Element } | 'pending' | undefined;
  /** Tell the room the page changed (the adapter's page-change notice). */
  changed(): void;
  destroy(): void;
}

export function createSpaceHost(
  doc: Document,
  backdrop: SiteBackdrop,
  assets: AssetPort,
  onPlace?: () => void,
): SpaceHost {
  const view = doc.defaultView!;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let space: DesignSpace | undefined;
  let session:
    | {
        assetId: string;
        renderer?: RoomRenderer;
        slot: ReturnType<SiteBackdrop['open']>;
        abort: AbortController;
      }
    | undefined;
  let frame: number | undefined;
  let last = 0,
    activeUntil = 0,
    regionsAt = -Infinity,
    videoAt = -Infinity,
    drawnAt = -Infinity;
  let camera: SpaceCameraState = CAMERA_REST,
    drawnCamera: SpaceCameraState | undefined;
  let light: VideoLight = { r: 0, g: 0, b: 0 },
    drawnLight: VideoLight | undefined,
    sample: VideoLight | undefined;
  let plates: GlassPlate[] = [],
    drawnPlates: GlassPlate[] | undefined,
    drawnScheme = '',
    sized = '';
  let pointer: { x: number; y: number } | undefined;
  /** The current room's canvas has started fading in (after its first draw). */
  let revealing = false;

  const wake = () => {
    activeUntil = view.performance.now() + ACTIVE_MS;
    schedule();
  };
  const onPointer = (event: PointerEvent) => {
    pointer = {
      x: (event.clientX / Math.max(1, view.innerWidth)) * 2 - 1,
      y: (event.clientY / Math.max(1, view.innerHeight)) * 2 - 1,
    };
    schedule();
  };
  const onLeave = (event: PointerEvent) => {
    if (!event.relatedTarget) {
      pointer = undefined;
      schedule();
    }
  };
  const listen = (on: boolean) => {
    const m = on ? 'addEventListener' : 'removeEventListener';
    view[m]('pointermove', onPointer as EventListener, { passive: true } as AddEventListenerOptions);
    doc.documentElement[m]('pointerleave', onLeave as EventListener);
    doc[m]('scroll', wake, { capture: true, passive: true } as AddEventListenerOptions);
    view[m]('resize', wake);
    doc[m]('visibilitychange', wake);
    doc[m]('fullscreenchange', wake);
    reduced[m]('change', wake);
  };

  /**
   * The video's mean colour (linear RGB), into `sample` when ready. The browser shrinks the frame
   * to 8 × 5 off the page's thread (createImageBitmap with a resize), and only those 40 pixels are
   * read here. Reading the full frame on the page — a canvas getImageData of the video, or a WebGL
   * upload of it — stalled the page 4–16 ms a read in the CPU profiles. A frame that cannot be
   * read (protected, an advert switching) fades the light out instead (`undefined`).
   */
  let sampling = false;
  let shrunk: OffscreenCanvasRenderingContext2D | null | undefined;
  const sampleVideo = (video: HTMLVideoElement | undefined) => {
    if (sampling) return;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      sample = undefined;
      return;
    }
    sampling = true;
    view
      .createImageBitmap(video, { resizeWidth: 8, resizeHeight: 5, resizeQuality: 'low' })
      .then((bitmap) => {
        shrunk ??= new OffscreenCanvas(8, 5).getContext('2d', { willReadFrequently: true });
        if (!shrunk) throw new Error('no 2d');
        shrunk.drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = shrunk.getImageData(0, 0, 8, 5).data;
        const linear = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        let r = 0,
          g = 0,
          b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += linear(data[i]!);
          g += linear(data[i + 1]!);
          b += linear(data[i + 2]!);
        }
        sample = { r: r / 40, g: g / 40, b: b / 40 };
      })
      .catch(() => (sample = undefined))
      .finally(() => {
        sampling = false;
        schedule();
      });
  };

  const schedule = () => {
    if (frame === undefined && session?.renderer && !doc.hidden) frame = view.requestAnimationFrame(tick);
  };
  const tick = (now: number) => {
    frame = undefined;
    const renderer = session?.renderer;
    if (!renderer || !space || doc.hidden) return;
    const shown = !doc.fullscreenElement;
    if (renderer.canvas.hidden !== !shown) {
      renderer.canvas.hidden = !shown;
      // The canvas's own style holds display with !important (pages cannot restyle it), so the
      // hidden attribute alone would not hide it.
      renderer.canvas.style.setProperty('display', shown ? 'block' : 'none', 'important');
      onPlace?.();
    }
    if (!shown) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const size = `${view.innerWidth}x${view.innerHeight}`;
    if (size !== sized) {
      sized = size;
      renderer.resize(view.innerWidth, view.innerHeight);
      drawnPlates = undefined;
    }
    // Plates follow the UI: every frame while the page moves, once a second otherwise.
    if (now < activeUntil || now - regionsAt >= IDLE_REGION_MS) {
      regionsAt = now;
      plates = glassPlates(backdrop.regions(), { width: view.innerWidth, height: view.innerHeight });
    }
    if (now - videoAt >= VIDEO_SAMPLE_MS) {
      videoAt = now;
      if (space.videoLight > 0) sampleVideo(backdrop.video());
      else sample = undefined;
    }
    light = stepVideoLight(light, sample, dt, reduced.matches);
    const scrollProgress = view.scrollY / Math.max(1, view.innerHeight);
    const target = cameraTarget(space.camera, {
      ...(pointer ? { pointer } : {}),
      scroll: scrollProgress,
      reducedMotion: reduced.matches,
    });
    camera = stepCamera(camera, target, dt, space.camera.follow);
    const scheme = backdrop.scheme();
    const moved = !drawnCamera || !cameraSettled(camera, drawnCamera);
    const platesMoved = !drawnPlates || !samePlates(plates, drawnPlates) || scheme !== drawnScheme;
    const lit =
      !drawnLight ||
      Math.abs(light.r - drawnLight.r) + Math.abs(light.g - drawnLight.g) + Math.abs(light.b - drawnLight.b) > 1 / 512;
    if (moved || platesMoved || (lit && now - drawnAt >= LIGHT_ONLY_MS)) {
      renderer.draw(
        {
          camera: projectCamera({ fovDeg: renderer.baseFovDeg, subject: ROOM_SUBJECT_M }, camera),
          plates,
          scheme,
          video: light,
        },
        space,
      );
      if (!revealing) {
        const current = session;
        revealing = true;
        void renderer.reveal().then(() => {
          if (session === current) doc.documentElement.dataset['wwRoom'] = 'ready';
        });
      }
      drawnAt = now;
      drawnCamera = camera;
      drawnPlates = plates;
      drawnScheme = scheme;
      drawnLight = light;
      WW_SPACE_PROBE: {
        // Tests ask for drawn pixels by writing points (CSS px) to data-ww-room-sample; the answer
        // (sRGB bytes) is read right after this draw, from the same drawing buffer.
        const ask = doc.documentElement.dataset['wwRoomSample'];
        if (ask && renderer.readPixels) {
          try {
            const points = (JSON.parse(ask) as [number, number][]).slice(0, 4096).map(([x, y]) => ({ x, y }));
            doc.documentElement.dataset['wwRoomPixels'] = JSON.stringify(renderer.readPixels(points));
          } catch {
            doc.documentElement.dataset['wwRoomPixels'] = '[]';
          }
          delete doc.documentElement.dataset['wwRoomSample'];
        }
        doc.documentElement.dataset['wwRoomFrame'] = JSON.stringify({
          plates: plates.length,
          boxes: plates.map((p) => [p.left, p.top, p.right, p.bottom].map(Math.round)),
          camera: [camera.x, camera.y, camera.dolly].map((n) => Math.round(n * 1000) / 1000),
          light: Math.round((0.2126 * light.r + 0.7152 * light.g + 0.0722 * light.b) * 1000) / 1000,
          sample: sample ? Math.round((0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b) * 1000) / 1000 : null,
          video: (() => {
            const v = backdrop.video();
            return v ? [v.readyState, v.videoWidth, v.paused] : null;
          })(),
          scheme,
        });
      }
    }
    // Keep going while anything is still on its way: the camera, the light, a moving page, a
    // playing video's colour. Otherwise sleep until an event wakes the loop.
    const video = backdrop.video();
    const playing = Boolean(video && !video.paused && space.videoLight > 0);
    if (!cameraSettled(camera, target) || now < activeUntil || playing || lit) schedule();
    else view.setTimeout(schedule, IDLE_REGION_MS);
  };

  const stop = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    if (!session) return;
    session.abort.abort();
    session.renderer?.destroy();
    session.slot.close();
    session = undefined;
    listen(false);
    last = 0;
    revealing = false;
    drawnCamera = drawnPlates = drawnLight = undefined;
    sized = '';
    camera = CAMERA_REST;
    delete doc.documentElement.dataset['wwRoom'];
    onPlace?.();
  };
  const start = (next: DesignSpace) => {
    const abort = new AbortController();
    const slot = backdrop.open();
    session = { assetId: next.room.assetId, slot, abort };
    listen(true);
    const current = session;
    void assets
      .load(next.room.assetId, abort.signal)
      .then(async (asset) => {
        if (!asset.modelBuffer) throw new Error('部屋の素材は GLB で読み込んでください。');
        const renderer = await createRoomRenderer(doc, slot, asset.modelBuffer, {
          readback: SPACE_PROBE,
          signal: abort.signal,
        });
        if (session !== current || abort.signal.aborted) {
          renderer.destroy();
          return;
        }
        current.renderer = renderer;
        // The page's background turns transparent only now; the canvas fades in after its first
        // draw (tick), and 'ready' is set once it is fully shown.
        slot.show();
        doc.documentElement.dataset['wwRoom'] = 'loading';
        WW_SPACE_PROBE: {
          // A sample request forces the next draw (the page's own attribute change wakes nobody).
          const watch = new MutationObserver(() => {
            if (doc.documentElement.dataset['wwRoomSample']) {
              drawnCamera = undefined;
              schedule();
            }
          });
          watch.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ww-room-sample'] });
          abort.signal.addEventListener('abort', () => watch.disconnect());
        }
        onPlace?.();
        wake();
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        doc.documentElement.dataset['wwRoom'] = 'error';
        console.error('[Web World Themes] 部屋を読み込めませんでした。', error);
      });
  };
  return {
    update(next) {
      space = next;
      if (!next) return stop();
      if (session && session.assetId !== next.room.assetId) stop();
      if (!session) start(next);
      drawnCamera = undefined;
      wake();
    },
    place() {
      if (!session) return undefined;
      const renderer = session.renderer;
      // Room-depth artwork waits for the room (and is not drawn in fullscreen, where nothing
      // behind the player shows) rather than being drawn in front under the guard meanwhile.
      if (!renderer || renderer.canvas.hidden || !renderer.canvas.isConnected) return 'pending';
      return { parent: session!.slot.parent, zIndex: session!.slot.zIndex, after: renderer.canvas };
    },
    changed() {
      backdrop.refresh?.();
      wake();
    },
    destroy: stop,
  };
}
