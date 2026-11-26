/**
 * The virtual desktop's state (docs/living-desktop.md): which windows are open, where, in what
 * order, the wallpaper and its brightness, whether the real screen is mirrored. Pure and
 * deterministic: the DOM (view.ts), the room's monitor (paint.ts) and the room's light all read
 * this one state, which is why they agree.
 *
 * Positions are CSS pixels of the viewport the desktop was last laid out for.
 */
export type AppId = 'player' | 'ambience' | 'mirror' | 'resident' | 'ball';
export const APPS: readonly { id: AppId; title: string; w: number; h: number }[] = [
  // A YouTube video, and the way into live mode (docs/living-live.md).
  { id: 'player', title: 'プレイヤー', w: 432, h: 392 },
  { id: 'ambience', title: '壁紙と光', w: 340, h: 300 },
  { id: 'mirror', title: 'ミラー', w: 400, h: 300 },
  { id: 'resident', title: '住人', w: 300, h: 250 },
  // Not a window but a toy: a ball of glass to throw about, which the resident chases.
  { id: 'ball', title: 'ボール', w: 72, h: 72 },
];

/** Wallpapers: a two-colour sweep and an accent. The room's light takes their colour. */
export const WALLPAPERS: readonly { name: string; from: string; to: string; accent: string }[] = [
  { name: '月光', from: '#2b3f8f', to: '#9fb6ff', accent: '#dfe7ff' },
  { name: '夜明け', from: '#3a2a7a', to: '#ff8fa3', accent: '#ffd0c2' },
  { name: '深海', from: '#062a4f', to: '#19c2b8', accent: '#a8fff2' },
  { name: '夕焼け', from: '#7a1f4d', to: '#ff9a3c', accent: '#ffd98a' },
  { name: '森', from: '#0d3b2a', to: '#9bd64a', accent: '#e6ffb0' },
  { name: '桜', from: '#b8477a', to: '#ffd9e6', accent: '#fff0f5' },
];

export interface DeskWindow {
  id: AppId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order: higher is in front. */
  z: number;
}

export interface DesktopState {
  open: boolean;
  windows: readonly DeskWindow[];
  wallpaper: number;
  /** 0.4–1.4: how bright the desktop (and so the room's glow) is. */
  brightness: number;
  mirror: boolean;
  /** The video in the player (a YouTube id), and whether the room is in live mode around it. */
  video?: string;
  live: boolean;
  viewport: readonly [number, number];
  nextZ: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The bar at the top and the dock at the bottom keep clear of windows. */
export const BAR_H = 38;
export const DOCK_H = 90;
const MARGIN = 10;

export const startDesktop = (viewport: readonly [number, number]): DesktopState => ({
  open: false,
  windows: [],
  wallpaper: 0,
  brightness: 1,
  mirror: false,
  live: false,
  viewport,
  nextZ: 1,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** A window kept where its title bar can always be reached, whatever the viewport. */
function fit(win: DeskWindow, viewport: readonly [number, number]): DeskWindow {
  const w = Math.min(win.w, viewport[0] - MARGIN * 2),
    h = Math.min(win.h, viewport[1] - BAR_H - DOCK_H - MARGIN * 2);
  return {
    ...win,
    w,
    h,
    x: clamp(win.x, MARGIN, viewport[0] - w - MARGIN),
    y: clamp(win.y, BAR_H + MARGIN, viewport[1] - DOCK_H - h - MARGIN),
  };
}

/**
 * Where an app's window first opens: along the sides, as widgets sit on a desktop, so that the
 * middle of the room (where the resident lives) stays clear. The resident's own card is low on
 * the left, over the front of the floor: a place it can walk up to and put a hand on.
 */
function firstPlace(id: AppId, viewport: readonly [number, number]): { x: number; y: number } {
  const [vw, vh] = viewport;
  if (id === 'resident') return { x: vw * 0.035, y: vh * 0.46 };
  // The ball drops in over the middle of the floor.
  if (id === 'ball') return { x: vw * 0.47, y: vh * 0.58 };
  // The wallpapers on the right; the mirror up beside the clock.
  if (id === 'ambience') return { x: vw, y: vh * 0.1 };
  // The player up in the middle, over the desk: the floor under it stays the resident's.
  if (id === 'player') return { x: vw * 0.5 - 216, y: 0 };
  // (Left of the wallpapers' card with room to spare, on a narrow screen too.)
  return { x: Math.min(vw * 0.27, vw - 770), y: 0 };
}

export type DesktopAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'video'; id: string }
  | { type: 'live'; on: boolean }
  | { type: 'app'; id: AppId }
  | { type: 'closeApp'; id: AppId }
  | { type: 'focus'; id: AppId }
  | { type: 'move'; id: AppId; x: number; y: number }
  | { type: 'viewport'; viewport: readonly [number, number] }
  | { type: 'wallpaper'; index: number }
  | { type: 'brightness'; value: number }
  | { type: 'mirror'; on: boolean };

export function reduceDesktop(state: DesktopState, action: DesktopAction): DesktopState {
  const front = (id: AppId): DesktopState => ({
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, z: state.nextZ } : w)),
    nextZ: state.nextZ + 1,
  });
  switch (action.type) {
    case 'open': {
      if (state.open) return state;
      // The first time, the resident's window is there to begin with.
      const opened = { ...state, open: true };
      return state.windows.length ? opened : reduceDesktop(opened, { type: 'app', id: 'resident' });
    }
    case 'close':
      // (Live mode is a state of the open desktop: it ends with it.)
      return state.open ? { ...state, open: false, live: false } : state;
    case 'video': {
      if (!VIDEO_ID.test(action.id)) return state;
      // A video to play: the player comes up with it (and the desktop, if it was shut).
      const shown = reduceDesktop({ ...state, open: true, video: action.id }, { type: 'app', id: 'player' });
      return state.windows.length ? shown : reduceDesktop(shown, { type: 'app', id: 'resident' });
    }
    case 'live':
      if (!action.on) return state.live ? { ...state, live: false } : state;
      if (state.live || !state.open || !state.video) return state;
      return { ...reduceDesktop(state, { type: 'app', id: 'player' }), live: true };
    case 'app': {
      if (state.windows.some((w) => w.id === action.id)) return front(action.id);
      const app = APPS.find((a) => a.id === action.id);
      if (!app) return state;
      const win = fit(
        { id: app.id, w: app.w, h: app.h, z: state.nextZ, ...firstPlace(app.id, state.viewport) },
        state.viewport,
      );
      return { ...state, windows: [...state.windows, win], nextZ: state.nextZ + 1 };
    }
    case 'closeApp':
      return {
        ...state,
        windows: state.windows.filter((w) => w.id !== action.id),
        live: state.live && action.id !== 'player',
      };
    case 'focus':
      return focused(state)?.id === action.id || !state.windows.some((w) => w.id === action.id)
        ? state
        : front(action.id);
    case 'move':
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return state;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? fit({ ...w, x: action.x, y: action.y }, state.viewport) : w,
        ),
      };
    case 'viewport': {
      const viewport: [number, number] = [Math.max(320, action.viewport[0]), Math.max(320, action.viewport[1])];
      // Windows keep their place as a share of the viewport, then are fitted in.
      const sx = viewport[0] / state.viewport[0],
        sy = viewport[1] / state.viewport[1];
      return {
        ...state,
        viewport,
        windows: state.windows.map((w) => {
          const app = APPS.find((a) => a.id === w.id)!;
          return fit({ ...w, w: app.w, h: app.h, x: w.x * sx, y: w.y * sy }, viewport);
        }),
      };
    }
    case 'wallpaper':
      return Number.isInteger(action.index) && action.index >= 0 && action.index < WALLPAPERS.length
        ? { ...state, wallpaper: action.index }
        : state;
    case 'brightness':
      return Number.isFinite(action.value) ? { ...state, brightness: clamp(action.value, 0.4, 1.4) } : state;
    case 'mirror':
      return { ...state, mirror: action.on };
  }
}

/** The window in front (the one the resident comes to). */
export const focused = (state: DesktopState): DeskWindow | undefined =>
  state.windows.reduce<DeskWindow | undefined>(
    // (The ball is a toy, never "the window in front".)
    (top, w) => (w.id !== 'ball' && (!top || w.z > top.z) ? w : top),
    undefined,
  );

export type Rgb = readonly [number, number, number];
/** '#rrggbb' → linear RGB (what light is added in). */
export function linear(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/**
 * The light the desktop gives the room, linear RGB: `screen` is what the room's monitor shows
 * (always on), `ui` is the glow of the open desktop in front of the room (black when closed).
 * `mirrored` is the real screen's average colour while it is mirrored.
 */
export function desktopLight(state: DesktopState, mirrored?: Rgb): { screen: Rgb; ui: Rgb } {
  const paper = WALLPAPERS[state.wallpaper] ?? WALLPAPERS[0]!;
  const wall = scale(mix(linear(paper.from), linear(paper.to), 0.5), state.brightness);
  const accent = scale(linear(paper.accent), state.brightness);
  // Open windows are pale glass over the wallpaper: they lift the screen toward the accent.
  const area = state.viewport[0] * state.viewport[1];
  const cover = state.open ? Math.min(1, state.windows.reduce((sum, w) => sum + w.w * w.h, 0) / area) : 0;
  const desk = mix(wall, accent, 0.35 * cover);
  const live = state.mirror && mirrored;
  return {
    screen: live ? mirrored : desk,
    ui: state.open ? (live ? mix(desk, mirrored, 0.5) : mix(wall, accent, 0.3)) : [0, 0, 0],
  };
}
