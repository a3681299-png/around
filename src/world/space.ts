/**
 * The depth foundation (docs/depth-foundation.md): the room behind the UI, the camera that moves
 * it, the glass plates under the UI, and the video's light. Pure and deterministic: the Host
 * passes time, pointer, scroll and region rectangles in; nothing here reads the page.
 *
 * Space → camera → projection → drawing (the long roadmap's G2 split): `cameraTarget` turns
 * signals into where the camera wants to be, `stepCamera` follows it in time, `projectCamera`
 * turns that state into the pose and the field of view the renderer draws with.
 */

/** Where a drawn thing is: the room behind the UI, or in front of it (docs/product-design-snapshot.md,
 * 空間の構造: 部屋・UI の板・UI の手前). The plate depth is the UI itself; nothing is drawn there. */
export type Depth = 'room' | 'front';

/**
 * How far the camera may move from camera_main without showing the outside of the test room
 * (docs/room-bake-plan.md, measured 2026-11-07): metres, in the camera's own axes. An artwork's
 * values are fractions of these; a room built larger may be given more by the engine later.
 */
export const ROOM_CAMERA_RANGE = Object.freeze({ x: 0.2, y: 0.4, forward: 0.3, back: 1.0, dolly: 1.5 });

export interface SpaceCameraSettings {
  /** 0–1: how far the pointer sways the camera, as a share of ROOM_CAMERA_RANGE. */
  sway: number;
  /** 0–1: how far scrolling the page dollies the camera back (a dolly zoom: the room's middle
   * keeps its size while the depth around it changes). */
  dolly: number;
  /** Seconds the camera takes to cover most (95%) of the way to where the signals want it. */
  follow: number;
}
export interface SpaceCameraInput {
  /** Pointer over the viewport, −1 (left/top) to 1 (right/bottom); absent when it has left. */
  pointer?: { x: number; y: number };
  /** Page scroll progress, 0 at the top to 1 one screen down (and beyond, clamped). */
  scroll: number;
  /** prefers-reduced-motion: the motion is weakened to a quarter (not stopped: depth stays readable). */
  reducedMotion: boolean;
}
/** Metres from camera_main in its own axes: x right, y up, dolly back. */
export interface SpaceCameraState {
  x: number;
  y: number;
  dolly: number;
}
export const CAMERA_REST: SpaceCameraState = Object.freeze({ x: 0, y: 0, dolly: 0 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const REDUCED = 0.25;

export function cameraTarget(settings: SpaceCameraSettings, input: SpaceCameraInput): SpaceCameraState {
  const k = input.reducedMotion ? REDUCED : 1;
  const sway = clamp(settings.sway, 0, 1) * k,
    dolly = clamp(settings.dolly, 0, 1) * k,
    scroll = clamp(Number.isFinite(input.scroll) ? input.scroll : 0, 0, 1);
  const px = input.pointer ? clamp(input.pointer.x, -1, 1) : 0,
    py = input.pointer ? clamp(input.pointer.y, -1, 1) : 0;
  // The pointer moves the camera the way a head moves at a window: right shows more of the room's
  // left. The vertical share is half the room's range so the floor and ceiling stay in view; the
  // scroll lowers the camera a little as the page goes down, so the room seems to stay behind.
  return {
    x: px * sway * ROOM_CAMERA_RANGE.x,
    y: clamp((-py * 0.5 - scroll * 0.25) * sway * ROOM_CAMERA_RANGE.y, -ROOM_CAMERA_RANGE.y, ROOM_CAMERA_RANGE.y),
    dolly: scroll * dolly * ROOM_CAMERA_RANGE.dolly,
  };
}

/** Frame-rate independent following: after `follow` seconds, 95% of the way. */
export function stepCamera(
  state: SpaceCameraState,
  target: SpaceCameraState,
  dtSeconds: number,
  follow: number,
): SpaceCameraState {
  const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, 0.25);
  const a = 1 - Math.exp((-3 * dt) / Math.max(0.05, follow));
  return {
    x: state.x + (target.x - state.x) * a,
    y: state.y + (target.y - state.y) * a,
    dolly: state.dolly + (target.dolly - state.dolly) * a,
  };
}
/** Within a tenth of a millimetre: nothing on screen would move, so the room need not be drawn. */
export const cameraSettled = (a: SpaceCameraState, b: SpaceCameraState) =>
  Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.dolly - b.dolly) < 1e-4;

export interface CameraProjection {
  /** Offset from camera_main in its own axes (metres): right, up, back. */
  offset: { x: number; y: number; z: number };
  fovDeg: number;
  /** v18 camera shapes (world/camera-shots.ts): the lens shift in fractions of the half frame's
   * height (the renderer divides x by the aspect) and a turn about the room's middle. */
  shiftX?: number;
  shiftY?: number;
  orbitDeg?: number;
}
/**
 * The dolly zoom keeps the plane `subject` metres in front of camera_main the same size on screen:
 * moving back by d, the view narrows to 2·atan(h / 2(subject + d)).
 */
export function projectCamera(base: { fovDeg: number; subject: number }, state: SpaceCameraState): CameraProjection {
  const subject = Math.max(0.1, base.subject);
  const h = 2 * subject * Math.tan(((base.fovDeg / 2) * Math.PI) / 180);
  const fovDeg = (2 * Math.atan(h / 2 / (subject + state.dolly)) * 180) / Math.PI;
  return { offset: { x: state.x, y: state.y, z: state.dolly }, fovDeg };
}

// --- UI regions and glass plates ---------------------------------------------------------------

/**
 * A region's importance (docs/product-design-snapshot.md, UI の領域情報): operate = the G1
 * operation parts, read = text to read, free = decoration and margins (no plate).
 */
export type RegionImportance = 'operate' | 'read' | 'free';
export interface UiRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  importance: RegionImportance;
  /** The video's own box: it lights the room, and its plate is the video's colour. */
  video?: boolean;
  /** The plate's margin around the region (default PLATE_PAD_PX). A bar that meets an opaque part
   * of the page (the masthead) takes none, or the margin shows as a strip. */
  pad?: number;
  /** A whole column the adapter found text in that none of its known parts covers (YouTube
   * renamed a part): the readability's way out. It is kept first, past every limit. */
  fallback?: boolean;
}
export interface GlassPlate {
  left: number;
  top: number;
  right: number;
  bottom: number;
  importance: Exclude<RegionImportance, 'free'>;
  video: boolean;
  fallback?: boolean;
}
/** One plate per part with text or controls (a comment, a recommendation's text, a button row). */
export const PLATE_LIMIT = 48;
/** The plate reaches this far past its region: scrolling can move the page a frame before the plate. */
export const PLATE_PAD_PX = 8;

/** Plates for the regions that need one, in the viewport, at most PLATE_LIMIT (operate first). */
export function glassPlates(regions: readonly UiRegion[], viewport: { width: number; height: number }): GlassPlate[] {
  const plates: GlassPlate[] = [];
  for (const r of regions) {
    if (r.importance === 'free' || !(r.width > 0) || !(r.height > 0)) continue;
    const pad = Math.min(PLATE_PAD_PX, Math.max(0, r.pad ?? PLATE_PAD_PX));
    const plate = {
      left: Math.max(-PLATE_PAD_PX, r.left - pad),
      top: Math.max(-PLATE_PAD_PX, r.top - pad),
      right: Math.min(viewport.width + PLATE_PAD_PX, r.left + r.width + pad),
      bottom: Math.min(viewport.height + PLATE_PAD_PX, r.top + r.height + pad),
      importance: r.importance,
      video: Boolean(r.video),
      ...(r.fallback ? { fallback: true } : {}),
    };
    if (plate.right <= plate.left || plate.bottom <= plate.top) continue;
    plates.push(plate);
  }
  // The fallback first (it is what keeps unrecognised text readable), then the controls.
  const rank = (p: GlassPlate) => (p.fallback ? 0 : p.importance === 'operate' ? 1 : 2);
  plates.sort((a, b) => rank(a) - rank(b));
  return plates.slice(0, PLATE_LIMIT);
}
/** Reading plates closer than this (px, vertically) in the same column join one sheet. */
export const SHEET_GAP_PX = 40;
/**
 * One sheet of glass per column of reading (docs/living-room.md): the plates of a column's parts
 * (a comment, its buttons, the next comment…) join into one panel instead of reading as separate
 * labels. Plates join when they overlap across (by half the narrower one's width) and are at most
 * SHEET_GAP_PX apart down the page; a control plate wholly inside a sheet goes into it. The video's
 * plate and the readability's way out stay as they are. The sheet covers every plate it took, so
 * every text stays on glass, and the density rule (plateAlpha) holds over the whole sheet.
 */
export function glassSheets(plates: readonly GlassPlate[]): GlassPlate[] {
  const out: GlassPlate[] = [];
  const kept: GlassPlate[] = [];
  for (const p of plates) (p.video || p.fallback ? kept : out).push({ ...p });
  const across = (a: GlassPlate, b: GlassPlate) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) >= 0.5 * Math.min(a.right - a.left, b.right - b.left);
  const near = (a: GlassPlate, b: GlassPlate) => Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) <= SHEET_GAP_PX;
  const inside = (a: GlassPlate, b: GlassPlate) =>
    a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  // Groups by joining pairs (union-find over at most PLATE_LIMIT plates).
  const parent = out.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!,
        b = out[j]!;
      const reading = a.importance === 'read' || b.importance === 'read';
      if ((reading && across(a, b) && near(a, b)) || inside(a, b) || inside(b, a)) parent[root(j)] = root(i);
    }
  const groups = new Map<number, GlassPlate[]>();
  out.forEach((p, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), p]));
  const sheets: GlassPlate[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      sheets.push(members[0]!);
      continue;
    }
    // The sheet is as wide as most of its parts: one part much wider (a header row across the
    // page) would otherwise frost the room beside the whole column. Such a part keeps its own plate.
    const rights = members.map((p) => p.right).sort((a, b) => a - b);
    const right = rights[Math.min(rights.length - 1, Math.floor(rights.length * 0.8))]!;
    const sheet: GlassPlate = {
      left: Math.min(...members.map((p) => p.left)),
      top: Math.min(...members.map((p) => p.top)),
      right,
      bottom: Math.max(...members.map((p) => p.bottom)),
      // A sheet with any text on it is a reading sheet (its floor is the lighter one).
      importance: members.some((p) => p.importance === 'read') ? 'read' : 'operate',
      video: false,
    };
    sheets.push(sheet);
    for (const p of members) if (p.right > right + 24) sheets.push(p);
  }
  return [...kept, ...sheets];
}

export const samePlates = (a: readonly GlassPlate[], b: readonly GlassPlate[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.left === b[i]!.left &&
      p.top === b[i]!.top &&
      p.right === b[i]!.right &&
      p.bottom === b[i]!.bottom &&
      p.importance === b[i]!.importance &&
      p.video === b[i]!.video,
  );

// --- Readability: how dense a plate must be ----------------------------------------------------

/** WCAG relative luminance of an sRGB colour given 0–255. */
export function luminance(r: number, g: number, b: number): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const READABLE_CONTRAST = 4.5;

/**
 * The text a plate must keep readable, per colour scheme. The design's rule is white text at
 * 4.5:1; YouTube's grey secondary text (#aaaaaa dark, #606060 light) is held to the same 4.5:1,
 * which is stricter and keeps the metadata readable too (docs/depth-foundation.md).
 */
export const PLATE_TEXT = Object.freeze({
  dark: { text: luminance(0xaa, 0xaa, 0xaa), base: luminance(0x0f, 0x0f, 0x0f) },
  light: { text: luminance(0x60, 0x60, 0x60), base: luminance(0xff, 0xff, 0xff) },
});
export type ColorScheme = keyof typeof PLATE_TEXT;

/**
 * The background luminance limit for the scheme's text at 4.5:1: dark text needs a background at
 * least this bright (light scheme), light text one at most this bright (dark scheme).
 */
export function plateLimit(scheme: ColorScheme): number {
  const text = PLATE_TEXT[scheme].text;
  return scheme === 'dark' ? (text + 0.05) / READABLE_CONTRAST - 0.05 : READABLE_CONTRAST * (text + 0.05) - 0.05;
}
/**
 * The plate's opacity over a background of luminance `room`, so that the plate (its base colour
 * at that opacity over the room) keeps the scheme's text at 4.5:1. `floor` is the least opacity
 * the plate is drawn with whatever is behind it. The renderer computes the same per pixel over the
 * blurred room it shows (src/renderers/three/room.ts); this is the rule its tests compare with.
 */
export function plateAlpha(room: number, scheme: ColorScheme, floor: number, base = PLATE_TEXT[scheme].base): number {
  const limit = plateLimit(scheme);
  const need =
    scheme === 'dark'
      ? room > limit
        ? (room - limit) / Math.max(1e-6, room - base)
        : 0
      : room < limit
        ? (limit - room) / Math.max(1e-6, base - room)
        : 0;
  return clamp(Math.max(need, floor), 0, 1);
}

// --- The video's light -------------------------------------------------------------------------

/** Linear RGB (0–1) and how much the light still counts. */
export interface VideoLight {
  r: number;
  g: number;
  b: number;
}
/**
 * At most this much change of luminance per second. A swing of a tenth (WCAG 2.3.1's general
 * flash threshold) then takes 0.2 s each way, so the light cannot flash more than 2.5 times a
 * second, under the design's limit of 3 (光の明滅は1秒3回まで).
 */
export const VIDEO_LIGHT_SLEW = 0.5;
/**
 * Follows the sampled video colour with the slew limit applied to every channel (the luminance,
 * a weighted sum of them, then changes at most as fast). Reduced motion follows at a quarter of
 * the speed. A sample that could not be read (`undefined`: DRM, an advert switching, a hidden
 * tab) fades the light out at the same rate instead of treating the video as black at once.
 */
export function stepVideoLight(
  state: VideoLight,
  sample: VideoLight | undefined,
  dtSeconds: number,
  reducedMotion: boolean,
): VideoLight {
  const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, 1);
  const step = VIDEO_LIGHT_SLEW * dt * (reducedMotion ? REDUCED : 1);
  const target = sample ?? { r: 0, g: 0, b: 0 };
  const move = (from: number, to: number) => from + clamp(clamp(to, 0, 1) - from, -step, step);
  return { r: move(state.r, target.r), g: move(state.g, target.g), b: move(state.b, target.b) };
}
export const videoLightLuminance = (v: VideoLight) => 0.2126 * v.r + 0.7152 * v.g + 0.0722 * v.b;
