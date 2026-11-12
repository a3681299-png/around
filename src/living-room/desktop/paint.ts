/**
 * The virtual desktop as the room's monitor shows it (docs/living-desktop.md): the same state the
 * page's windows are drawn from, painted small on a canvas that is the monitor's texture. Closed,
 * the monitor rests on its wallpaper and a clock; open, it shows the windows where they are.
 */
import { APPS, BAR_H, WALLPAPERS, focused, type DesktopState } from './state';

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
  // The bar.
  g.fillStyle = 'rgba(255,255,255,0.22)';
  pane(g, W * 0.22, 5, W * 0.56, 15, 7.5);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.font = '600 10px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText('WWT Desktop', W * 0.22 + 10, 13);
  g.textAlign = 'right';
  g.fillText(time, W * 0.78 - 10, 13);
  // The windows, back to front.
  const front = focused(state)?.id;
  for (const win of [...state.windows].sort((a, b) => a.z - b.z)) {
    const x = win.x * sx,
      y = win.y * sy,
      w = win.w * sx,
      h = win.h * sy;
    g.fillStyle = 'rgba(8,12,40,0.28)';
    pane(g, x + 2, y + 5, w, h, 9);
    g.fillStyle = win.id === front ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.26)';
    pane(g, x, y, w, h, 9);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.font = '600 10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(APPS.find((a) => a.id === win.id)?.title ?? '', x + 9, y + 11);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(x, y + 20, w, 1);
    // Its insides, as a few soft bars (the monitor is across the room).
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 3; i++) pane(g, x + 9, y + 30 + i * 13, w * (0.7 - i * 0.16), 6, 3);
    if (win.id === 'ambience') {
      g.fillStyle = paper.accent;
      pane(g, x + 9, y + h - 26, w - 18, 14, 5);
    }
  }
  // The dock.
  const dockW = APPS.length * 30 + 12;
  g.fillStyle = 'rgba(255,255,255,0.24)';
  pane(g, (W - dockW) / 2, H - (BAR_H * sy + 12), dockW, 26, 10);
  APPS.forEach((app, i) => {
    g.fillStyle = state.windows.some((w) => w.id === app.id) ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)';
    pane(g, (W - dockW) / 2 + 10 + i * 30, H - (BAR_H * sy + 12) + 6, 14, 14, 4);
  });
}
