/**
 * The virtual desktop as the room's monitor shows it (docs/living-desktop.md): the same state the
 * page's windows are drawn from, painted small on a canvas that is the monitor's texture. Closed,
 * the monitor rests on its wallpaper and a clock; open, it shows the windows where they are.
 */
import { APPS, DOCK_H, WALLPAPERS, focused, type DesktopState } from './state';

export const MONITOR_W = 640;
export const MONITOR_H = 360;

type Pen = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function pane(g: Pen, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

export function paintDesktop(g: Pen, state: DesktopState, now: Date) {
  const W = MONITOR_W,
    H = MONITOR_H;
  const paper = WALLPAPERS[state.wallpaper] ?? WALLPAPERS[0]!;
  const sweep = g.createLinearGradient(0, 0, W, H);
  sweep.addColorStop(0, paper.from);
  sweep.addColorStop(1, paper.to);
  g.globalAlpha = 1;
  g.fillStyle = sweep;
  g.fillRect(0, 0, W, H);
  // Brightness: a veil of black or white over the wallpaper (the monitor's own backlight).
  if (state.brightness < 1) {
    g.fillStyle = `rgba(0,0,0,${(1 - state.brightness) * 0.9})`;
    g.fillRect(0, 0, W, H);
  } else if (state.brightness > 1) {
    g.fillStyle = `rgba(255,255,255,${(state.brightness - 1) * 0.5})`;
    g.fillRect(0, 0, W, H);
  }
  const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  g.textBaseline = 'middle';
  if (!state.open) {
    // Resting: the time, large.
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '600 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(time, W / 2, H / 2 - 8);
    g.font = '500 20px system-ui, sans-serif';
    g.fillText(now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' }), W / 2, H / 2 + 52);
    return;
  }
  const sx = W / state.viewport[0],
    sy = H / state.viewport[1];
  // The bar across the top, and the clock on the desktop itself.
  const barH = Math.max(12, 32 * sy);
  g.fillStyle = 'rgba(8,10,30,0.42)';
  g.fillRect(0, 0, W, barH);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.font = '700 9px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText('WWT', 8, barH / 2 + 0.5);
  g.textAlign = 'center';
  g.font = '600 9px system-ui, sans-serif';
  g.fillText(time, W / 2, barH / 2 + 0.5);
  g.textAlign = 'left';
  g.font = '200 40px system-ui, sans-serif';
  g.fillText(time, 30 * sx, barH + 34);
  // The windows, back to front.
  const front = focused(state)?.id;
  for (const win of [...state.windows].sort((a, b) => a.z - b.z)) {
    const x = win.x * sx,
      y = win.y * sy,
      w = win.w * sx,
      h = win.h * sy;
    if (win.id === 'ball') {
      // The toy: a bright bead.
      g.fillStyle = paper.accent;
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, Math.max(w, h) / 2, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    g.fillStyle = 'rgba(8,12,40,0.28)';
    pane(g, x + 2, y + 5, w, h, 11);
    g.fillStyle = win.id === front ? 'rgba(255,255,255,0.36)' : 'rgba(255,255,255,0.24)';
    pane(g, x, y, w, h, 11);
    // Its tile and its name.
    g.fillStyle = paper.accent;
    pane(g, x + 7, y + 6, 10, 10, 3);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.font = '600 10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(APPS.find((a) => a.id === win.id)?.title ?? '', x + 22, y + 11.5);
    // Its insides, as a few soft bars (the monitor is across the room).
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 3; i++) pane(g, x + 9, y + 30 + i * 13, w * (0.7 - i * 0.16), 6, 3);
    if (win.id === 'ambience') {
      g.fillStyle = paper.accent;
      pane(g, x + 9, y + h - 26, w - 18, 14, 5);
    }
  }
  // The dock.
  const tile = 50 * sy,
    gap = 10 * sx;
  const dockW = APPS.length * (tile + gap) + gap,
    dockY = H - (DOCK_H - 12) * sy;
  g.fillStyle = 'rgba(255,255,255,0.22)';
  pane(g, (W - dockW) / 2, dockY, dockW, tile + 20 * sy, 11);
  APPS.forEach((app, i) => {
    g.fillStyle = state.windows.some((w) => w.id === app.id) ? paper.accent : 'rgba(255,255,255,0.5)';
    pane(g, (W - dockW) / 2 + gap + i * (tile + gap), dockY + 8 * sy, tile, tile, tile * 0.3);
  });
}
