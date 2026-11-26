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
  glassSheets,
  projectCamera,
  samePlates,
  stepCamera,
  stepVideoLight,
  type CameraProjection,
  type GlassPlate,
  type SpaceCameraState,
  type VideoLight,
} from '../world/space';
import { createRoomRenderer, ROOM_SUBJECT_M, type RoomRenderer } from '../renderers/three/room';
import { loadRoomResident, type ResidentClipName, type RoomResident } from '../renderers/three/room-resident';
import {
  residentPose,
  startResident,
  stepResident,
  withFloorPlaces,
  TOUCH_MARK_S,
  type ResidentState,
  type RoomLayout,
  type RoomSpot,
} from '../world/room-life';
import {
  DEFAULT_SHOTS,
  currentShot,
  flatness,
  shotCamera,
  shotSettled,
  startShots,
  stepShots,
  wantedShot,
  type CameraShots,
  type ShotName,
  type ShotState,
} from '../world/camera-shots';
import type { SpaceLayout } from '../design/space';
import { SPACE_PROBE } from './world-options';

/** The room's resident as the page controller found it in the artwork: its 3D layer's model and
 * its character motions (asset IDs and the names they were imported with). */
export interface ResidentSource {
  layerId: string;
  assetId: string;
  motions: readonly { id: string; assetId: string; role?: string }[];
}
/** The body's clips from the character's own motions, by the names they were imported with
 * (Quaternius-style names: Walk_Loop, Sitting_Enter…; the engine reads names, never the site). */
export function residentClips(motions: ResidentSource['motions']): Map<ResidentClipName, string> {
  const out = new Map<ResidentClipName, string>();
  const find = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const hit = motions.find((m) => pattern.test(m.id));
      if (hit) return hit.assetId;
    }
    return undefined;
  };
  const set = (name: ResidentClipName, id: string | undefined) => id && out.set(name, id);
  set('idle', find(/^idle(-loop)?$/, /idle/));
  set('walk', find(/^walk(-loop)?$/, /walk/));
  set('sit', find(/^sit(ting)?(-idle)?(-loop)?$/, /sit.*idle/, /^sit/));
  set('sitDown', find(/sit.*(enter|down)/));
  set('standUp', find(/sit.*(exit|up)/, /stand.*up/));
  set('hide', find(/crouch/, /hide/));
  set('hop', find(/jump|hop/));
  set('touch', find(/interact|touch|wave/));
  // Names that say nothing (a file renamed): the roles measured at import (characters/settings.ts).
  const byRole = (role: string) => motions.find((m) => m.role === role)?.assetId;
  if (!out.has('idle')) set('idle', byRole('idle'));
  if (!out.has('walk')) set('walk', byRole('move'));
  if (!out.has('sit')) set('sit', byRole('sit'));
  return out;
}
/** The artwork's own layout as the world's numbers (rectangles become two triangles each). */
const layoutFromArtwork = (l: SpaceLayout): RoomLayout => ({
  floorY: l.floorY,
  floor: l.floor.flatMap((r) => [
    [r.x0, r.z0, r.x1, r.z0, r.x1, r.z1],
    [r.x0, r.z0, r.x1, r.z1, r.x0, r.z1],
  ]),
  spots: l.spots.map((s, i) => ({
    id: `${s.kind}_${i}`,
    kind: s.kind,
    x: s.x,
    y: s.y,
    z: s.z,
    heading: (s.headingDeg * Math.PI) / 180,
  })),
});
/** A fixed seed per resident layer: the same artwork lives the same life. */
const seedOf = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** The resident is drawn at most this often while it moves, and this often while it rests. */
const RESIDENT_MOVING_MS = 33;
const RESIDENT_RESTING_MS = 66;

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
  update(space: DesignSpace | undefined, resident?: ResidentSource): void;
  /** The resident layer's id while the character lives in the room (its front drawing is then
   * hidden and needs no guard); undefined while it is in front, or without a resident. */
  away(): string | undefined;
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
  // v18: the camera's shapes per page state (world/camera-shots.ts), when the artwork gives them.
  let shots: CameraShots | undefined,
    shotState: ShotState | undefined,
    shotName: ShotName = 'top';
  // v18: the character living in the room.
  let residentSource: ResidentSource | undefined;
  let life:
    | {
        key: string;
        body?: RoomResident;
        layout: RoomLayout;
        seed: number;
        state: ResidentState;
        drawnAt: number;
        drawnActivity?: string;
        abort: AbortController;
      }
    | undefined;
  let awayId: string | undefined;
  let viewProjectedAt = -Infinity;
  let spotSeen = new Map<string, number>();
  let nearFront = false;
  let roomSeen = 1;
  /** Where a touch now would leave its mark (viewport px), from measureView. */
  let touchAt: { x: number; y: number; d: number } | undefined;
  /** The touch marks on the glass: page position (they move with the page) and when made. */
  let marks: { x: number; y: number; at: number; size: number }[] = [];
  let markedSince: number | undefined;
  /** A mark rises, holds, and fades (ms). */
  const MARK_HOLD_MS = 1800,
    MARK_FADE_MS = 5200;

  const stopLife = () => {
    if (!life) return;
    life.abort.abort();
    void session?.renderer?.setResident(undefined);
    life.body?.dispose();
    life = undefined;
    if (awayId !== undefined) {
      awayId = undefined;
      onPlace?.();
    }
  };
  /** Loads the resident's body into the room (its model and motions through the same asset port
   * and checks as any layer); the life runs meanwhile, the body joins when ready. */
  const startLife = (renderer: RoomRenderer, next: DesignSpace, source: ResidentSource) => {
    const layout = withFloorPlaces(next.layout ? layoutFromArtwork(next.layout) : renderer.layout);
    if (!layout.floor.length || !layout.spots.length) return;
    const seed = seedOf(source.layerId);
    const abort = new AbortController();
    const key = `${source.assetId}|${source.motions.map((m) => m.assetId).join(',')}|${JSON.stringify(next.layout ?? null)}`;
    life = { key, layout, seed, state: startResident(layout, seed), drawnAt: -Infinity, abort };
    const current = life;
    const clips = residentClips(source.motions);
    void (async () => {
      const model = await assets.load(source.assetId, abort.signal);
      if (!model.modelBuffer) throw new Error('部屋の住人は3Dのモデル（VRM）にしてください。');
      const motions = await Promise.all(
        [...clips].map(async ([name, id]) => {
          const asset = await assets.load(id, abort.signal);
          return { name, bytes: new Uint8Array(await asset.blob!.arrayBuffer()) };
        }),
      );
      const body = await loadRoomResident(model.modelBuffer, motions);
      if (life !== current || abort.signal.aborted) return body.dispose();
      current.body = body;
      await renderer.setResident(body);
      drawnCamera = undefined;
      schedule();
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return;
      console.error('[Around] 部屋の住人を読み込めませんでした。', error);
    });
  };

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

  /**
   * What the viewer sees of the room now: each place's share (projected into the viewport, not
   * under the player and only half under a reading plate) and the room's share overall (the
   * viewport less the plates, the player's counted whole). Read four times a second.
   */
  const measureView = (renderer: RoomRenderer, layout: RoomLayout) => {
    const w = view.innerWidth,
      h = view.innerHeight;
    const inside = (p: { x: number; y: number }, r: GlassPlate) =>
      p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    // The body's middle, its feet and its head: a place counts only where the whole body is in
    // view (near the camera the feet fall below the window and the body fills it).
    const body = (s: RoomSpot) =>
      s.kind === 'sit' ? [s.y - 0.4, s.y + 0.2, s.y + 0.9] : [layout.floorY, layout.floorY + 0.8, layout.floorY + 1.55];
    const points = renderer.project(layout.spots.flatMap((s: RoomSpot) => body(s).map((y) => ({ x: s.x, y, z: s.z }))));
    spotSeen = new Map(
      layout.spots.map((s, i) => {
        const [feet, p, head] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
        if (!p || !feet || !head || p.x < 0 || p.x > w || feet.y > h || head.y < 0 || feet.y - head.y > h * 0.6)
          return [s.id, 0];
        const over = plates.filter((r) => inside(p, r));
        // Behind a sheet it is seen only as a blur (the design's 板の後ろで薄く見える).
        return [s.id, over.some((r) => r.video) ? 0 : over.length ? 0.05 : 1];
      }),
    );
    let covered = 0;
    for (const r of plates) {
      const area =
        Math.max(0, Math.min(w, r.right) - Math.max(0, r.left)) *
        Math.max(0, Math.min(h, r.bottom) - Math.max(0, r.top));
      covered += area * (r.video ? 1 : 0.6);
    }
    roomSeen = Math.max(0, Math.min(1, 1 - covered / Math.max(1, w * h)));
    // The plates do not know the page's opaque pictures (the list of thumbnails beside the player):
    // with camera shapes, the top's far shot is where the page covers the room most, so it counts
    // at less than half (the character then keeps the viewer company in front).
    if (shots && shotName === 'top') roomSeen *= 0.4;
    // In the theater the room is the two sides of the picture: wide sides open it (the character
    // comes into them), however much the text below covers further down.
    const picture = plates.find((r) => r.video);
    if (shots && shotName === 'theater' && picture)
      roomSeen = Math.max(
        roomSeen,
        Math.min(1, ((Math.max(0, picture.left) + Math.max(0, w - picture.right)) / w) * 2),
      );
    // The glass in front of the character: the nearest sheet edge to its hand (on screen), within
    // reach. A touch leaves its mark there (on the sheet's margin, never over the text's middle).
    // The glass between the character and the viewer: where its hand is on screen, if that is in
    // the clear (outside every sheet by a margin, so a mark never lies over text), sized by how far
    // away it stands (a palm is about 10 cm across).
    touchAt = undefined;
    if (life) {
      const [hand, side] = renderer.project([
        { x: life.state.x, y: layout.floorY + 1.05, z: life.state.z },
        { x: life.state.x + 0.1, y: layout.floorY + 1.05, z: life.state.z },
      ]);
      const clear = (p: { x: number; y: number }) =>
        p.x > 30 &&
        p.x < w - 30 &&
        p.y > 30 &&
        p.y < h - 30 &&
        !plates.some((r) => p.x > r.left - 40 && p.x < r.right + 40 && p.y > r.top - 40 && p.y < r.bottom + 40);
      if (hand && side && clear(hand)) touchAt = { x: hand.x, y: hand.y, d: Math.abs(side.x - hand.x) };
    }
    // Near the front place: the player's lower right corner (the character's home in front).
    const player = plates.find((r) => r.video);
    const me = life ? renderer.project([{ x: life.state.x, y: layout.floorY + 0.8, z: life.state.z }])[0] : null;
    nearFront = Boolean(player && me && Math.hypot(me.x - player.right, me.y - player.bottom) < w * 0.22);
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
      plates = glassSheets(glassPlates(backdrop.regions(), { width: view.innerWidth, height: view.innerHeight }));
    }
    if (now - videoAt >= VIDEO_SAMPLE_MS) {
      videoAt = now;
      if (space.videoLight > 0) sampleVideo(backdrop.video());
      else sample = undefined;
    }
    light = stepVideoLight(light, sample, dt, reduced.matches);
    const scrollProgress = view.scrollY / Math.max(1, view.innerHeight);
    let target: SpaceCameraState;
    let projection: CameraProjection;
    let shotsMoving = false,
      flat = false;
    if (shots) {
      // v18: the shapes. The page's own state picks one (the viewer's scrolling and theater
      // switch); the pointer only adds the small lens-shift parallax, followed smoothly.
      shotName = wantedShot(shotName, backdrop.theater?.() ?? false, scrollProgress);
      shotState = stepShots(shotState ?? startShots(shots, shotName), shots, shotName, dt, reduced.matches);
      const { shot, dip } = currentShot(shotState, shots, reduced.matches);
      renderer.dim(dip);
      shotsMoving = !shotSettled(shotState, shots, reduced.matches);
      flat = !shotsMoving && flatness(shot, shots.top) > 0.9;
      const k = reduced.matches ? 0.25 : 1;
      target = pointer ? { x: pointer.x * k, y: pointer.y * k, dolly: 0 } : CAMERA_REST;
      camera = stepCamera(camera, target, dt, space.camera.follow);
      const c = shotCamera(shot, { x: camera.x, y: camera.y }, ROOM_SUBJECT_M);
      projection = {
        offset: { x: c.x, y: c.y, z: c.z },
        fovDeg: c.fovDeg,
        shiftX: c.shiftX,
        shiftY: c.shiftY,
        orbitDeg: c.orbitDeg,
      };
    } else {
      target = cameraTarget(space.camera, {
        ...(pointer ? { pointer } : {}),
        scroll: scrollProgress,
        reducedMotion: reduced.matches,
      });
      camera = stepCamera(camera, target, dt, space.camera.follow);
      projection = projectCamera({ fovDeg: renderer.baseFovDeg, subject: ROOM_SUBJECT_M }, camera);
    }
    const scheme = backdrop.scheme();
    // The resident: its life steps every frame (cheap numbers); its body is drawn at most 30 times
    // a second while it moves and 15 while it rests, and not at all while it is in front.
    let residentDue = false;
    if (life) {
      if (now - viewProjectedAt >= 250) {
        viewProjectedAt = now;
        measureView(renderer, life.layout);
      }
      life.state = stepResident(
        life.state,
        {
          dt,
          layout: life.layout,
          seen: (spot) => spotSeen.get(spot.id) ?? 0.5,
          roomSeen,
          flat,
          front: space.resident?.front ?? 0,
          nearFront,
          reducedMotion: reduced.matches,
          glassNear: Boolean(touchAt),
        },
        life.seed,
      );
      // The palm on the glass: one mark per touch, where the hand meets the sheet.
      if (
        life.state.activity === 'touch' &&
        life.state.t - life.state.since >= TOUCH_MARK_S &&
        markedSince !== life.state.since &&
        touchAt
      ) {
        markedSince = life.state.since;
        marks = [
          ...marks.slice(-3),
          { x: touchAt.x + view.scrollX, y: touchAt.y + view.scrollY, at: now, size: Math.max(0.4, touchAt.d / 30) },
        ];
      }
      const away = life.body && life.state.activity !== 'front' ? space.resident?.layerId : undefined;
      if (away !== awayId) {
        awayId = away;
        onPlace?.();
      }
      if (life.body) {
        const pose = residentPose(life.state, life.layout);
        const moving = !['idle', 'sit', 'hide', 'front'].includes(life.state.activity);
        // A change of activity is always drawn: gone to the front, the room must not keep the
        // last faint frame of the fade.
        const changed = life.state.activity !== life.drawnActivity;
        life.drawnActivity = life.state.activity;
        residentDue =
          changed || (pose.visible && now - life.drawnAt >= (moving ? RESIDENT_MOVING_MS : RESIDENT_RESTING_MS));
        if (residentDue || !pose.visible) life.body.update(pose, (now - life.drawnAt) / 1000);
      }
    }
    // The marks now: rising for a moment, held, then fading; gone ones are dropped.
    marks = marks.filter((m) => now - m.at < MARK_HOLD_MS + MARK_FADE_MS);
    const glassMarks = marks.map((m) => {
      const age = now - m.at;
      const strength = Math.min(1, age / 250) * (age < MARK_HOLD_MS ? 1 : 1 - (age - MARK_HOLD_MS) / MARK_FADE_MS);
      return { x: m.x - view.scrollX, y: m.y - view.scrollY, size: m.size, strength: Math.max(0, strength) };
    });
    const fading = marks.length > 0 && now - drawnAt >= RESIDENT_RESTING_MS;
    const moved = !drawnCamera || !cameraSettled(camera, drawnCamera) || shotsMoving || fading;
    const platesMoved = !drawnPlates || !samePlates(plates, drawnPlates) || scheme !== drawnScheme;
    const lit =
      !drawnLight ||
      Math.abs(light.r - drawnLight.r) + Math.abs(light.g - drawnLight.g) + Math.abs(light.b - drawnLight.b) > 1 / 512;
    if (moved || platesMoved || residentDue || (lit && now - drawnAt >= LIGHT_ONLY_MS)) {
      if (life) life.drawnAt = now;
      renderer.draw({ camera: projection, plates, scheme, video: light, marks: glassMarks }, space);
      if (!revealing) {
        const current = session;
        revealing = true;
        void renderer.reveal().then(() => {
          if (session === current) doc.documentElement.dataset['aroundRoom'] = 'ready';
        });
      }
      drawnAt = now;
      drawnCamera = camera;
      drawnPlates = plates;
      drawnScheme = scheme;
      drawnLight = light;
      AROUND_SPACE_PROBE: {
        // Tests ask for drawn pixels by writing points (CSS px) to data-around-room-sample; the answer
        // (sRGB bytes) is read right after this draw, from the same drawing buffer.
        const ask = doc.documentElement.dataset['aroundRoomSample'];
        if (ask && renderer.readPixels) {
          try {
            const points = (JSON.parse(ask) as [number, number][]).slice(0, 4096).map(([x, y]) => ({ x, y }));
            doc.documentElement.dataset['aroundRoomPixels'] = JSON.stringify(renderer.readPixels(points));
          } catch {
            doc.documentElement.dataset['aroundRoomPixels'] = '[]';
          }
          delete doc.documentElement.dataset['aroundRoomSample'];
        }
        doc.documentElement.dataset['aroundRoomFrame'] = JSON.stringify({
          plates: plates.length,
          // Column plates from the readability's way out (text no known part covers).
          fallback: plates.filter((p) => p.fallback).map((p) => [p.left, p.top, p.right, p.bottom].map(Math.round)),
          boxes: plates.map((p) => [p.left, p.top, p.right, p.bottom].map(Math.round)),
          camera: [camera.x, camera.y, camera.dolly].map((n) => Math.round(n * 1000) / 1000),
          light: Math.round((0.2126 * light.r + 0.7152 * light.g + 0.0722 * light.b) * 1000) / 1000,
          sample: sample ? Math.round((0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b) * 1000) / 1000 : null,
          video: (() => {
            const v = backdrop.video();
            return v ? [v.readyState, v.videoWidth, v.paused] : null;
          })(),
          scheme,
          shot: shots ? shotName : null,
          marks: glassMarks.map((m) => [Math.round(m.x), Math.round(m.y), Math.round(m.strength * 100) / 100]),
          resident: life
            ? {
                activity: life.state.activity,
                spot: life.state.spot ?? null,
                body: Boolean(life.body),
                away: awayId ?? null,
                screen: renderer.project([{ x: life.state.x, y: life.layout.floorY + 0.8, z: life.state.z }])[0],
                roomSeen: Math.round(roomSeen * 100) / 100,
                glass: touchAt ? [Math.round(touchAt.x), Math.round(touchAt.y)] : null,
              }
            : null,
        });
      }
    }
    // Keep going while anything is still on its way: the camera, the light, a moving page, a
    // playing video's colour. Otherwise sleep until an event wakes the loop.
    const video = backdrop.video();
    const playing = Boolean(video && !video.paused && space.videoLight > 0);
    const living = Boolean(life?.body) && life!.state.activity !== 'front';
    if (!cameraSettled(camera, target) || shotsMoving || now < activeUntil || playing || lit || living || marks.length)
      schedule();
    // In front, the life still keeps time (to come back when the room opens), four times a second.
    else view.setTimeout(schedule, life ? 250 : IDLE_REGION_MS);
  };

  const stop = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    stopLife();
    shotState = undefined;
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
    delete doc.documentElement.dataset['aroundRoom'];
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
        doc.documentElement.dataset['aroundRoom'] = 'loading';
        AROUND_SPACE_PROBE: {
          // A sample request forces the next draw (the page's own attribute change wakes nobody).
          const watch = new MutationObserver(() => {
            if (doc.documentElement.dataset['aroundRoomSample']) {
              drawnCamera = undefined;
              schedule();
            }
          });
          watch.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-around-room-sample'] });
          abort.signal.addEventListener('abort', () => watch.disconnect());
        }
        onPlace?.();
        syncLife();
        wake();
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        doc.documentElement.dataset['aroundRoom'] = 'error';
        console.error('[Around] 部屋を読み込めませんでした。', error);
      });
  };
  /** Starts, keeps or ends the resident's life for the artwork now (once the room is there). */
  const syncLife = () => {
    const renderer = session?.renderer;
    const source = space?.resident && residentSource?.layerId === space.resident.layerId ? residentSource : undefined;
    if (!renderer || !space || !source) return stopLife();
    const key = `${source.assetId}|${source.motions.map((m) => m.assetId).join(',')}|${JSON.stringify(space.layout ?? null)}`;
    if (life?.key === key) return;
    stopLife();
    startLife(renderer, space, source);
  };
  return {
    update(next, resident) {
      space = next;
      residentSource = resident;
      if (!next) return stop();
      if (session && session.assetId !== next.room.assetId) stop();
      if (!session) start(next);
      const nextShots = next.camera.shots
        ? { ...next.camera.shots, transition: next.camera.transition ?? DEFAULT_SHOTS.transition }
        : undefined;
      if (JSON.stringify(nextShots) !== JSON.stringify(shots)) {
        shots = nextShots;
        shotState = undefined;
      }
      syncLife();
      drawnCamera = undefined;
      wake();
    },
    away: () => awayId,
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
